import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { inventory, movement } from "../helpers/inventory";
import {
  newBuildPlan,
  planForConfig,
  addCustomField,
  publishPlanConfirmation,
} from "../../src/core/buildplan";

import { Engine } from "../../src/core/engine";
import { presets } from "../../src/presets";

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
    "LMS_TEST_ADMIN_URL is required; BuildPlan PostgreSQL tests never skip.",
  );
const controlName = decodeURIComponent(new URL(raw).pathname.slice(1));
if (!controlName.startsWith("lms_test_"))
  throw new Error("Use a disposable fictional lms_test_* control.");
const control = localTarget(raw, controlName),
  suffix = randomBytes(5).toString("hex"),
  name = "lms_test_buildplan_" + suffix,
  restoreName = "lms_restore_buildplan_" + suffix,
  legacyName = "lms_test_buildplan_legacy_" + suffix;
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
  directory = await mkdtemp(path.join(os.tmpdir(), "lms-buildplan-"));
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
      const result = await fn(c);
      await c.query("commit");
      return result;
    } catch (e) {
      await c.query("rollback");
      throw e;
    }
  });
}
const approval = (id: string, revision = 1, configRevision = 1) => ({
  id,
  revision,
  configRevision,
  confirmation: publishPlanConfirmation,
});
async function rawSave(
  c: Client,
  document: unknown,
  id: string,
  revision = 1,
  actor = owner.userId,
) {
  return c.query(
    "insert into lms.build_plan_revisions(organization_id,id,revision,base_revision,document,created_by)values($1,$2,$3,1,$4,$5)",
    [a, id, revision, document, actor],
  );
}
describe("native BuildPlan artifacts and publication", () => {
  it("keeps all templates as validated versioned artifacts with RLS, exact retries, immutable audits and role checks", async () => {
    const plan = planForConfig(presets.property),
      id = randomUUID();
    await engine.saveBuildPlan(owner, a, plan, id, 0, 1);
    await engine.saveBuildPlan(owner, a, plan, id, 0, 1);
    expect(
      (await engine.snapshot(owner, a)).audit.filter((x) => x.record_id === id),
    ).toHaveLength(1);
    for (const p of [staff, viewer, other])
      await expect(
        engine.saveBuildPlan(p, a, plan, randomUUID(), 0, 1),
      ).rejects.toMatchObject({ status: 403 });
    for (const p of [staff, viewer])
      await expect(
        rawTransaction(
          (c) => rawSave(c, plan, randomUUID(), 1, p.userId),
          p.userId,
        ),
      ).rejects.toMatchObject({ code: "42501" });
    expect(
      (
        await engine.asUser(other, (tx) =>
          tx.query(
            "select * from lms.build_plan_revisions where organization_id=$1",
            [a],
          ),
        )
      ).rows,
    ).toEqual([]);
    for (const sql of [
      "update lms.build_plan_revisions set document='{}'",
      "delete from lms.build_plan_revisions",
    ])
      await expect(rawTransaction((c) => c.query(sql))).rejects.toMatchObject({
        code: "42501",
      });
    await expect(
      rawTransaction((c) => rawSave(c, { ...plan, version: 99 }, randomUUID())),
    ).rejects.toMatchObject({ code: "23514" });
    for (const template of ["cleaning", "custom"] as const)
      await engine.saveBuildPlan(
        owner,
        a,
        newBuildPlan(template),
        randomUUID(),
        0,
        1,
      );
    expect((await engine.exportWorkspace(owner, a)).buildPlans).toHaveLength(3);
  });
  it("serializes exact concurrent saves, conflicting revisions and raw writers without duplicate audit history", async () => {
    const plan = planForConfig(presets.property),
      id = randomUUID();
    const same = await Promise.all([
      engine.saveBuildPlan(owner, a, plan, id, 0, 1),
      engine.saveBuildPlan(owner, a, plan, id, 0, 1),
    ]);
    expect(same[0].revision).toBe(same[1].revision);
    const aPlan = structuredClone(plan),
      bPlan = structuredClone(plan);
    aPlan.configuration.name = "A";
    bPlan.configuration.name = "B";
    const competing = await Promise.allSettled([
      engine.saveBuildPlan(owner, a, aPlan, id, 1, 1),
      engine.saveBuildPlan(owner, a, bPlan, id, 1, 1),
    ]);
    expect(competing.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(competing.find((r) => r.status === "rejected")?.reason.status).toBe(
      409,
    );
    const rawId = randomUUID();
    const raw = await Promise.allSettled([
      rawTransaction((c) => rawSave(c, plan, rawId)),
      rawTransaction((c) => rawSave(c, plan, rawId)),
    ]);
    expect(raw.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(raw.find((r) => r.status === "rejected")?.reason.code).toBe("23514");
    expect(
      (await engine.snapshot(owner, a)).buildPlans.filter((r) => r.id === id),
    ).toHaveLength(2);
  });
  it("orders plan edits against reviewed publication and refuses replay, stale reviews and missing confirmation", async () => {
    const plan = planForConfig(presets.property),
      id = randomUUID();
    plan.configuration.name = "Reviewed A";
    await engine.saveBuildPlan(owner, a, plan, id, 0, 1);
    await expect(
      engine.publishBuildPlan(owner, a, {
        ...approval(id),
        confirmation: "bypass",
      }),
    ).rejects.toThrow();
    const changed = structuredClone(plan);
    changed.configuration.name = "Edited B";
    const results = await Promise.allSettled([
      engine.publishBuildPlan(owner, a, approval(id)),
      engine.saveBuildPlan(owner, a, changed, id, 1, 1),
    ]);
    expect(results[1].status).toBe("fulfilled");
    const snap = await engine.snapshot(owner, a);
    if (results[0].status === "fulfilled") {
      expect(snap.config.document.name).toBe("Reviewed A");
      expect(snap.config.revision).toBe(2);
    } else {
      expect(results[0].reason.status).toBe(409);
      expect(snap.config.revision).toBe(1);
    }
    await expect(
      engine.publishBuildPlan(owner, a, approval(id)),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      engine.publishBuildPlan(other, b, approval(id)),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("reuses publication schema guards for concurrent new records, disabled populated entities, identity and rollback", async () => {
    const plan = planForConfig(presets.property),
      id = randomUUID();
    plan.configuration = addCustomField(plan.configuration, "customers", {
      key: "extra_note",
      label: "Extra notes",
      type: "text",
      required: false,
    });
    await engine.saveBuildPlan(owner, a, plan, id, 0, 1);
    const results = await Promise.allSettled([
      engine.publishBuildPlan(owner, a, approval(id)),
      engine.saveRecord(owner, a, "customers", {
        name: "Retained during race",
      }),
    ]);
    expect(results[1].status).toBe("fulfilled");
    const snap = await engine.snapshot(owner, a);
    expect(
      snap.records.some((r) => r.data.name === "Retained during race"),
    ).toBe(true);
    if (results[0].status === "rejected")
      expect(results[0].reason.message).toMatch(/migration/);
    else
      expect(
        snap.config.document.entities[0].fields.some(
          (f) => f.key === "extra_note",
        ),
      ).toBe(true);
    const custom = newBuildPlan("custom"),
      otherId = randomUUID();
    await engine.saveBuildPlan(
      owner,
      a,
      custom,
      otherId,
      0,
      snap.config.revision,
    );
    await expect(
      engine.publishBuildPlan(
        owner,
        a,
        approval(otherId, 1, snap.config.revision),
      ),
    ).rejects.toThrow(/identity/);
    const compatible = planForConfig(snap.config.document);
    compatible.configuration.name = "Compatible rename";
    const compatibleId = randomUUID();
    await engine.saveBuildPlan(
      owner,
      a,
      compatible,
      compatibleId,
      0,
      snap.config.revision,
    );
    expect(
      await engine.publishBuildPlan(
        owner,
        a,
        approval(compatibleId, 1, snap.config.revision),
      ),
    ).toBe(snap.config.revision + 1);
    expect(
      await engine.publishConfig(
        owner,
        a,
        snap.config.document,
        snap.config.revision + 1,
        snap.config.revision,
      ),
    ).toBe(snap.config.revision + 2);
  });
  it("rejects frozen draft snapshots and quotas while permitting only whole-host sandbox retirement", async () => {
    const plan = planForConfig(presets.property),
      id = randomUUID();
    await engine.saveBuildPlan(owner, a, plan, id, 0, 1);
    await client(name, true, async (c) => {
      await c.query("begin isolation level repeatable read");
      await c.query("set local role lms_app");
      await c.query("select set_config('lms.user_id',$1,true)", [owner.userId]);
      await c.query("select * from lms.build_plan_revisions");
      await engine.saveBuildPlan(
        owner,
        a,
        { ...plan, configuration: { ...plan.configuration, name: "Changed" } },
        id,
        1,
        1,
      );
      await expect(rawSave(c, plan, id, 2)).rejects.toMatchObject({
        code: "40001",
      });
      await c.query("rollback");
    });
    for (let i = 0; i < 4; i++)
      await engine.saveBuildPlan(owner, a, plan, randomUUID(), 0, 1);
    await expect(
      engine.saveBuildPlan(owner, a, plan, randomUUID(), 0, 1),
    ).rejects.toMatchObject({ status: 409 });
    const c = await inventory(engine, owner, a);
    await engine.saveRecord(
      owner,
      a,
      "stock-movements",
      movement(c.product, c.location),
      undefined,
      randomUUID(),
    );
    await expect(
      admin.query(
        "delete from lms.records where organization_id=$1 and entity='stock-movements'",
        [a],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await admin.query("delete from lms.organizations where id=$1", [a]);
    expect(
      (
        await admin.query(
          "select * from lms.build_plan_revisions where organization_id=$1",
          [a],
        )
      ).rows,
    ).toEqual([]);
  });
  it("upgrades stopped migration-10 databases without rewriting business records, config, stock or audit", async () => {
    await client(legacyName, false, async (c) => {
      await migrate(c, (await loadMigrations()).slice(0, 10));
      await c.query(
        "insert into lms.users values($1,'Fictional prior owner')",
        [owner.userId],
      );
      const id = randomUUID();
      await org(c, id, owner.userId, presets.property);
      const legacy = await connectPostgres({
        connectionString: url(legacyName, true),
      });
      let before: unknown;
      const snapshot = async () =>
        (
          await c.query(
            "select (select jsonb_agg(to_jsonb(t))from lms.records t)as records,(select jsonb_agg(to_jsonb(t))from lms.config_revisions t)as config,(select jsonb_agg(to_jsonb(t))from lms.audit_events t)as audit",
          )
        ).rows[0];
      try {
        const engine = new Engine(legacy);
        await engine.saveRecord(owner, id, "customers", {
          name: "Original retained customer",
        });
        before = await snapshot();
        await expect(
          engine.saveBuildPlan(
            owner,
            id,
            planForConfig(presets.property),
            randomUUID(),
            0,
            1,
          ),
        ).rejects.toMatchObject({
          status: 409,
          message: expect.stringContaining("migration 11"),
        });
        await expect(migrate(c)).rejects.toThrow(/Stop runtime/);
      } finally {
        await legacy.close();
      }
      expect(await migrate(c)).toEqual(["011_build_plan_studio"]);
      expect(await snapshot()).toEqual(before);
      expect(
        (await c.query("select * from lms.build_plan_revisions")).rows,
      ).toEqual([]);
    });
  });
  it("restores saved draft versions and publication history with normal startup and raw draft writes still blocked", async () => {
    const plan = planForConfig(presets.property),
      id = randomUUID();
    await engine.saveBuildPlan(owner, a, plan, id, 0, 1);
    plan.configuration.name = "Restored fictional plan";
    await engine.saveBuildPlan(owner, a, plan, id, 1, 1);
    await engine.publishBuildPlan(owner, a, approval(id, 2));
    await db.close();
    db = await connectPostgres({
      connectionString: url(name, true),
      maxConnections: 4,
    });
    engine = new Engine(db);
    expect((await engine.snapshot(owner, a)).buildPlans).toHaveLength(2);
    const file = path.join(directory, "plans.dump");
    await backupDatabase(url(), name, file, process.env.LMS_PG_BIN);
    await restoreDatabase(
      url(restoreName),
      restoreName,
      file,
      process.env.LMS_PG_BIN,
    );
    await client(restoreName, false, async (c) => {
      expect(
        (
          await c.query(
            "select * from lms.build_plan_revisions where organization_id=$1",
            [a],
          )
        ).rows,
      ).toHaveLength(2);
      expect(
        (
          await c.query(
            "select document from lms.config_revisions where organization_id=$1 and revision=2",
            [a],
          )
        ).rows[0].document.name,
      ).toBe("Restored fictional plan");
      expect(
        (
          await c.query(
            "select * from lms.audit_events where organization_id=$1 and entity='build-plan'",
            [a],
          )
        ).rows,
      ).toHaveLength(2);
      expect(
        (await c.query("select lms_control.is_blocked()as blocked")).rows[0]
          .blocked,
      ).toBe(true);
      await c.query("begin");
      await c.query("set local role lms_app");
      await c.query("select set_config('lms.user_id',$1,true)", [owner.userId]);
      await expect(
        c.query(
          "insert into lms.build_plan_revisions(organization_id,id,revision,base_revision,document,created_by)values($1,$2,3,2,$3,$4)",
          [a, id, plan, owner.userId],
        ),
      ).rejects.toMatchObject({ code: "55000" });
      await c.query("rollback");
    });
    await expect(
      connectPostgres({ connectionString: url(restoreName, true) }),
    ).rejects.toThrow(/activation blocked/i);
  });
});
