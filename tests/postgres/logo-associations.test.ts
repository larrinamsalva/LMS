import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Client } from "pg";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, chmod } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Engine } from "../../src/core/engine";
import { defaultBranding } from "../../src/core/branding";
import { presets } from "../../src/presets";
import { openPrivateLogoStore } from "../../src/server/postgres/logo-assets";
import { connectPostgres } from "../../src/server/postgres/adapter";
import {
  migrate,
  provisionRuntime,
} from "../../src/server/postgres/migrations";
import {
  nativeReadiness,
  nativeRehearsalConfirmation,
} from "../../src/server/postgres/native-readiness";
import { localTarget } from "../../src/server/postgres/targets";
import * as sanitizer from "../../src/server/logo-sanitizer";
import { logoFixture } from "../helpers/logo-fixtures";
import { seedFictional } from "../../scripts/postgres/fixture";
const raw = process.env.LMS_TEST_ADMIN_URL;
if (!raw)
  throw new Error(
    "LMS_TEST_ADMIN_URL is required; association tests never silently skip.",
  );
const controlName = decodeURIComponent(new URL(raw).pathname.slice(1));
if (!controlName.startsWith("lms_test_"))
  throw new Error("Use a disposable fictional control database.");
const control = localTarget(raw, controlName),
  suffix = randomBytes(5).toString("hex"),
  name = "lms_test_associations_" + suffix,
  restoredName = "lms_restore_associations_" + suffix;
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
const exec = promisify(execFile),
  hash = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
type Store = Awaited<ReturnType<typeof openPrivateLogoStore>>;
let cluster: Client,
  admin: Client,
  db: Awaited<ReturnType<typeof connectPostgres>> | undefined,
  store: Store | undefined,
  engine: Engine;
let fixture: Awaited<ReturnType<typeof seedFictional>>,
  directory: string,
  trustFile: string,
  instance: string,
  rawImage: Buffer;
const adminUser = randomUUID(),
  damageOrg = randomUUID(),
  budgetOrg = randomUUID(),
  raceOrg = randomUUID();
const actor = () => ({ userId: fixture.owner }),
  api = () => store!,
  assoc = () => api().associations;
async function fresh() {
  return openPrivateLogoStore({ databaseUrl: url(name, true), trustFile });
}
async function add(org = fixture.property) {
  const s = await api().snapshot(actor(), org);
  return api().store(actor(), org, rawImage, {
    version: 1,
    operationId: randomUUID(),
    expectedRevision: s.revision,
    display: "rectangle",
  });
}
async function change(assetId: string, action: string, org = fixture.property) {
  const s = await api().snapshot(actor(), org),
    a = s.assets.find((a) => a.id === assetId)!;
  return api().change(actor(), org, {
    version: 1,
    operationId: randomUUID(),
    expectedRevision: s.revision,
    assetId,
    assetRevision: a.revision,
    action,
  });
}
async function selected(org = fixture.property) {
  const a = await add(org);
  await change(a.assetId, "select", org);
  return a.assetId;
}
async function review(
  mode = "image",
  historyRevision: number | null = null,
  org = fixture.property,
) {
  return assoc().review(actor(), org, {
    mode,
    display: mode === "image" ? "rectangle" : null,
    historyRevision,
  });
}
const command = (review: unknown) => ({
  format: "lms-private-logo-association-command",
  version: 1,
  operationId: randomUUID(),
  review,
  confirmed: true,
});
async function bind(org = fixture.property) {
  return assoc().apply(actor(), org, command(await review("image", null, org)));
}
async function protectedRows() {
  return (
    await admin.query(
      "select * from (select 'record' kind,to_jsonb(r) data from lms.records r union all select 'config',to_jsonb(c) from lms.config_revisions c union all select 'audit',to_jsonb(a) from lms.audit_events a where entity<>'private-logo-association') retained order by kind,data::text",
    )
  ).rows;
}
beforeAll(async () => {
  cluster = new Client({ connectionString: control.toString() });
  await cluster.connect();
  for (const n of [name, restoredName])
    await cluster.query(`create database "${n}"`);
  admin = new Client({ connectionString: url() });
  await admin.connect();
  await migrate(admin);
  await provisionRuntime(admin, url(name, true));
  fixture = await seedFictional(admin, url(name, true));
  await admin.query("select set_config('lms.user_id',$1,false)", [
    fixture.owner,
  ]);
  await admin.query(
    "insert into lms.users values($1,'Fictional logo association admin')",
    [adminUser],
  );
  await admin.query("insert into lms.memberships values($1,$2,'admin')", [
    fixture.property,
    adminUser,
  ]);
  for (const org of [damageOrg, budgetOrg, raceOrg]) {
    await admin.query(
      "insert into lms.organizations values($1,'Fictional association lab')",
      [org],
    );
    await admin.query("insert into lms.memberships values($1,$2,'owner')", [
      org,
      fixture.owner,
    ]);
    await admin.query(
      "insert into lms.config_revisions(organization_id,revision,document,created_by) values($1,1,$2,$3)",
      [
        org,
        {
          ...presets.property,
          schemaVersion: 2,
          branding: defaultBranding("property"),
        },
        fixture.owner,
      ],
    );
  }
  instance = (await admin.query("select instance_id from lms_control.state"))
    .rows[0].instance_id;
  directory = await mkdtemp(path.join(os.tmpdir(), "lms-associations-"));
  await chmod(directory, 0o700);
  trustFile = path.join(directory, "trust.json");
  await writeFile(
    trustFile,
    JSON.stringify({
      format: "lms-native-readiness-trust",
      version: 1,
      environment: "association-lab",
      fictionalOnly: true,
      maintenanceRole: decodeURIComponent(control.username),
      source: {
        database: name,
        instanceId: instance,
        organizations: [
          fixture.property,
          fixture.cleaning,
          damageOrg,
          budgetOrg,
          raceOrg,
        ],
      },
      target: { database: restoredName },
    }),
    { mode: 0o600 },
  );
  db = await connectPostgres({ connectionString: url(name, true) });
  engine = new Engine(db);
  rawImage = await logoFixture();
  store = await fresh();
  await engine.publishConfig(
    actor(),
    fixture.property,
    {
      ...presets.property,
      schemaVersion: 2,
      branding: defaultBranding("property"),
    },
    1,
  );
});
afterAll(async () => {
  vi.restoreAllMocks();
  await store?.close();
  await db?.close();
  await admin?.end();
  if (cluster) {
    for (const n of [name, restoredName])
      await cluster.query(`drop database if exists "${n}" with (force)`);
    await cluster.end();
  }
  if (directory) await rm(directory, { recursive: true, force: true });
  rawImage?.fill(0);
});
it("persists an explicitly associated image and history across independent processes and reconnection", async () => {
  const env = {
      ...process.env,
      LMS_TEST_RUNTIME_URL: url(name, true),
      LMS_TEST_LOGO_TRUST: trustFile,
    },
    args = ["--import=tsx", "scripts/postgres/logo-association-probe.ts"];
  const written = JSON.parse(
    (
      await exec(
        process.execPath,
        [...args, "write", fixture.owner, fixture.property],
        { env },
      )
    ).stdout,
  );
  const read = JSON.parse(
    (
      await exec(
        process.execPath,
        [...args, "read", fixture.owner, fixture.property],
        { env },
      )
    ).stdout,
  );
  expect(read).toEqual(written);
  expect(read.association.configurationRevision).toBe(2);
  expect(read.association.asset.sha256).toBe(read.sha256);
  await store!.close();
  store = await fresh();
  const current = await assoc().read(actor(), fixture.property);
  expect(current.inspection.status).toBe("active");
  expect(hash(current.logo!.bytes)).toBe(read.sha256);
  current.logo!.bytes.fill(0);
  expect(await assoc().history(actor(), fixture.property)).toHaveLength(1);
});
it("does not associate uploads/selections implicitly; replacing the selector preserves the retained published image", async () => {
  const before = await protectedRows(),
    a = await assoc().inspect(actor(), fixture.property);
  await selected();
  const read = await assoc().read({ userId: fixture.viewer }, fixture.property);
  expect(read.inspection.association).toEqual(a.association);
  expect(read.logo!.metadata.id).toBe(a.association!.asset!.id);
  read.logo!.bytes.fill(0);
  const replaced = await bind();
  expect(replaced.asset!.id).not.toBe(a.association!.asset!.id);
  expect(await protectedRows()).toEqual(before);
});
it("handles exact retries without duplicate history/audits, and rejects conflicting or other-actor retries", async () => {
  const request = command(await review()),
    first = await assoc().apply(actor(), fixture.property, request),
    before = await assoc().history(actor(), fixture.property);
  expect(await assoc().apply(actor(), fixture.property, request)).toEqual(
    first,
  );
  await expect(
    assoc().apply(actor(), fixture.property, {
      ...request,
      review: { ...(request.review as object), display: "square" },
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    assoc().apply({ userId: adminUser }, fixture.property, request),
  ).rejects.toMatchObject({ status: 409 });
  expect(await assoc().history(actor(), fixture.property)).toEqual(before);
  expect(
    (
      await admin.query(
        "select count(*)::int n from lms.audit_events where entity='private-logo-association' and after_data->>'operationId'=$1",
        [request.operationId],
      )
    ).rows[0].n,
  ).toBe(1);
});
it("serializes competing bindings and refuses reviews made before selection changes", async () => {
  const request = await review();
  const results = await Promise.allSettled([
    assoc().apply(actor(), fixture.property, command(request)),
    assoc().apply(actor(), fixture.property, command(request)),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  const stale = await review();
  await selected();
  await expect(
    assoc().apply(actor(), fixture.property, command(stale)),
  ).rejects.toMatchObject({ status: 409 });
});
it("falls back on publication and rollback, retaining old associations until explicit current-revision restoration review", async () => {
  const old = await assoc().inspect(actor(), fixture.property),
    r = await review(),
    original = (await engine.snapshot(actor(), fixture.property)).config;
  await engine.publishConfig(
    actor(),
    fixture.property,
    { ...original.document, name: "Fictional renamed property" },
    original.revision,
  );
  expect((await assoc().read(actor(), fixture.property)).logo).toBeNull();
  expect((await assoc().inspect(actor(), fixture.property)).status).toBe(
    "configuration-changed",
  );
  await expect(
    assoc().apply(actor(), fixture.property, command(r)),
  ).rejects.toMatchObject({ status: 409 });
  const bound = await bind();
  await engine.publishConfig(
    actor(),
    fixture.property,
    original.document,
    original.revision + 1,
    original.revision,
  );
  expect((await assoc().read(actor(), fixture.property)).logo).toBeNull();
  const renewed = await assoc().apply(
    actor(),
    fixture.property,
    command(await review("image", bound.revision)),
  );
  expect(renewed.restoredFrom).toBe(bound.revision);
  expect(renewed.configurationRevision).toBe(original.revision + 2);
  expect(
    (await assoc().history(actor(), fixture.property)).some(
      (a) => a.revision === old.revision,
    ),
  ).toBe(true);
});
it("serializes binding with both Engine and restricted direct-SQL publication without resurrecting an old image", async () => {
  for (const route of ["engine", "restricted-sql"]) {
    const r = await review(),
      current = (await engine.snapshot(actor(), fixture.property)).config;
    const proposal = {
      ...current.document,
      name: "Fictional concurrent publication " + route,
    };
    const publication =
      route === "engine"
        ? engine.publishConfig(
            actor(),
            fixture.property,
            proposal,
            current.revision,
          )
        : engine.asUser(actor(), (tx) =>
            tx.query(
              "insert into lms.config_revisions(organization_id,revision,document,created_by) values($1,$2,$3,$4)",
              [fixture.property, current.revision + 1, proposal, fixture.owner],
            ),
          );
    const results = await Promise.allSettled([
      publication,
      assoc().apply(actor(), fixture.property, command(r)),
    ]);
    expect(results[0].status).toBe("fulfilled");
    if (results[1].status === "rejected")
      expect(results[1].reason).toMatchObject({ status: 409 });
    const state = await assoc().read(actor(), fixture.property);
    expect(state.inspection.configurationRevision).toBe(current.revision + 1);
    expect(state.logo).toBeNull();
    expect(state.inspection.status).toBe("configuration-changed");
    await bind();
  }
});
it("reverts deliberately to a built-in mark and retains referenced images against retirement", async () => {
  const a = (await assoc().inspect(actor(), fixture.property)).association!;
  await assoc().apply(
    actor(),
    fixture.property,
    command(await review("builtin")),
  );
  expect((await assoc().read(actor(), fixture.property)).logo).toBeNull();
  await change(a.asset!.id, "unselect");
  await expect(change(a.asset!.id, "retire")).rejects.toMatchObject({
    status: 409,
  });
  await expect(review("image", a.revision)).rejects.toMatchObject({
    status: 409,
  });
  await change(a.asset!.id, "restore");
  await change(a.asset!.id, "select");
  const restored = await assoc().apply(
    actor(),
    fixture.property,
    command(await review("image", a.revision)),
  );
  expect(restored.asset!.id).toBe(a.asset!.id);
  expect(restored.asset!.revision).toBeGreaterThan(a.asset!.revision);
});
it("enforces roles, organization isolation, append-only history, scoped foreign keys and no direct byte access", async () => {
  const r = await review();
  for (const userId of [fixture.viewer, fixture.staff, fixture.other]) {
    await expect(
      assoc().review({ userId }, fixture.property, {
        mode: "image",
        display: "square",
        historyRevision: null,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      assoc().apply({ userId }, fixture.property, command(r)),
    ).rejects.toThrow();
  }
  await expect(
    assoc().inspect(actor(), fixture.cleaning),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    assoc().apply(
      actor(),
      fixture.property,
      command({ ...r, organizationId: fixture.cleaning }),
    ),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    assoc().apply(
      actor(),
      fixture.property,
      command({ ...r, asset: { ...r.asset!, id: randomUUID() } }),
    ),
  ).rejects.toMatchObject({ status: 403 });
  for (const sql of [
    "delete from lms.logo_associations",
    "update lms.logo_association_states set revision=0",
    "delete from lms.logo_association_receipts",
    "truncate lms.logo_associations",
    "select content from lms.logo_assets",
  ])
    await expect(
      engine.asUser(actor(), (tx) => tx.exec(sql)),
    ).rejects.toMatchObject({ code: "42501" });
  const hidden = await engine.asUser({ userId: fixture.other }, (tx) =>
    tx.query("select * from lms.logo_associations where organization_id=$1", [
      fixture.property,
    ]),
  );
  expect(hidden.rows).toHaveLength(0);
  const secure = (
    await admin.query(
      "select relname,relrowsecurity,relforcerowsecurity from pg_class where oid=any($1::regclass[])",
      [
        [
          "lms.logo_associations",
          "lms.logo_association_states",
          "lms.logo_association_receipts",
        ],
      ],
    )
  ).rows;
  expect(secure).toHaveLength(3);
  expect(secure.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(
    true,
  );
});
it("rechecks revoked membership after native processing before any binding, receipt or audit commits", async () => {
  const principal = { userId: adminUser },
    r = await assoc().review(principal, fixture.property, {
      mode: "image",
      display: "square",
      historyRevision: null,
    });
  const before = await assoc().history(actor(), fixture.property),
    original = sanitizer.sanitizeLogo;
  let entered!: () => void, proceed!: () => void;
  const gate = new Promise<void>((resolve) => (proceed = resolve)),
    started = new Promise<void>((resolve) => (entered = resolve));
  const spy = vi
    .spyOn(sanitizer, "sanitizeLogo")
    .mockImplementationOnce(async (bytes) => {
      entered();
      await gate;
      return original(bytes);
    });
  const pending = assoc().apply(principal, fixture.property, command(r));
  const rejected = expect(pending).rejects.toMatchObject({ status: 403 });
  await started;
  try {
    await admin.query(
      "delete from lms.memberships where organization_id=$1 and user_id=$2",
      [fixture.property, adminUser],
    );
  } finally {
    proceed();
  }
  await rejected;
  spy.mockRestore();
  expect(await assoc().history(actor(), fixture.property)).toEqual(before);
  await expect(assoc().read(principal, fixture.property)).rejects.toMatchObject(
    { status: 403 },
  );
});
it("rejects repeatable-read snapshots after credential-independent configuration and selection changes", async () => {
  const r = await review(),
    c = new Client({ connectionString: url(name, true) });
  await c.connect();
  try {
    await c.query(
      "begin isolation level repeatable read;set local role lms_app",
    );
    await c.query("select set_config('lms.user_id',$1,true)", [fixture.owner]);
    await c.query(
      "select revision from lms.config_revisions where organization_id=$1",
      [fixture.property],
    );
    const current = (await engine.snapshot(actor(), fixture.property)).config;
    await engine.publishConfig(
      actor(),
      fixture.property,
      { ...current.document, name: "Fictional concurrent branding" },
      current.revision,
    );
    await expect(
      c.query("select lms.logo_association_operation($1,$2,$3)", [
        fixture.property,
        instance,
        command(r),
      ]),
    ).rejects.toMatchObject({ code: "40001" });
    await c.query("rollback");
    const r2 = await review();
    await c.query(
      "begin isolation level repeatable read;set local role lms_app",
    );
    await c.query("select set_config('lms.user_id',$1,true)", [fixture.owner]);
    await c.query(
      "select revision from lms.logo_asset_states where organization_id=$1",
      [fixture.property],
    );
    await selected();
    await expect(
      c.query("select lms.logo_association_operation($1,$2,$3)", [
        fixture.property,
        instance,
        command(r2),
      ]),
    ).rejects.toMatchObject({ code: "40001" });
    await c.query("rollback");
  } finally {
    await c.query("rollback");
    await c.end();
  }
  await bind();
});
it("rolls back a failed association transaction without partial cursor, history, receipt or audit effects", async () => {
  const before = await assoc().history(actor(), fixture.property),
    r = await review(),
    request = command(r);
  await admin.query(`create function lms_private.test_association_failure() returns trigger language plpgsql as $$begin raise exception 'fictional interrupted write' using errcode='53100';end;$$;
    create trigger test_association_failure before update on lms.logo_association_states for each row execute function lms_private.test_association_failure()`);
  try {
    await expect(
      assoc().apply(actor(), fixture.property, request),
    ).rejects.toMatchObject({ status: 503 });
  } finally {
    await admin.query(
      "drop trigger test_association_failure on lms.logo_association_states;drop function lms_private.test_association_failure()",
    );
  }
  expect(await assoc().history(actor(), fixture.property)).toEqual(before);
  expect(
    (
      await admin.query(
        "select 1 from lms.logo_association_receipts where operation_id=$1",
        [request.operationId],
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await admin.query(
        "select 1 from lms.audit_events where after_data->>'operationId'=$1",
        [request.operationId],
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (await assoc().apply(actor(), fixture.property, request)).revision,
  ).toBe(before.length + 1);
});
it("does not support schema-1 image association or unsafe contract extensions and does not silently upgrade portable branding", async () => {
  await expect(
    assoc().review({ userId: fixture.other }, fixture.cleaning, {
      mode: "image",
      display: "square",
      historyRevision: null,
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    (await assoc().read({ userId: fixture.other }, fixture.cleaning)).inspection
      .status,
  ).toBe("unbranded");
  const r = await review();
  for (const bad of [
    { ...command(r), confirmed: false },
    { ...command(r), sql: "select 1" },
    command({ ...r, display: "url(https://invalid.test)" }),
    command({ ...r, version: 2 }),
  ])
    await expect(
      assoc().apply(actor(), fixture.property, bad),
    ).rejects.toThrow();
});
it("falls back on blocked assets and refuses retired/missing images without destroying retained associations", async () => {
  const id = await selected(damageOrg);
  await bind(damageOrg);
  await change(id, "unselect", damageOrg);
  await change(id, "block", damageOrg);
  expect((await assoc().read(actor(), damageOrg)).inspection.status).toBe(
    "asset-unavailable",
  );
  await expect(review("image", 1, damageOrg)).rejects.toMatchObject({
    status: 409,
  });
  const retired = await add(damageOrg);
  await change(retired.assetId, "release", damageOrg);
  await change(retired.assetId, "retire", damageOrg);
  await expect(
    change(retired.assetId, "select", damageOrg),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    api().read(actor(), damageOrg, randomUUID(), 1),
  ).rejects.toMatchObject({ status: 403 });
  expect(await assoc().history(actor(), damageOrg)).toHaveLength(1);
});
it("refuses administrator-damaged sanitizer output and safely restores the original test fixture before backup", async () => {
  const id = await selected(damageOrg);
  await bind(damageOrg);
  const row = (
      await admin.query(
        "select content from lms.logo_assets where organization_id=$1 and id=$2",
        [damageOrg, id],
      )
    ).rows[0],
    damaged = Buffer.from(row.content);
  damaged[damaged.length - 9] ^= 1;
  async function replace(bytes: Buffer) {
    await admin.query(
      "alter table lms.logo_assets disable trigger logo_asset_guard;alter table lms.logo_assets disable trigger logo_event",
    );
    try {
      await admin.query(
        "update lms.logo_assets set content=$3,sha256=encode(sha256($3::bytea),'hex') where organization_id=$1 and id=$2",
        [damageOrg, id, bytes],
      );
    } finally {
      await admin.query(
        "alter table lms.logo_assets enable trigger logo_asset_guard;alter table lms.logo_assets enable trigger logo_event",
      );
    }
  }
  try {
    await replace(damaged);
    const state = await assoc().read(actor(), damageOrg);
    expect(state.logo).toBeNull();
    expect(state.inspection.status).toBe("asset-unavailable");
  } finally {
    await replace(row.content);
    row.content.fill(0);
    damaged.fill(0);
  }
  const good = await assoc().read(actor(), damageOrg);
  expect(good.logo).not.toBeNull();
  good.logo!.bytes.fill(0);
});
it("rejects a retirement snapshot older than an organization's first binding without losing references or pending history", async () => {
  const assetId = await selected(raceOrg),
    s = await api().snapshot(actor(), raceOrg),
    a = s.assets.find((a) => a.id === assetId)!;
  expect((await assoc().inspect(actor(), raceOrg)).revision).toBe(0);
  const c = new Client({ connectionString: url(name, true) });
  await c.connect();
  const unselectId = randomUUID(),
    retireId = randomUUID();
  try {
    await c.query(
      "begin isolation level repeatable read;set local role lms_app",
    );
    await c.query("select set_config('lms.user_id',$1,true)", [fixture.owner]);
    await c.query(
      "select revision from lms.logo_association_states where organization_id=$1",
      [raceOrg],
    );
    await bind(raceOrg);
    await c.query("select lms.logo_operation($1,$2,$3,null)", [
      raceOrg,
      instance,
      {
        version: 1,
        operationId: unselectId,
        expectedRevision: s.revision,
        assetId,
        assetRevision: a.revision,
        action: "unselect",
      },
    ]);
    await expect(
      c.query("select lms.logo_operation($1,$2,$3,null)", [
        raceOrg,
        instance,
        {
          version: 1,
          operationId: retireId,
          expectedRevision: s.revision + 1,
          assetId,
          assetRevision: a.revision + 1,
          action: "retire",
        },
      ]),
    ).rejects.toMatchObject({ code: "40001" });
    await c.query("rollback");
  } finally {
    await c.query("rollback");
    await c.end();
  }
  expect(await api().snapshot(actor(), raceOrg)).toEqual(s);
  expect(
    (
      await admin.query(
        "select 1 from lms.logo_asset_receipts where organization_id=$1 and operation_id=any($2::uuid[])",
        [raceOrg, [unselectId, retireId]],
      )
    ).rows,
  ).toHaveLength(0);
  expect(await assoc().history(actor(), raceOrg)).toHaveLength(1);
  const current = await assoc().read(actor(), raceOrg);
  expect(current.inspection.status).toBe("active");
  current.logo!.bytes.fill(0);
});
it("bounds retained association history and reserves an explicit built-in fallback without purging referenced bytes", async () => {
  await selected(budgetOrg);
  for (let i = 0; i < 128; i++) await bind(budgetOrg);
  await expect(bind(budgetOrg)).rejects.toMatchObject({ status: 409 });
  await assoc().apply(
    actor(),
    budgetOrg,
    command(await review("builtin", null, budgetOrg)),
  );
  expect(await assoc().history(actor(), budgetOrg)).toHaveLength(129);
  expect((await assoc().read(actor(), budgetOrg)).logo).toBeNull();
});
it("preserves exact association/history/receipt/PNG bytes in native backup and quarantined restore while source data stays unchanged and activation refuses", async () => {
  const query =
      "select organization_id,revision,to_jsonb(a) as data from lms.logo_associations a order by organization_id,revision",
    assetQuery =
      "select organization_id,id,revision,state,sha256,encode(sha256(content),'hex') as actual from lms.logo_assets order by organization_id,id";
  const associations = (await admin.query(query)).rows,
    assets = (await admin.query(assetQuery)).rows,
    protectedBefore = await protectedRows();
  const receipts = (
    await admin.query(
      "select * from lms.logo_association_receipts order by organization_id,operation_id",
    )
  ).rows;
  await store!.close();
  store = undefined;
  await db!.close();
  db = undefined;
  await admin.end();
  const result = await nativeReadiness({
    mode: "rehearse",
    trustFile,
    sourceUrl: url(),
    targetUrl: url(restoredName),
    workDirectory: directory,
    confirmation: nativeRehearsalConfirmation,
    binDirectory: process.env.LMS_PG_BIN,
  });
  expect(result.result).toBe("rehearsal-complete");
  expect(result.backupReadiness).toBe("verified-fictional-round-trip");
  expect(result.versions.source.migration).toBe(14);
  for (const secret of [
    assets[0].id,
    assets[0].sha256,
    rawImage.toString("base64"),
    "Durable Fictional Customer",
  ])
    expect(JSON.stringify(result)).not.toContain(secret);
  const copy = new Client({ connectionString: url(restoredName) });
  await copy.connect();
  try {
    expect((await copy.query(query)).rows).toEqual(associations);
    expect((await copy.query(assetQuery)).rows).toEqual(assets);
    expect(
      (
        await copy.query(
          "select * from lms.logo_association_receipts order by organization_id,operation_id",
        )
      ).rows,
    ).toEqual(receipts);
    expect(
      (await copy.query("select blocked from lms_control.state")).rows[0]
        .blocked,
    ).toBe(true);
    await copy.query("begin;set local role lms_app");
    await copy.query("select set_config('lms.user_id',$1,true)", [
      fixture.owner,
    ]);
    await expect(
      copy.query("select lms.logo_association_inspect($1,$2)", [
        fixture.property,
        instance,
      ]),
    ).rejects.toMatchObject({ code: "55000" });
    await copy.query("rollback");
  } finally {
    await copy.end();
  }
  await expect(
    connectPostgres({ connectionString: url(restoredName, true) }),
  ).rejects.toThrow(/blocked|quarantine/i);
  await expect(
    openPrivateLogoStore({ databaseUrl: url(restoredName, true), trustFile }),
  ).rejects.toThrow();
  admin = new Client({ connectionString: url() });
  await admin.connect();
  expect((await admin.query(query)).rows).toEqual(associations);
  expect((await admin.query(assetQuery)).rows).toEqual(assets);
  expect(await protectedRows()).toEqual(protectedBefore);
  store = await fresh();
  const read = await assoc().read(actor(), fixture.property);
  expect(read.inspection.status).toBe("active");
  expect(hash(read.logo!.bytes)).toBe(
    read.inspection.association!.asset!.sha256,
  );
  read.logo!.bytes.fill(0);
});
