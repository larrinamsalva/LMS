import { selectModules } from "../../src/core/buildplan";
import { reviewedEstimate, conversion } from "../helpers/invoices";
import { invoiceLabel } from "../../src/core/invoices";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { catalog, selection, savedPricing } from "../helpers/pricing";
import {
  calculateEstimate,
  type EstimateInput,
  type EstimatePricing,
} from "../../src/core/pricing";
import { catalogSnapshots, snapshotsFor } from "../../src/core/catalog";
import { employee, enroll } from "../helpers/workforce";
import type { RecordData } from "../../src/core/config";
import { Engine } from "../../src/core/engine";
import { presets } from "../../src/presets";
import { workflow, appointmentData } from "../helpers/scheduling";
import { connectPostgres } from "../../src/server/postgres/adapter";
import {
  migrate,
  loadMigrations,
  provisionRuntime,
} from "../../src/server/postgres/migrations";
import { localTarget } from "../../src/server/postgres/targets";
import {
  backupDatabase,
  restoreDatabase,
} from "../../src/server/postgres/backup";
const raw = process.env.LMS_TEST_ADMIN_URL;
if (!raw)
  throw new Error(
    "LMS_TEST_ADMIN_URL is required; pricing PostgreSQL tests never skip.",
  );
const controlName = decodeURIComponent(new URL(raw).pathname.slice(1));
if (!controlName.startsWith("lms_test_"))
  throw new Error("Use a disposable fictional lms_test_* control.");
const control = localTarget(raw, controlName),
  suffix = randomBytes(5).toString("hex"),
  name = "lms_test_invoices_" + suffix,
  restoreName = "lms_restore_invoices_" + suffix,
  legacyName = "lms_test_invoices_legacy_" + suffix;
function url(database = name, runtime = false) {
  const u = new URL(control);
  u.pathname = "/" + database;
  if (runtime) {
    u.username = "lms_runtime";
    u.password =
      process.env.LMS_TEST_RUNTIME_PASSWORD ??
      "fictional_test_password_24_characters";
  }
  return u.toString();
}
let cluster: Client,
  admin: Client,
  db: Awaited<ReturnType<typeof connectPostgres>>,
  engine: Engine,
  a: string,
  b: string,
  directory: string;
const owner = { userId: randomUUID() },
  other = { userId: randomUUID() },
  staff = { userId: randomUUID() },
  viewer = { userId: randomUUID() };
async function client<T>(
  database: string,
  runtime: boolean,
  fn: (c: Client) => Promise<T>,
) {
  const c = new Client({
    connectionString: url(database, runtime),
    statement_timeout: 15000,
  });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
async function org(c: Client, id: string, actor: string, config: unknown) {
  await c.query(
    "insert into lms.organizations(id,name) values($1,'Fictional schedule')",
    [id],
  );
  await c.query("insert into lms.memberships values($1,$2,'owner')", [
    id,
    actor,
  ]);
  await c.query("select set_config('lms.user_id',$1,false)", [actor]);
  await c.query(
    "insert into lms.config_revisions(organization_id,revision,document,created_by)values($1,1,$2,$3)",
    [id, config, actor],
  );
}
beforeAll(async () => {
  cluster = new Client({ connectionString: control.toString() });
  await cluster.connect();
  for (const n of [name, restoreName, legacyName])
    await cluster.query(`create database "${n}"`);
  admin = new Client({ connectionString: url() });
  await admin.connect();
  await migrate(admin);
  await provisionRuntime(admin, url(name, true));
  for (const p of [owner, other, staff, viewer])
    await admin.query(
      "insert into lms.users values($1,'Fictional scheduling principal')",
      [p.userId],
    );
  db = await connectPostgres({
    connectionString: url(name, true),
    maxConnections: 4,
  });
  engine = new Engine(db);
  directory = await mkdtemp(path.join(os.tmpdir(), "lms-invoices-"));
});
beforeEach(async () => {
  await admin.query("truncate lms.organizations cascade");
  a = randomUUID();
  b = randomUUID();
  await org(
    admin,
    a,
    owner.userId,
    selectModules(presets.property, [
      ...presets.property.modules.map((m) => m.id),
      "invoice-drafts",
    ]),
  );
  await org(
    admin,
    b,
    other.userId,
    selectModules(presets.cleaning, [
      ...presets.cleaning.modules.map((m) => m.id),
      "invoice-drafts",
    ]),
  );
  for (const [p, role] of [
    [staff, "staff"],
    [viewer, "viewer"],
  ] as const)
    await admin.query("insert into lms.memberships values($1,$2,$3)", [
      a,
      p.userId,
      role,
    ]);
});
afterAll(async () => {
  await db?.close();
  await admin?.end();
  if (cluster) {
    for (const n of [name, restoreName, legacyName])
      await cluster.query(`drop database if exists "${n}" with(force)`);
    await cluster.end();
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function rawTx<T>(fn: (c: Client) => Promise<T>, actor = owner.userId) {
  return client(name, true, async (c) => {
    await c.query("begin");
    try {
      await c.query("set local role lms_app");
      await c.query("select set_config('lms.user_id',$1,true)", [actor]);
      const result = await fn(c);
      await c.query("commit");
      return result;
    } catch (e) {
      await c.query("rollback");
      throw e;
    }
  });
}
const make = () => reviewedEstimate(engine, owner, a);
const convert = async (
  c: Awaited<ReturnType<typeof make>>,
  op = randomUUID(),
) => engine.writeInvoiceDraft(owner, a, conversion(c.estimate), op);
const amend = (
  r: { id: string; revision: number; data: RecordData },
  quantity = "2",
) => ({
  kind: "correct",
  invoiceId: r.id,
  revision: r.revision,
  configRevision: 1,
  acknowledgement: invoiceLabel,
  reason: "Corrected fictional quantity",
  notes: "Fictional internal correction",
  pricing: {
    ...savedPricing(r as never),
    lines: savedPricing(r as never).lines.map((l) => ({ ...l, quantity })),
  },
});
it("converts exact reviewed prices, discounts and manual tax while retaining original rate, description and area", async () => {
  const c = await make();
  const before = await engine.snapshot(owner, a);
  const invoice = await convert(c);
  expect(savedPricing(invoice)).toEqual(savedPricing(c.estimate));
  await engine.saveRecord(
    owner,
    a,
    "service-rates",
    { ...c.rate.data, amount: "9900" },
    c.rate,
  );
  await engine.saveRecord(
    owner,
    a,
    "services",
    { ...c.service.data, description: "Later catalog description" },
    c.service,
  );
  const corrected = await engine.writeInvoiceDraft(
    owner,
    a,
    amend(invoice),
    randomUUID(),
  );
  expect(savedPricing(corrected)).toMatchObject({
    totalMinor: "2002",
    customerName: "Fictional customer",
  });
  expect(savedPricing(corrected).lines[0].snapshot).toEqual(
    savedPricing(c.estimate).lines[0].snapshot,
  );
  const after = await engine.snapshot(owner, a);
  expect(after.config).toEqual(before.config);
  expect(after.invoiceVersions).toHaveLength(2);
  expect(after.records.find((r) => r.id === c.estimate.id)).toEqual(c.estimate);
});
it("serializes identical conversion retries without duplicate assets, revisions, receipts or audits", async () => {
  const c = await make(),
    op = randomUUID(),
    req = conversion(c.estimate);
  const results = await Promise.all([
    engine.writeInvoiceDraft(owner, a, req, op),
    engine.writeInvoiceDraft(owner, a, req, op),
  ]);
  expect(results[0]).toEqual(results[1]);
  await engine.writeInvoiceDraft(owner, a, amend(results[0]), randomUUID());
  expect(await engine.writeInvoiceDraft(owner, a, req, op)).toEqual(results[0]);
  await expect(
    engine.writeInvoiceDraft(owner, a, { ...req, estimateRevision: 1 }, op),
  ).rejects.toMatchObject({ status: 409 });
  const s = await engine.snapshot(owner, a);
  expect(s.invoiceVersions).toHaveLength(2);
  expect(s.audit.filter((x) => x.record_id === results[0].id)).toHaveLength(2);
});
it("refuses two distinct operations converting the same estimate and concurrent stale corrections", async () => {
  const c = await make();
  const outcomes = await Promise.allSettled([convert(c), convert(c)]);
  expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((x) => x.status === "rejected")).toHaveLength(1);
  const first = (
    outcomes.find((x) => x.status === "fulfilled") as PromiseFulfilledResult<
      Awaited<ReturnType<typeof convert>>
    >
  ).value;
  const changes = await Promise.allSettled([
    engine.writeInvoiceDraft(owner, a, amend(first, "2"), randomUUID()),
    engine.writeInvoiceDraft(owner, a, amend(first, "3"), randomUUID()),
  ]);
  expect(changes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect((await engine.snapshot(owner, a)).invoiceVersions).toHaveLength(2);
});
it("orders source reopening against conversion, refusing a stale revision rather than recalculating", async () => {
  const c = await make();
  const results = await Promise.allSettled([
    convert(c),
    engine.saveRecord(
      owner,
      a,
      "estimates",
      { ...c.estimate.data, status: "Draft" },
      c.estimate,
    ),
  ]);
  expect(results[1].status).toBe("fulfilled");
  if (results[0].status === "fulfilled")
    expect(savedPricing(results[0].value)).toEqual(savedPricing(c.estimate));
  else expect(results[0].reason).toMatchObject({ status: 409 });
  await expect(convert(c)).rejects.toMatchObject({ status: 409 });
});
it("rejects revoked, staff, viewer and foreign authority at both Engine and SQL boundaries", async () => {
  const c = await make(),
    req = conversion(c.estimate);
  for (const p of [staff, viewer, other])
    await expect(
      engine.writeInvoiceDraft(p, a, req, randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
  await expect(
    rawTx(
      (c) =>
        c.query("select lms.write_invoice_draft($1,$2,$3)", [
          a,
          randomUUID(),
          req,
        ]),
      other.userId,
    ),
  ).rejects.toMatchObject({ code: "42501" });
  const r = await convert(c);
  await admin.query(
    "update lms.memberships set role='viewer' where organization_id=$1 and user_id=$2",
    [a, owner.userId],
  );
  await expect(
    engine.writeInvoiceDraft(owner, a, amend(r), randomUUID()),
  ).rejects.toMatchObject({ status: 403 });
  expect(
    (
      await engine.asUser(viewer, (tx) =>
        tx.query(
          "select * from lms.invoice_versions where organization_id=$1",
          [b],
        ),
      )
    ).rows,
  ).toEqual([]);
});
it("rejects foreign source IDs, wrong revisions, unreviewed, archived or void estimates", async () => {
  const c = await make(),
    foreign = await reviewedEstimate(engine, other, b);
  await expect(
    engine.writeInvoiceDraft(
      owner,
      a,
      conversion(foreign.estimate),
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    engine.writeInvoiceDraft(owner, a, conversion(c.estimate, 2), randomUUID()),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    engine.writeInvoiceDraft(
      owner,
      a,
      { ...conversion(c.estimate), estimateRevision: 1 },
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
  const archived = await engine.archiveRecord(
    owner,
    a,
    c.estimate.id,
    c.estimate.revision,
    true,
  );
  await expect(
    engine.writeInvoiceDraft(owner, a, conversion(archived), randomUUID()),
  ).rejects.toMatchObject({ status: 409 });
  const restored = await engine.archiveRecord(
    owner,
    a,
    c.estimate.id,
    archived.revision,
    false,
  );
  const voided = await engine.saveRecord(
    owner,
    a,
    "estimates",
    { ...restored.data, status: "Void" },
    restored,
  );
  await expect(
    engine.writeInvoiceDraft(owner, a, conversion(voided), randomUUID()),
  ).rejects.toMatchObject({ status: 409 });
  expect((await engine.snapshot(owner, a)).invoiceVersions).toEqual([]);
});
it("retains source, customer and work links even after module disabling and protects prior financial revisions", async () => {
  const c = await make(),
    r = await convert(c);
  await expect(
    engine.archiveRecord(owner, a, c.customer.id, c.customer.revision, true),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    engine.archiveRecord(owner, a, c.work.id, c.work.revision, true),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    engine.archiveRecord(owner, a, c.estimate.id, c.estimate.revision, true),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    engine.saveRecord(
      owner,
      a,
      "tasks",
      { ...c.work.data, customer: "" },
      c.work,
    ),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    rawTx((c) =>
      c.query(
        "update lms.records set data=jsonb_set(data,'{pricing,totalMinor}','\"1\"') where organization_id=$1 and id=$2",
        [a, r.id],
      ),
    ),
  ).rejects.toMatchObject({ code: "23514" });
  for (const table of ["invoice_origins", "invoice_versions"]) {
    await expect(
      rawTx((c) => c.query(`delete from lms.${table}`)),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      admin.query(`update lms.${table} set organization_id=organization_id`),
    ).rejects.toMatchObject({ code: "23514" });
  }
  const config = (await engine.snapshot(owner, a)).config.document;
  const disabled = selectModules(
    config,
    config.modules.filter((m) => m.id !== "invoice-drafts").map((m) => m.id),
  );
  await engine.publishConfig(owner, a, disabled, 1);
  expect(
    (await engine.snapshot(owner, a)).records.some((x) => x.id === r.id),
  ).toBe(false);
  expect(
    (await engine.exportWorkspace(owner, a)).records.some((x) => x.id === r.id),
  ).toBe(true);
  await expect(
    engine.writeInvoiceDraft(
      owner,
      a,
      { ...amend(r), configRevision: 2 },
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
});
it("keeps void terminal and exact retries historical, with immutable amounts, reasons and authorization evidence", async () => {
  const c = await make(),
    first = await convert(c),
    second = await engine.writeInvoiceDraft(
      owner,
      a,
      amend(first),
      randomUUID(),
    ),
    op = randomUUID();
  const req = {
    kind: "void",
    invoiceId: second.id,
    revision: 2,
    configRevision: 1,
    acknowledgement: invoiceLabel,
    reason: "Voided duplicate fictional requirement",
  };
  const result = await engine.writeInvoiceDraft(owner, a, req, op);
  expect(await engine.writeInvoiceDraft(owner, a, req, op)).toEqual(result);
  await expect(
    engine.writeInvoiceDraft(
      owner,
      a,
      { ...amend(second), revision: 3 },
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
  const s = await engine.snapshot(owner, a);
  expect(s.invoiceVersions.map((x) => x.data.reason)).toEqual([
    "Converted from explicitly reviewed estimate",
    "Corrected fictional quantity",
    req.reason,
  ]);
  expect(
    s.invoiceVersions.map(
      (x) => (x.data.pricing as unknown as EstimatePricing).totalMinor,
    ),
  ).toEqual(["501", "2002", "2002"]);
  expect(s.invoiceVersions.every((x) => x.actor_id === owner.userId)).toBe(
    true,
  );
});
it("rolls back all record, history, links, receipt and audit writes when a financial projection fails", async () => {
  const c = await make(),
    before = await engine.exportWorkspace(owner, a),
    op = randomUUID();
  await admin.query(
    "create function lms_private.test_invoice_failure() returns trigger language plpgsql as $$begin raise exception 'Injected fictional failure' using errcode='23514';end$$;create trigger test_invoice_failure before insert on lms.invoice_versions for each row execute function lms_private.test_invoice_failure()",
  );
  try {
    await expect(convert(c, op)).rejects.toMatchObject({ status: 409 });
    expect(await engine.exportWorkspace(owner, a)).toEqual({
      ...before,
      exportedAt: expect.any(String),
    });
    expect(
      (
        await admin.query(
          "select * from lms.record_operations where operation_id=$1",
          [op],
        )
      ).rows,
    ).toEqual([]);
  } finally {
    await admin.query(
      "drop trigger test_invoice_failure on lms.invoice_versions;drop function lms_private.test_invoice_failure()",
    );
  }
  expect((await convert(c, op)).data.status).toBe("Draft");
});
it("fails invalid monetary corrections atomically without accepting overflow, changed source rates or line IDs", async () => {
  const c = await make(),
    r = await convert(c),
    req = amend(r),
    before = await engine.snapshot(owner, a);
  for (const changed of [
    { quantity: "0" },
    { quantity: "1000000.001" },
    { rateRevision: 2 },
    { id: randomUUID() },
  ]) {
    await expect(
      engine.writeInvoiceDraft(
        owner,
        a,
        {
          ...req,
          pricing: {
            ...req.pricing,
            lines: req.pricing.lines.map((l) => ({ ...l, ...changed })),
          },
        },
        randomUUID(),
      ),
    ).rejects.toThrow();
  }
  expect(await engine.snapshot(owner, a)).toEqual(before);
});
it("requires the stopped-host additive migration and refuses automatic module enablement", async () => {
  await client(legacyName, false, async (c) => {
    await migrate(c, (await loadMigrations()).slice(0, 15));
    await c.query("insert into lms.users values($1,'Legacy fictional owner')", [
      owner.userId,
    ]);
    const id = randomUUID();
    await org(c, id, owner.userId, presets.property);
    const legacy = await connectPostgres({
      connectionString: url(legacyName, true),
    });
    try {
      const e = new Engine(legacy);
      await expect(
        e.publishConfig(
          owner,
          id,
          selectModules(presets.property, [
            ...presets.property.modules.map((m) => m.id),
            "invoice-drafts",
          ]),
          1,
        ),
      ).rejects.toMatchObject({ status: 409 });
      await expect(migrate(c)).rejects.toThrow(/Stop runtime/);
    } finally {
      await legacy.close();
    }
    expect(await migrate(c)).toEqual(["016_invoice_drafts"]);
    expect((await c.query("select * from lms.invoice_versions")).rows).toEqual(
      [],
    );
  });
});
it("preserves exact invoice origins, every financial revision, audits, receipts and organization links after reconnect and quarantined native restore", async () => {
  const c = await make(),
    first = await convert(c),
    corrected = await engine.writeInvoiceDraft(
      owner,
      a,
      amend(first),
      randomUUID(),
    );
  const before = await engine.exportWorkspace(owner, a);
  await db.close();
  db = await connectPostgres({
    connectionString: url(name, true),
    maxConnections: 4,
  });
  engine = new Engine(db);
  expect(
    (await engine.snapshot(owner, a)).records.find((r) => r.id === first.id),
  ).toEqual(corrected);
  const tables = [
    "lms.invoice_origins",
    "lms.invoice_versions",
    "lms.record_operations",
    "lms.record_links",
    "lms.audit_events",
    "lms.config_revisions",
  ];
  const expected: unknown[] = [];
  for (const t of tables)
    expected.push(
      (
        await admin.query(
          `select * from ${t} where organization_id=$1 order by to_jsonb(${t.split(".")[1]})::text`,
          [a],
        )
      ).rows,
    );
  const file = path.join(directory, "invoice-history.dump");
  await backupDatabase(url(), name, file, process.env.LMS_PG_BIN);
  await restoreDatabase(
    url(restoreName),
    restoreName,
    file,
    process.env.LMS_PG_BIN,
  );
  await client(restoreName, false, async (c) => {
    for (const [i, t] of tables.entries())
      expect(
        (
          await c.query(
            `select * from ${t} where organization_id=$1 order by to_jsonb(${t.split(".")[1]})::text`,
            [a],
          )
        ).rows,
      ).toEqual(expected[i]);
    expect(
      (
        await c.query(
          "select data from lms.records where organization_id=$1 and id=$2",
          [a, first.id],
        )
      ).rows[0].data,
    ).toEqual(corrected.data);
    expect(
      (await c.query("select lms_control.is_blocked() as blocked")).rows[0]
        .blocked,
    ).toBe(true);
    await c.query("begin;set local role lms_app");
    await c.query("select set_config('lms.user_id',$1,true)", [other.userId]);
    expect(
      (
        await c.query(
          "select * from lms.invoice_versions where organization_id=$1",
          [a],
        )
      ).rows,
    ).toEqual([]);
    await c.query("rollback");
  });
  await expect(
    connectPostgres({ connectionString: url(restoreName, true) }),
  ).rejects.toThrow(/activation blocked/i);
  expect(await engine.exportWorkspace(owner, a)).toEqual({
    ...before,
    exportedAt: expect.any(String),
  });
});
it.each(["Fixed", "Hourly", "Per unit", "Quantity"])(
  "copies %s service-area pricing, optional extras, discount and explicit manual tax exactly",
  async (mode) => {
    const c = await reviewedEstimate(engine, owner, a, mode, "1001");
    const extra = await engine.saveRecord(owner, a, "services", {
      name: "Fictional optional extra",
      mode: "Fixed",
      unit: "visit",
      kind: "Extra",
      parent: c.service.id,
    });
    const rate = await engine.saveRecord(owner, a, "service-rates", {
      title: "Saved fictional extra",
      service: extra.id,
      zone: c.zone.id,
      amount: "103",
      effective_from: "2026-01-01",
    });
    const open = await engine.saveRecord(
      owner,
      a,
      "estimates",
      { ...c.estimate.data, status: "Draft" },
      c.estimate,
    );
    const changed = await engine.saveRecord(
      owner,
      a,
      "estimates",
      {
        ...open.data,
        pricing: {
          ...savedPricing(open),
          lines: [...savedPricing(open).lines, ...selection(rate, extra).lines],
          discount: { kind: "Percent", value: "1000" },
          tax: {
            mode: "Manual",
            basisPoints: "825",
            label: "Fictional manual tax",
          },
        },
      },
      open,
    );
    const reviewed = await engine.saveRecord(
      owner,
      a,
      "estimates",
      { ...changed.data, status: "Reviewed draft" },
      changed,
    );
    const invoice = await engine.writeInvoiceDraft(
      owner,
      a,
      conversion(reviewed),
      randomUUID(),
    );
    expect(savedPricing(invoice)).toEqual(savedPricing(reviewed));
    expect(savedPricing(invoice).lines.map((l) => l.snapshot.zoneId)).toEqual([
      c.zone.id,
      c.zone.id,
    ]);
    expect(savedPricing(invoice).totalMinor).toBe(
      mode === "Fixed" ? "1076" : "589",
    );
  },
);
