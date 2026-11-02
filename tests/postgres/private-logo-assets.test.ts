import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Client } from "pg";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, chmod, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { Engine } from "../../src/core/engine";
import { presets } from "../../src/presets";
import { planForConfig, brandBuildPlan } from "../../src/core/buildplan";
import { defaultBranding } from "../../src/core/branding";
import { createBlueprintPackage } from "../../src/core/blueprint";
import { createLogoCompanion } from "../../src/core/logo-companion";
import { openPrivateLogoStore } from "../../src/server/postgres/logo-assets";
import { connectPostgres } from "../../src/server/postgres/adapter";
import {
  migrate,
  loadMigrations,
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
    "LMS_TEST_ADMIN_URL is required. Durable image tests never silently skip.",
  );
const controlName = decodeURIComponent(new URL(raw).pathname.slice(1));
if (!controlName.startsWith("lms_test_"))
  throw new Error("Use an explicit disposable fictional control database.");
const control = localTarget(raw, controlName),
  suffix = randomBytes(5).toString("hex"),
  name = "lms_test_logos_" + suffix,
  restoredName = "lms_restore_logos_" + suffix;
const names = [name, restoredName];
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
  hash = (p: Uint8Array) => createHash("sha256").update(p).digest("hex");
type Store = Awaited<ReturnType<typeof openPrivateLogoStore>>;
let cluster: Client,
  admin: Client,
  db: Awaited<ReturnType<typeof connectPostgres>> | undefined,
  store: Store | undefined;
let fixture: Awaited<ReturnType<typeof seedFictional>>,
  engine: Engine,
  trustFile: string,
  directory: string,
  trust: Record<string, unknown>;
const countOrg = randomUUID(),
  bytesOrg = randomUUID(),
  budgetOrg = randomUUID(),
  damageOrg = randomUUID(),
  adminUser = randomUUID();
let firstId: string,
  firstHash: string,
  before: unknown,
  otherBefore: unknown,
  rawImage: Buffer;
const actor = () => ({ userId: fixture.owner }),
  api = () => store!;
const command = (revision: number, display = "square") => ({
  version: 1,
  operationId: randomUUID(),
  expectedRevision: revision,
  display,
});
async function fresh() {
  return openPrivateLogoStore({ databaseUrl: url(name, true), trustFile });
}
async function add(org: string, bytes = rawImage, who = actor()) {
  const state = await api().snapshot(who, org);
  return api().store(who, org, bytes, command(state.revision));
}
async function change(org: string, assetId: string, action: string) {
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
beforeAll(async () => {
  cluster = new Client({ connectionString: control.toString() });
  await cluster.connect();
  for (const n of names) await cluster.query(`create database "${n}"`);
  admin = new Client({ connectionString: url() });
  await admin.connect();
  await migrate(admin);
  await provisionRuntime(admin, url(name, true));
  fixture = await seedFictional(admin, url(name, true));
  await admin.query(
    "insert into lms.users values($1,'Fictional private asset administrator')",
    [adminUser],
  );
  await admin.query("insert into lms.memberships values($1,$2,'admin')", [
    fixture.property,
    adminUser,
  ]);
  await admin.query("select set_config('lms.user_id',$1,false)", [
    fixture.owner,
  ]);
  for (const org of [countOrg, bytesOrg, budgetOrg, damageOrg]) {
    await admin.query(
      "insert into lms.organizations values($1,'Fictional private image lab')",
      [org],
    );
    await admin.query("insert into lms.memberships values($1,$2,'owner')", [
      org,
      fixture.owner,
    ]);
    await admin.query(
      "insert into lms.config_revisions(organization_id,revision,document,created_by) values($1,1,$2,$3)",
      [org, presets.property, fixture.owner],
    );
  }
  const instance = (
    await admin.query("select instance_id from lms_control.state")
  ).rows[0].instance_id;
  directory = await mkdtemp(path.join(os.tmpdir(), "lms-private-assets-"));
  await chmod(directory, 0o700);
  trustFile = path.join(directory, "trust.json");
  trust = {
    format: "lms-native-readiness-trust",
    version: 1,
    environment: "private-logo-lab",
    fictionalOnly: true,
    maintenanceRole: decodeURIComponent(control.username),
    source: {
      database: name,
      instanceId: instance,
      organizations: [
        fixture.property,
        fixture.cleaning,
        countOrg,
        bytesOrg,
        budgetOrg,
        damageOrg,
      ],
    },
    target: { database: restoredName },
  };
  await writeFile(trustFile, JSON.stringify(trust), { mode: 0o600 });
  db = await connectPostgres({ connectionString: url(name, true) });
  engine = new Engine(db);
  before = await engine.snapshot(actor(), fixture.property);
  otherBefore = await engine.snapshot(
    { userId: fixture.other },
    fixture.cleaning,
  );
  rawImage = await logoFixture();
  store = await fresh();
});
afterAll(async () => {
  vi.restoreAllMocks();
  await store?.close();
  await db?.close();
  await admin?.end();
  if (cluster) {
    for (const n of names)
      await cluster.query(`drop database if exists "${n}" with (force)`);
    await cluster.end();
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});
it("persists sanitized image bytes across independent application processes and PostgreSQL reconnection", async () => {
  const operation = randomUUID(),
    env = {
      ...process.env,
      LMS_TEST_RUNTIME_URL: url(name, true),
      LMS_TEST_LOGO_TRUST: trustFile,
    };
  const args = ["--import=tsx", "scripts/postgres/logo-probe.ts"];
  const written = JSON.parse(
    (
      await exec(
        process.execPath,
        [...args, "write", fixture.owner, fixture.property, operation],
        { env },
      )
    ).stdout,
  );
  firstId = written.assetId;
  expect(written).toMatchObject({
    action: "store",
    revision: 1,
    assetRevision: 1,
  });
  const clean = await sanitizer.sanitizeLogo(rawImage);
  firstHash = hash(clean.bytes);
  const read = JSON.parse(
    (
      await exec(
        process.execPath,
        [...args, "read", fixture.owner, fixture.property, firstId, "1"],
        { env },
      )
    ).stdout,
  );
  expect(read).toEqual({
    id: firstId,
    revision: 1,
    sha256: firstHash,
    bytes: clean.bytes.length,
  });
  const one = await api().read(actor(), fixture.property, firstId, 1);
  expect(one.bytes).toEqual(new Uint8Array(clean.bytes));
  await store!.close();
  store = await fresh();
  expect(
    (await api().read(actor(), fixture.property, firstId, 1)).bytes,
  ).toEqual(one.bytes);
  expect(
    (await api().snapshot(actor(), fixture.property)).selectedId,
  ).toBeNull();
  expect(await engine.snapshot(actor(), fixture.property)).toEqual(before);
});
it("uses forced RLS, narrow SQL privileges, owner/admin management and authorized selected-member reads", async () => {
  const principal = { userId: fixture.staff };
  for (const userId of [fixture.staff, fixture.viewer, randomUUID()])
    await expect(
      api().store({ userId }, fixture.property, rawImage, command(1)),
    ).rejects.toMatchObject({ status: 403 });
  await expect(
    api().read(principal, fixture.property, firstId, 1),
  ).rejects.toMatchObject({ status: 403 });
  await change(fixture.property, firstId, "select");
  expect(
    hash((await api().read(principal, fixture.property, firstId, 2)).bytes),
  ).toBe(firstHash);
  const staged = await add(fixture.property, rawImage, { userId: adminUser });
  await expect(
    api().read(principal, fixture.property, staged.assetId, 1),
  ).rejects.toMatchObject({ status: 403 });
  const read = await api().snapshot(principal, fixture.property);
  expect(read.assets).toHaveLength(1);
  expect(read.canManage).toBe(false);
  await expect(
    api().history(principal, fixture.property),
  ).rejects.toMatchObject({ status: 403 });
  for (const statement of [
    "select content from lms.logo_assets",
    "update lms.logo_assets set revision=revision+1",
    "delete from lms.logo_assets",
    "delete from lms.logo_asset_history",
    "update lms.logo_asset_receipts set result='{}'",
    "truncate lms.logo_assets",
  ])
    await expect(
      engine.asUser(actor(), (tx) => tx.exec(statement)),
    ).rejects.toMatchObject({ code: "42501" });
  const forced = (
    await admin.query(
      "select relrowsecurity,relforcerowsecurity from pg_class where oid=any($1::regclass[])",
      [
        [
          "lms.logo_assets",
          "lms.logo_asset_states",
          "lms.logo_asset_history",
          "lms.logo_asset_receipts",
        ],
      ],
    )
  ).rows;
  expect(forced).toHaveLength(4);
  expect(forced.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(
    true,
  );
});
it("rejects cross-organization IDs, unknown identities, stale versions and missing assets without privilege escalation", async () => {
  const s = await api().snapshot(actor(), fixture.property);
  await expect(api().snapshot(actor(), fixture.cleaning)).rejects.toMatchObject(
    { status: 403 },
  );
  await expect(
    api().read({ userId: fixture.other }, fixture.cleaning, firstId, 2),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    api().read(actor(), fixture.property, randomUUID(), 1),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    api().read(actor(), fixture.property, firstId, 1),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    api().change(actor(), fixture.property, {
      version: 2,
      operationId: randomUUID(),
      expectedRevision: s.revision,
      action: "unselect",
      assetId: firstId,
      assetRevision: 2,
    }),
  ).rejects.toThrow();
  expect(await api().snapshot(actor(), fixture.property)).toEqual(s);
});
it("records exact successful retries and rejects changed payloads without duplicate assets or history", async () => {
  const s = await api().snapshot(actor(), fixture.property),
    request = command(s.revision),
    original = await api().store(actor(), fixture.property, rawImage, request);
  const history = await api().history(actor(), fixture.property);
  expect(
    await api().store(actor(), fixture.property, rawImage, request),
  ).toEqual(original);
  await expect(
    api().store(actor(), fixture.property, rawImage, {
      ...request,
      display: "rectangle",
    }),
  ).rejects.toMatchObject({ status: 409 });
  const changeRequest = {
    version: 1,
    operationId: randomUUID(),
    expectedRevision: original.revision,
    assetId: original.assetId,
    assetRevision: 1,
    action: "select",
  };
  const chosen = await api().change(actor(), fixture.property, changeRequest);
  expect(await api().change(actor(), fixture.property, changeRequest)).toEqual(
    chosen,
  );
  expect((await api().history(actor(), fixture.property)).length).toBe(
    history.length + 2,
  );
  await expect(
    api().change(actor(), fixture.property, {
      ...changeRequest,
      action: "release",
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    (await api().snapshot(actor(), fixture.property)).assets.find(
      (a) => a.id === firstId,
    )!.state,
  ).toBe("superseded");
});
it("serializes concurrent replacements and retained revisions transactionally", async () => {
  const a = await add(fixture.property),
    b = await add(fixture.property),
    s = await api().snapshot(actor(), fixture.property);
  const results = await Promise.allSettled(
    [a, b].map((asset) =>
      api().change(actor(), fixture.property, {
        version: 1,
        operationId: randomUUID(),
        expectedRevision: s.revision,
        assetId: asset.assetId,
        assetRevision: 1,
        action: "select",
      }),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({
    reason: { status: 409 },
  });
  const after = await api().snapshot(actor(), fixture.property);
  expect(after.revision).toBe(s.revision + 1);
  expect(after.assets.filter((a) => a.state === "selected")).toHaveLength(1);
  const competing = await Promise.allSettled(
    [1, 2].map(() => api().store(actor(), damageOrg, rawImage, command(0))),
  );
  expect(competing.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(competing.find((r) => r.status === "rejected")).toMatchObject({
    reason: { status: 409 },
  });
});
it("rechecks revoked authority after native processing without committing bytes, receipts or history", async () => {
  const original = sanitizer.sanitizeLogo,
    who = { userId: adminUser },
    s = await api().snapshot(who, fixture.property);
  let enter!: () => void, release!: () => void;
  const arrived = new Promise<void>((r) => (enter = r)),
    gate = new Promise<void>((r) => (release = r));
  const spy = vi
    .spyOn(sanitizer, "sanitizeLogo")
    .mockImplementation(async (bytes) => {
      enter();
      await gate;
      return original(bytes);
    });
  const pending = api().store(
    who,
    fixture.property,
    rawImage,
    command(s.revision),
  );
  await arrived;
  try {
    await admin.query(
      "update lms.memberships set role='viewer' where organization_id=$1 and user_id=$2",
      [fixture.property, adminUser],
    );
    release();
    await expect(pending).rejects.toMatchObject({ status: 403 });
  } finally {
    release();
    spy.mockRestore();
    await admin.query(
      "update lms.memberships set role='admin' where organization_id=$1 and user_id=$2",
      [fixture.property, adminUser],
    );
  }
  expect(await api().snapshot(actor(), fixture.property)).toEqual(s);
});
it("rejects hostile intake, preserves canonical sanitized bytes and strips metadata without trusting declarations", async () => {
  const state = await api().snapshot(actor(), fixture.property);
  for (const bad of [
    Buffer.from("<svg><script>evil()</script></svg>"),
    rawImage.subarray(0, -1),
    Buffer.alloc(1048577),
  ])
    await expect(
      api().store(actor(), fixture.property, bad, command(state.revision)),
    ).rejects.toMatchObject({ status: bad.length > 1048576 ? 413 : 422 });
  expect(await api().snapshot(actor(), fixture.property)).toEqual(state);
  const meta = await sharp(rawImage)
    .withExif({ IFD0: { Copyright: "FICTIONAL PRIVATE INPUT ONLY" } })
    .jpeg()
    .toBuffer();
  const result = await api().store(
    actor(),
    fixture.property,
    meta,
    command(state.revision),
  );
  const safe = await api().read(actor(), fixture.property, result.assetId, 1);
  expect(Buffer.from(safe.bytes).toString()).not.toContain(
    "FICTIONAL PRIVATE INPUT ONLY",
  );
  expect((await sharp(safe.bytes).metadata()).exif).toBeUndefined();
  expect(safe.metadata.sha256).toBe(hash(safe.bytes));
  safe.bytes.fill(0);
  expect(
    (await api().read(actor(), fixture.property, result.assetId, 1)).metadata
      .sha256,
  ).toBe(safe.metadata.sha256);
});
it("retains superseded bytes and uses explicit unreferencing, restoration, retirement and blocking without cleanup shortcuts", async () => {
  const s = await api().snapshot(actor(), fixture.property),
    superseded = s.assets.find((a) => a.id === firstId)!;
  expect(superseded.state).toBe("superseded");
  await change(fixture.property, firstId, "release");
  const unref = (await api().snapshot(actor(), fixture.property)).assets.find(
    (a) => a.id === firstId,
  )!;
  expect(unref.state).toBe("unreferenced");
  expect(
    Date.parse(unref.retentionEligibleAt!) - Date.parse(unref.unreferencedAt!),
  ).toBe(30 * 86400000);
  await change(fixture.property, firstId, "restore");
  await change(fixture.property, firstId, "release");
  await change(fixture.property, firstId, "retire");
  const retired = (await api().snapshot(actor(), fixture.property)).assets.find(
    (a) => a.id === firstId,
  )!;
  await expect(
    api().read(actor(), fixture.property, firstId, retired.revision),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    change(fixture.property, firstId, "restore"),
  ).rejects.toMatchObject({ status: 403 });
  const spare = s.assets.find((a) => a.state === "stored")!;
  await change(fixture.property, spare.id, "block");
  await expect(
    api().read(actor(), fixture.property, spare.id, 2),
  ).rejects.toMatchObject({ status: 403 });
  expect(
    (
      await admin.query(
        "select encode(sha256(content),'hex') as digest from lms.logo_assets where organization_id=$1 and id=$2",
        [fixture.property, firstId],
      )
    ).rows[0].digest,
  ).toBe(firstHash);
});
it("rolls back a forced mid-command storage failure without partial replacement or history", async () => {
  const before = await api().snapshot(actor(), fixture.property),
    history = await api().history(actor(), fixture.property);
  const spare = before.assets.find((a) => a.state === "stored")!;
  await admin.query(`create function lms_private.test_logo_disk_failure() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'Controlled fictional storage failure' using errcode='53100'; end; $$;
    create trigger test_logo_disk_failure before update on lms.logo_asset_states for each row execute function lms_private.test_logo_disk_failure()`);
  try {
    await expect(
      api().change(actor(), fixture.property, {
        version: 1,
        operationId: randomUUID(),
        expectedRevision: before.revision,
        assetId: spare.id,
        assetRevision: spare.revision,
        action: "select",
      }),
    ).rejects.toMatchObject({ status: 503 });
  } finally {
    await admin.query(
      "drop trigger test_logo_disk_failure on lms.logo_asset_states; drop function lms_private.test_logo_disk_failure()",
    );
  }
  expect(await api().snapshot(actor(), fixture.property)).toEqual(before);
  expect(await api().history(actor(), fixture.property)).toEqual(history);
});
it("rejects an independently opened stale repeatable-read writer after a committed mutation", async () => {
  const state = await api().snapshot(actor(), fixture.property),
    candidate = state.assets.find((a) => a.state === "stored")!;
  const stale = new Client({ connectionString: url(name, true) });
  await stale.connect();
  try {
    await stale.query(
      "begin isolation level repeatable read;set local role lms_app",
    );
    await stale.query("select set_config('lms.user_id',$1,true)", [
      fixture.owner,
    ]);
    await stale.query(
      "select revision from lms.logo_asset_states where organization_id=$1",
      [fixture.property],
    );
    await add(fixture.property);
    await expect(
      stale.query("select lms.logo_operation($1,$2,$3,null)", [
        fixture.property,
        (trust.source as { instanceId: string }).instanceId,
        {
          version: 1,
          operationId: randomUUID(),
          expectedRevision: state.revision,
          assetId: candidate.id,
          assetRevision: candidate.revision,
          action: "release",
        },
      ]),
    ).rejects.toMatchObject({ code: "40001" });
  } finally {
    await stale.query("rollback");
    await stale.end();
  }
});
it("enforces durable count and byte quotas, including retired bytes, across new host adapters", async () => {
  for (let i = 0; i < 16; i++) await add(countOrg);
  await expect(add(countOrg)).rejects.toMatchObject({ status: 409 });
  const item = (await api().snapshot(actor(), countOrg)).assets[0];
  await change(countOrg, item.id, "release");
  await change(countOrg, item.id, "retire");
  const reopened = await fresh();
  try {
    await expect(
      reopened.store(
        actor(),
        countOrg,
        rawImage,
        command((await reopened.snapshot(actor(), countOrg)).revision),
      ),
    ).rejects.toMatchObject({ status: 409 });
  } finally {
    await reopened.close();
  }
  const noise = await sharp(randomBytes(512 * 128 * 3), {
    raw: { width: 512, height: 128, channels: 3 },
  })
    .png()
    .toBuffer();
  let accepted = 0;
  for (let i = 0; i < 16; i++) {
    try {
      await add(bytesOrg, noise);
      accepted++;
    } catch (error) {
      expect(error).toMatchObject({ status: 409 });
      break;
    }
  }
  expect(accepted).toBeGreaterThan(0);
  expect(accepted).toBeLessThan(16);
  const all = (await api().snapshot(actor(), bytesOrg)).assets;
  expect(all.reduce((n, a) => n + a.bytes, 0)).toBeLessThanOrEqual(2097152);
});
it("preserves cleanup headroom after ordinary receipt exhaustion without deleting or refunding retained storage", async () => {
  const receipt = await add(budgetOrg),
    asset = receipt.assetId;
  for (let i = 0; i < 63; i++) {
    await change(budgetOrg, asset, "release");
    await change(budgetOrg, asset, "restore");
  }
  await change(budgetOrg, asset, "select");
  await expect(add(budgetOrg)).rejects.toMatchObject({ status: 409 });
  await change(budgetOrg, asset, "unselect");
  await change(budgetOrg, asset, "retire");
  const s = await api().snapshot(actor(), budgetOrg);
  expect(s.revision).toBe(130);
  expect(s.assets).toHaveLength(1);
  expect(s.assets[0].state).toBe("retired");
});
it("refuses damaged data and unsupported trust, while schema failures preserve the original ledger", async () => {
  const request = await add(damageOrg),
    old = (
      await admin.query(
        "select content from lms.logo_assets where organization_id=$1 and id=$2",
        [damageOrg, request.assetId],
      )
    ).rows[0].content as Buffer;
  const damaged = Buffer.from(old);
  damaged[45] ^= 1;
  // Simulate privileged/disk corruption without modifying the production guard or its checksum.
  await admin.query("begin");
  try {
    await admin.query(
      "alter table lms.logo_assets disable trigger logo_asset_guard; alter table lms.logo_assets disable trigger logo_event",
    );
    await admin.query(
      "update lms.logo_assets set content=$3,sha256=encode(sha256($3::bytea),'hex') where organization_id=$1 and id=$2",
      [damageOrg, request.assetId, damaged],
    );
    await admin.query(
      "alter table lms.logo_assets enable trigger logo_asset_guard; alter table lms.logo_assets enable trigger logo_event",
    );
    await admin.query("commit");
  } catch (error) {
    await admin.query("rollback");
    throw error;
  }
  await expect(
    api().read(actor(), damageOrg, request.assetId, 1),
  ).rejects.toMatchObject({ status: 409 });
  // Trusted test maintenance restores the original fixture before native preservation checks.
  await admin.query("begin");
  await admin.query(
    "alter table lms.logo_assets disable trigger logo_asset_guard; alter table lms.logo_assets disable trigger logo_event",
  );
  await admin.query(
    "update lms.logo_assets set content=$3,sha256=encode(sha256($3::bytea),'hex') where organization_id=$1 and id=$2",
    [damageOrg, request.assetId, old],
  );
  await admin.query(
    "alter table lms.logo_assets enable trigger logo_asset_guard; alter table lms.logo_assets enable trigger logo_event",
  );
  await admin.query("commit");
  for (const input of [
    { ...trust, fictionalOnly: false },
    { ...trust, version: 2 },
    {
      ...trust,
      source: { ...(trust.source as object), instanceId: randomUUID() },
    },
  ]) {
    const file = path.join(directory, "invalid-" + randomUUID() + ".json");
    await writeFile(file, JSON.stringify(input), { mode: 0o600 });
    await expect(
      openPrivateLogoStore({ databaseUrl: url(name, true), trustFile: file }),
    ).rejects.toThrow();
  }
  await expect(
    openPrivateLogoStore({ databaseUrl: url(), trustFile }),
  ).rejects.toThrow(/unsafe|restricted|Refusing/i);
  const changed = await loadMigrations();
  changed[12].sql += "\n-- altered";
  await expect(migrate(admin, changed)).rejects.toThrow(/mismatch/);
});
it("keeps v1/v2 blueprints, companion v1, records, audits and configuration histories unchanged", async () => {
  const plan = planForConfig(presets.property),
    details = {
      name: "Fictional durable compatibility",
      description:
        "Images stay outside published and portable business configuration.",
    };
  const portable = [plan, brandBuildPlan(plan, defaultBranding("property"))];
  for (const p of portable) {
    const zip = await createBlueprintPackage(p, details);
    await api().snapshot(actor(), fixture.property);
    expect(await createBlueprintPackage(p, details)).toEqual(zip);
    expect(JSON.stringify(p)).not.toContain(firstId);
  }
  const clean = await sanitizer.sanitizeLogo(rawImage),
    companion = await createLogoCompanion(clean.bytes, {
      width: clean.width,
      height: clean.height,
      display: "rectangle",
    });
  expect(
    await createLogoCompanion(clean.bytes, {
      width: clean.width,
      height: clean.height,
      display: "rectangle",
    }),
  ).toEqual(companion);
  expect(await engine.snapshot(actor(), fixture.property)).toEqual(before);
  expect(
    await engine.snapshot({ userId: fixture.other }, fixture.cleaning),
  ).toEqual(otherBefore);
});
it("performs a native backup and quarantined restore of private bytes/history, compares scoped integrity, leaves source unchanged and refuses activation", async () => {
  const query =
    "select organization_id,id,revision,state,bytes,sha256,encode(sha256(content),'hex') as actual from lms.logo_assets order by organization_id,id";
  const rows = (await admin.query(query)).rows;
  expect(rows.length).toBeGreaterThan(20);
  expect(rows.every((r) => r.sha256 === r.actual)).toBe(true);
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
  expect(result.versions.source.migration).toBe(13);
  const report = JSON.stringify(result);
  for (const forbidden of [
    firstHash,
    firstId,
    rawImage.toString("base64"),
    "Durable Fictional Customer",
  ])
    expect(report).not.toContain(forbidden);
  const copy = new Client({ connectionString: url(restoredName) });
  await copy.connect();
  try {
    expect((await copy.query(query)).rows).toEqual(rows);
    expect(
      (await copy.query("select blocked from lms_control.state")).rows[0]
        .blocked,
    ).toBe(true);
    await copy.query("begin;set local role lms_app");
    await copy.query("select set_config('lms.user_id',$1,true)", [
      fixture.owner,
    ]);
    await expect(
      copy.query("select lms.logo_snapshot($1,$2)", [
        fixture.property,
        (trust.source as { instanceId: string }).instanceId,
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
  expect((await admin.query(query)).rows).toEqual(rows);
  store = await fresh();
  const selected = (
    await api().snapshot(actor(), fixture.property)
  ).assets.find((a) => a.state === "selected")!;
  expect(
    hash(
      (
        await api().read(
          actor(),
          fixture.property,
          selected.id,
          selected.revision,
        )
      ).bytes,
    ),
  ).toBe(selected.sha256);
});
