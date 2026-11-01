import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { catalog, selection, savedPricing } from "../helpers/pricing";
import { calculateEstimate, type EstimateInput } from "../../src/core/pricing";
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
  name = "lms_test_pricing_" + suffix,
  restoreName = "lms_restore_pricing_" + suffix,
  legacyName = "lms_test_pricing_legacy_" + suffix;
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
  directory = await mkdtemp(path.join(os.tmpdir(), "lms-pricing-"));
});
beforeEach(async () => {
  await admin.query("truncate lms.organizations cascade");
  a = randomUUID();
  b = randomUUID();
  await org(admin, a, owner.userId, presets.property);
  await org(admin, b, other.userId, presets.cleaning);
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
async function draft(
  orgId = a,
  p = owner,
  industry: "property" | "cleaning" = "property",
) {
  const w = await workflow(engine, p, orgId, industry),
    c = await catalog(engine, p, orgId);
  return {
    ...w,
    ...c,
    data: {
      title: "Fictional internal draft",
      customer: w.customer.id,
      work: w.work.id,
      zone: c.zone.id,
      as_of: "2026-11-06",
      status: "Draft",
      notes: "",
      pricing: selection(c.rate, c.service, "0.5"),
    },
  };
}
async function rawTransaction<T>(
  fn: (c: Client) => Promise<T>,
  actor = owner.userId,
  isolation = "read committed",
) {
  return client(name, true, async (c) => {
    await c.query("begin isolation level " + isolation);
    try {
      await c.query("set local role lms_app");
      await c.query("select set_config('lms.user_id',$1,true)", [actor]);
      const r = await fn(c);
      await c.query("commit");
      return r;
    } catch (e) {
      await c.query("rollback");
      throw e;
    }
  });
}
async function rawInsert(
  c: Client,
  entity: string,
  data: unknown,
  actor = owner.userId,
) {
  return (
    await c.query(
      "insert into lms.records(organization_id,entity,data,config_revision,created_by,updated_by)values($1,$2,$3,1,$4,$4)returning *",
      [a, entity, data, actor],
    )
  ).rows[0];
}
async function rawEstimate(c: Client, data: unknown) {
  const prepared = (
    await c.query("select lms.prepare_estimate($1,$2::jsonb) as data", [
      a,
      data,
    ])
  ).rows[0].data;
  return rawInsert(c, "estimates", prepared);
}
describe("exact internal estimates with native PostgreSQL", () => {
  it("uses the same saved catalog and scoped customer/work/appointment relationships for both industries", async () => {
    for (const [orgId, p, industry] of [
      [a, owner, "property"],
      [b, other, "cleaning"],
    ] as const) {
      const c = await draft(orgId, p, industry),
        appt = await engine.saveRecord(
          p,
          orgId,
          "appointments",
          appointmentData(c),
        );
      const r = await engine.saveRecord(
        p,
        orgId,
        "estimates",
        { ...c.data, appointment: appt.id },
        undefined,
        randomUUID(),
      );
      expect(savedPricing(r)).toMatchObject({
        subtotalMinor: "501",
        totalMinor: "501",
      });
      expect(savedPricing(r).lines[0].snapshot.description).toBe(
        c.service.data.description,
      );
      expect(
        (await engine.snapshot(p, orgId)).estimateVersions.filter(
          (v) => v.record_id === r.id,
        ),
      ).toHaveLength(1);
    }
  });
  it("matches exact integer calculation across fractional rounding, discounts, tax and upper-bound vectors", async () => {
    const c = await draft();
    let rate = c.rate;
    const vectors = [
      {
        amount: "1",
        quantity: "0.5",
        discount: { kind: "None", value: "0" },
        tax: { mode: "None", basisPoints: "0", label: "" },
      },
      {
        amount: "3",
        quantity: "0.5",
        discount: { kind: "Percent", value: "10000" },
        tax: {
          mode: "Manual",
          basisPoints: "10000",
          label: "Fictional test tax",
        },
      },
      {
        amount: "1001",
        quantity: "0.5",
        discount: { kind: "Percent", value: "1000" },
        tax: {
          mode: "Manual",
          basisPoints: "825",
          label: "Fictional test tax",
        },
      },
      {
        amount: "1",
        quantity: "1000000",
        discount: { kind: "Amount", value: "1" },
        tax: { mode: "Manual", basisPoints: "1", label: "Fictional test tax" },
      },
      {
        amount: "999999999999",
        quantity: "1",
        discount: { kind: "None", value: "0" },
        tax: { mode: "None", basisPoints: "0", label: "" },
      },
    ] as const;
    for (const v of vectors) {
      rate = await engine.saveRecord(
        owner,
        a,
        "service-rates",
        { ...rate.data, amount: v.amount },
        rate,
      );
      const input: EstimateInput = {
        ...selection(rate, c.service, v.quantity),
        discount: { ...v.discount },
        tax: { ...v.tax },
      };
      const available = catalogSnapshots(
        (await engine.snapshot(owner, a)).records,
        c.zone.id,
        "2026-11-06",
      );
      const expected = calculateEstimate(
        input,
        snapshotsFor(input, undefined, available),
      );
      const r = await engine.saveRecord(owner, a, "estimates", {
        ...c.data,
        pricing: input,
      });
      for (const key of [
        "subtotalMinor",
        "discountMinor",
        "taxMinor",
        "totalMinor",
      ] as const)
        expect(savedPricing(r)[key]).toBe(expected[key]);
    }
    const bad = selection(rate, c.service, "2");
    await expect(
      engine.saveRecord(owner, a, "estimates", { ...c.data, pricing: bad }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("transactionally rejects competing active rates and allows adjacent dates and independent pricing areas", async () => {
    const c = await draft();
    await engine.archiveRecord(owner, a, c.rate.id, c.rate.revision, true);
    const results = await Promise.allSettled([
      rawTransaction((db) =>
        rawInsert(db, "service-rates", {
          ...c.rate.data,
          title: "Contender A",
        }),
      ),
      rawTransaction((db) =>
        rawInsert(db, "service-rates", {
          ...c.rate.data,
          title: "Contender B",
        }),
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")?.reason).toMatchObject({
      code: "23P01",
      constraint: "exclusive_service_rate",
    });
    await engine.saveRecord(owner, a, "service-rates", {
      ...c.rate.data,
      title: "Adjacent",
      effective_from: "2027-01-01",
      effective_until: "2028-01-01",
    });
    const zone = await engine.saveRecord(owner, a, "pricing-zones", {
      name: "Rural test area",
    });
    const rural = await engine.saveRecord(owner, a, "service-rates", {
      ...c.rate.data,
      title: "Rural",
      zone: zone.id,
      amount: "2500",
    });
    const r = await engine.saveRecord(owner, a, "estimates", {
      ...c.data,
      zone: zone.id,
      pricing: selection(rural, c.service, "2"),
    });
    expect(savedPricing(r).totalMinor).toBe("5000");
  });
  it("deduplicates competing estimate submissions and original retries after catalog changes without duplicate history/audits", async () => {
    const c = await draft(),
      op = randomUUID();
    const result = await Promise.all([
      engine.saveRecord(owner, a, "estimates", c.data, undefined, op),
      engine.saveRecord(owner, a, "estimates", c.data, undefined, op),
    ]);
    expect(result[0].id).toBe(result[1].id);
    await engine.saveRecord(
      owner,
      a,
      "service-rates",
      { ...c.rate.data, amount: "9000" },
      c.rate,
    );
    expect(
      savedPricing(
        await engine.saveRecord(owner, a, "estimates", c.data, undefined, op),
      ).totalMinor,
    ).toBe("501");
    await expect(
      engine.saveRecord(
        owner,
        a,
        "estimates",
        { ...c.data, title: "Different request" },
        undefined,
        op,
      ),
    ).rejects.toMatchObject({ status: 409 });
    const snap = await engine.snapshot(owner, a);
    expect(
      snap.estimateVersions.filter((v) => v.record_id === result[0].id),
    ).toHaveLength(1);
    expect(snap.audit.filter((v) => v.record_id === result[0].id)).toHaveLength(
      1,
    );
  });
  it("orders raw catalog mutations with draft materialization and rejects a frozen repeatable-read price selection", async () => {
    const c = await draft();
    const results = await Promise.allSettled([
      rawTransaction((db) => rawEstimate(db, c.data)),
      rawTransaction((db) =>
        db.query(
          "update lms.records set data=jsonb_set(data,'{amount}','\"2000\"') where organization_id=$1 and id=$2",
          [a, c.rate.id],
        ),
      ),
    ]);
    expect(results[1].status).toBe("fulfilled");
    if (results[0].status === "fulfilled")
      expect(savedPricing(results[0].value).lines[0].snapshot.amountMinor).toBe(
        "1001",
      );
    else expect(results[0].reason.code).toBe("23514");
    const current = (await engine.snapshot(owner, a)).records.find(
      (r) => r.id === c.rate.id,
    )!;
    await client(name, true, async (db) => {
      await db.query("begin isolation level repeatable read");
      await db.query("set local role lms_app");
      await db.query("select set_config('lms.user_id',$1,true)", [
        owner.userId,
      ]);
      await db.query("select * from lms.records where organization_id=$1", [a]);
      await engine.saveRecord(
        owner,
        a,
        "service-rates",
        { ...current.data, amount: "3000" },
        current,
      );
      await expect(
        db.query("select lms.prepare_estimate($1,$2::jsonb)", [
          a,
          { ...c.data, pricing: selection(current, c.service) },
        ]),
      ).rejects.toMatchObject({ code: "40001" });
      await db.query("rollback");
    });
  });
  it("serializes competing edits, retains old prices/descriptions and controls review/reopen/void history", async () => {
    const c = await draft(),
      first = await engine.saveRecord(owner, a, "estimates", c.data);
    const edits = await Promise.allSettled([
      engine.saveRecord(
        owner,
        a,
        "estimates",
        { ...first.data, notes: "A" },
        first,
        randomUUID(),
      ),
      engine.saveRecord(
        owner,
        a,
        "estimates",
        { ...first.data, notes: "B" },
        first,
        randomUUID(),
      ),
    ]);
    expect(edits.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(edits.find((r) => r.status === "rejected")?.reason.status).toBe(409);
    const current = edits.find((r) => r.status === "fulfilled")!.value;
    await engine.saveRecord(
      owner,
      a,
      "service-rates",
      { ...c.rate.data, amount: "8000" },
      c.rate,
    );
    await engine.saveRecord(
      owner,
      a,
      "services",
      { ...c.service.data, description: "New description" },
      c.service,
    );
    const edited = await engine.saveRecord(
      owner,
      a,
      "estimates",
      {
        ...current.data,
        pricing: {
          ...savedPricing(current),
          lines: savedPricing(current).lines.map((l) => ({
            ...l,
            quantity: "2",
          })),
        },
      },
      current,
    );
    expect(savedPricing(edited)).toMatchObject({ totalMinor: "2002" });
    expect(savedPricing(edited).lines[0].snapshot.description).toBe(
      "Original service description",
    );
    const reviewed = await engine.saveRecord(
      owner,
      a,
      "estimates",
      { ...edited.data, status: "Reviewed draft" },
      edited,
    );
    await expect(
      engine.saveRecord(
        owner,
        a,
        "estimates",
        { ...reviewed.data, notes: "Forbidden" },
        reviewed,
      ),
    ).rejects.toMatchObject({ status: 409 });
    const reopened = await engine.saveRecord(
      owner,
      a,
      "estimates",
      { ...reviewed.data, status: "Draft" },
      reviewed,
    );
    const voided = await engine.saveRecord(
      owner,
      a,
      "estimates",
      { ...reopened.data, status: "Void" },
      reopened,
    );
    await expect(
      engine.saveRecord(
        owner,
        a,
        "estimates",
        { ...voided.data, status: "Draft" },
        voided,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await engine.snapshot(owner, a)).estimateVersions.filter(
        (v) => v.record_id === first.id,
      ),
    ).toHaveLength(6);
  });
  it("independently refuses unauthorized/fake snapshots, foreign references and mismatched customer work; history is read-only", async () => {
    const c = await draft(),
      foreign = await draft(b, other, "cleaning");
    for (const p of [staff, viewer]) {
      await expect(
        engine.saveRecord(p, a, "estimates", c.data),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        rawTransaction(
          (db) =>
            db.query("select lms.prepare_estimate($1,$2::jsonb)", [a, c.data]),
          p.userId,
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        rawTransaction(
          (db) =>
            rawInsert(
              db,
              "services",
              {
                name: "Unauthorized",
                mode: "Fixed",
                unit: "job",
                kind: "Service",
              },
              p.userId,
            ),
          p.userId,
        ),
      ).rejects.toMatchObject({ code: "42501" });
    }
    await expect(
      engine.saveRecord(owner, a, "estimates", {
        ...c.data,
        pricing: selection(foreign.rate, foreign.service),
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      engine.saveRecord(owner, a, "estimates", {
        ...c.data,
        customer: foreign.customer.id,
      }),
    ).rejects.toThrow();
    const someone = await engine.saveRecord(owner, a, "customers", {
      name: "Different customer",
    });
    await expect(
      engine.saveRecord(owner, a, "estimates", {
        ...c.data,
        customer: someone.id,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const r = await engine.saveRecord(owner, a, "estimates", c.data);
    await expect(
      engine.saveRecord(
        owner,
        a,
        "tasks",
        { ...c.work.data, customer: someone.id },
        c.work,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      rawTransaction((db) =>
        db.query(
          "update lms.records set data=jsonb_set(data,'{pricing,totalMinor}','\"0\"') where organization_id=$1 and id=$2",
          [a, r.id],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      rawTransaction((db) =>
        db.query(
          "insert into lms.records(organization_id,entity,data,config_revision,created_by,updated_by)values($1,'service-rates',$2,1,$3,$3)",
          [a, { ...c.rate.data, amount: 1 }, owner.userId],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      engine.asUser(owner, (tx) =>
        tx.query("delete from lms.estimate_versions"),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      engine.asUser(owner, (tx) =>
        tx.query("update lms.estimate_lines set snapshot='{}'"),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      (
        await engine.asUser(other, (tx) =>
          tx.query(
            "select * from lms.estimate_versions where organization_id=$1",
            [a],
          ),
        )
      ).rows,
    ).toEqual([]);
  });
  it("retains archived catalog snapshots, rejects new use of inactive prices and rechecks conflicting rate restoration", async () => {
    const c = await draft(),
      r = await engine.saveRecord(owner, a, "estimates", c.data);
    const archived = await engine.archiveRecord(
      owner,
      a,
      c.rate.id,
      c.rate.revision,
      true,
    );
    const service = await engine.archiveRecord(
      owner,
      a,
      c.service.id,
      c.service.revision,
      true,
    );
    const edited = await engine.saveRecord(
      owner,
      a,
      "estimates",
      {
        ...r.data,
        pricing: {
          ...savedPricing(r),
          lines: savedPricing(r).lines.map((l) => ({ ...l, quantity: "1" })),
        },
      },
      r,
    );
    expect(savedPricing(edited).totalMinor).toBe("1001");
    await expect(
      engine.saveRecord(owner, a, "estimates", c.data),
    ).rejects.toMatchObject({ status: 409 });
    await engine.archiveRecord(owner, a, c.service.id, service.revision, false);
    await engine.saveRecord(owner, a, "service-rates", {
      ...c.rate.data,
      title: "Replacement",
    });
    await expect(
      engine.archiveRecord(owner, a, c.rate.id, archived.revision, false),
    ).rejects.toMatchObject({ status: 409 });
    const ar = await engine.archiveRecord(
      owner,
      a,
      edited.id,
      edited.revision,
      true,
    );
    await engine.archiveRecord(owner, a, edited.id, ar.revision, false);
  });
  it("validates extras and manual-tax calculations and rejects invalid discounts or unconfirmed estimates", async () => {
    const c = await draft(),
      extra = await engine.saveRecord(owner, a, "services", {
        name: "Optional extra",
        kind: "Extra",
        parent: c.service.id,
        mode: "Fixed",
        unit: "visit",
      });
    const rate = await engine.saveRecord(owner, a, "service-rates", {
      ...c.rate.data,
      title: "Extra rate",
      service: extra.id,
      amount: "125",
    });
    await expect(
      engine.saveRecord(owner, a, "estimates", {
        ...c.data,
        pricing: selection(rate, extra),
      }),
    ).rejects.toMatchObject({ status: 409 });
    const p = selection(c.rate, c.service, "0.5");
    p.lines.push(selection(rate, extra).lines[0]);
    p.discount = { kind: "Amount", value: "26" };
    p.tax = {
      mode: "Manual",
      basisPoints: "825",
      label: "Fictional manual tax",
    };
    const r = await engine.saveRecord(owner, a, "estimates", {
      ...c.data,
      pricing: p,
    });
    expect(savedPricing(r)).toMatchObject({
      subtotalMinor: "626",
      discountMinor: "26",
      taxMinor: "50",
      totalMinor: "650",
    });
    await expect(
      engine.saveRecord(owner, a, "estimates", {
        ...c.data,
        pricing: { ...p, discount: { kind: "Amount", value: "999999" } },
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      rawTransaction((db) =>
        rawEstimate(db, { ...c.data, pricing: { ...p, acknowledgement: "" } }),
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("upgrades migration 8 with hosts stopped, retaining records, staff assignments and history while refusing premature pricing activation", async () => {
    await client(legacyName, false, async (db) => {
      await migrate(db, (await loadMigrations()).slice(0, 8));
      await db.query(
        "insert into lms.users values($1,'Fictional legacy owner')",
        [owner.userId],
      );
      const config = structuredClone(presets.property);
      config.modules = config.modules.filter((m) => m.id !== "estimates");
      config.entities = config.entities.filter((e) => e.module !== "estimates");
      config.navigation = config.navigation.filter(
        (id) =>
          !["pricing-zones", "services", "service-rates", "estimates"].includes(
            id,
          ),
      );
      const id = randomUUID();
      await org(db, id, owner.userId, config);
      const legacy = await connectPostgres({
        connectionString: url(legacyName, true),
      });
      let before: unknown;
      const snap = async () =>
        (
          await db.query(
            "select (select jsonb_agg(to_jsonb(r))from lms.records r)as records,(select jsonb_agg(to_jsonb(r))from lms.config_revisions r)as config,(select jsonb_agg(to_jsonb(r))from lms.audit_events r)as audit,(select jsonb_agg(to_jsonb(r))from lms.appointment_staff r)as staff",
          )
        ).rows[0];
      try {
        const e = new Engine(legacy),
          w = await workflow(e, owner, id, "property"),
          person = await employee(e, owner, id);
        await enroll(e, owner, id, w.resource, person.profile);
        await e.saveRecord(owner, id, "appointments", appointmentData(w));
        before = await snap();
        await expect(
          e.publishConfig(owner, id, presets.property, 1),
        ).rejects.toMatchObject({
          status: 409,
          message: expect.stringContaining("migration 9"),
        });
        await expect(migrate(db)).rejects.toThrow(/Stop runtime/);
      } finally {
        await legacy.close();
      }
      expect(await migrate(db)).toEqual([
        "009_service_estimates",
        "010_inventory_ledger",
      ]);
      expect(await snap()).toEqual(before);
      expect(
        (await db.query("select * from lms.estimate_versions")).rows,
      ).toEqual([]);
    });
  });
  it("backs up and restores exact snapshots, revisions, scoped line links and operation receipts with activation still blocked", async () => {
    const c = await draft(),
      op = randomUUID(),
      r = await engine.saveRecord(owner, a, "estimates", c.data, undefined, op);
    await engine.saveRecord(
      owner,
      a,
      "estimates",
      { ...r.data, notes: "Retained revision" },
      r,
    );
    await db.close();
    db = await connectPostgres({
      connectionString: url(name, true),
      maxConnections: 4,
    });
    engine = new Engine(db);
    const restarted = await engine.snapshot(owner, a);
    expect(restarted.records.find((x) => x.id === c.rate.id)?.data.amount).toBe(
      "1001",
    );
    expect(
      savedPricing(restarted.records.find((x) => x.id === r.id)!).totalMinor,
    ).toBe("501");
    const file = path.join(directory, "pricing.dump");
    await backupDatabase(url(), name, file, process.env.LMS_PG_BIN);
    await restoreDatabase(
      url(restoreName),
      restoreName,
      file,
      process.env.LMS_PG_BIN,
    );
    await client(restoreName, false, async (db) => {
      expect(
        (
          await db.query(
            "select * from lms.estimate_versions where organization_id=$1 and record_id=$2",
            [a, r.id],
          )
        ).rows,
      ).toHaveLength(2);
      expect(
        (
          await db.query(
            "select * from lms.estimate_lines where organization_id=$1 and estimate_id=$2",
            [a, r.id],
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await db.query(
            "select result from lms.record_operations where organization_id=$1 and operation_id=$2",
            [a, op],
          )
        ).rows[0].result.data.pricing,
      ).toEqual(savedPricing(r));
      expect(
        (await db.query("select lms_control.is_blocked() as blocked")).rows[0]
          .blocked,
      ).toBe(true);
      expect(await migrate(db)).toEqual([]);
    });
    await expect(
      connectPostgres({ connectionString: url(restoreName, true) }),
    ).rejects.toThrow(/activation blocked/i);
  });
});
