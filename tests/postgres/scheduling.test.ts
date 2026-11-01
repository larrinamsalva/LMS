import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
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
    "LMS_TEST_ADMIN_URL is required; scheduling PostgreSQL tests never skip.",
  );
const controlName = decodeURIComponent(new URL(raw).pathname.slice(1));
if (!controlName.startsWith("lms_test_"))
  throw new Error("Use a disposable fictional lms_test_* control.");
const control = localTarget(raw, controlName),
  suffix = randomBytes(5).toString("hex"),
  name = "lms_test_schedule_" + suffix,
  restoreName = "lms_restore_schedule_" + suffix,
  legacyName = "lms_test_schedule_legacy_" + suffix;
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
  directory = await mkdtemp(path.join(os.tmpdir(), "lms-scheduling-"));
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
async function rawInsert(
  c: Client,
  orgId: string,
  actor: string,
  data: unknown,
) {
  return c.query(
    "insert into lms.records(organization_id,entity,data,config_revision,created_by,updated_by)values($1,'appointments',$2,1,$3,$3)returning id",
    [orgId, data, actor],
  );
}
async function rawTransaction(data: unknown, isolation = "read committed") {
  return client(name, true, async (c) => {
    await c.query("begin isolation level " + isolation);
    try {
      await c.query("set local role lms_app");
      await c.query("select set_config('lms.user_id',$1,true)", [owner.userId]);
      const result = await rawInsert(c, a, owner.userId, data);
      await c.query("commit");
      return result;
    } catch (e) {
      await c.query("rollback");
      throw e;
    }
  });
}
describe("shared scheduling with native PostgreSQL constraints", () => {
  it("operates both industry workflows with scoped links and denies unauthorized projection/history changes", async () => {
    for (const [id, p, industry] of [
      [a, owner, "property"],
      [b, other, "cleaning"],
    ] as const) {
      const w = await workflow(engine, p, id, industry);
      const r = await engine.saveRecord(
        p,
        id,
        "appointments",
        appointmentData(w),
        undefined,
        randomUUID(),
      );
      expect(
        (
          await engine.asUser(p, (tx) =>
            tx.query("select * from lms.record_links where source_id=$1", [
              r.id,
            ]),
          )
        ).rows,
      ).toHaveLength(industry === "property" ? 4 : 3);
      expect(
        (await engine.snapshot(p, id)).audit.some((e) => e.record_id === r.id),
      ).toBe(true);
    }
    await expect(
      engine.asUser(staff, (tx) => tx.query("delete from lms.appointments")),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      engine.asUser(owner, (tx) =>
        tx.query("update lms.record_operations set request='{}'"),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      engine.asUser(staff, (tx) => tx.query("delete from lms.audit_events")),
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      (
        await engine.asUser(other, (tx) =>
          tx.query("select * from lms.appointments where organization_id=$1", [
            a,
          ]),
        )
      ).rows,
    ).toEqual([]);
  });
  it("rejects foreign customers/resources/work/sites, wrong dates/ranges/zones and viewer writes directly in the database", async () => {
    const x = await workflow(engine, owner, a, "property"),
      y = await workflow(engine, other, b, "cleaning");
    for (const changes of [
      { customer: y.customer.id },
      { resource: y.resource.id },
      { work: y.work.id },
      { site: y.customer.id },
      { scheduled_date: "2026-11-05" },
      { time_zone: "Invalid/Zone" },
      { end: "2026-11-06T18:00:00Z" },
      { end: "2026-11-07T19:00:00Z" },
    ] as RecordData[])
      await expect(
        rawTransaction(appointmentData(x, changes)),
      ).rejects.toThrow();
    await expect(
      engine.saveRecord(viewer, a, "appointments", appointmentData(x)),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      engine.asUser(viewer, (tx) =>
        tx.query(
          "insert into lms.records(organization_id,entity,data,config_revision,created_by,updated_by)values($1,'appointments',$2,1,$3,$3)",
          [a, appointmentData(x), viewer.userId],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      (await admin.query("select count(*)::int as n from lms.appointments"))
        .rows[0].n,
    ).toBe(0);
  });
  it("serializes concurrent engine attempts and accepts adjacent times or a different exclusive resource", async () => {
    const w = await workflow(engine, owner, a, "property");
    const results = await Promise.allSettled([
      engine.saveRecord(
        owner,
        a,
        "appointments",
        appointmentData(w, { title: "First contender" }),
        undefined,
        randomUUID(),
      ),
      engine.saveRecord(
        owner,
        a,
        "appointments",
        appointmentData(w, { title: "Second contender" }),
        undefined,
        randomUUID(),
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")?.reason.status).toBe(
      409,
    );
    await engine.saveRecord(
      staff,
      a,
      "appointments",
      appointmentData(w, {
        start: "2026-11-06T19:00:00Z",
        end: "2026-11-06T20:00:00Z",
      }),
    );
    const resource = await engine.saveRecord(owner, a, "resources", {
      name: "Independent worker",
      kind: "Worker",
    });
    await engine.saveRecord(
      owner,
      a,
      "appointments",
      appointmentData({ ...w, resource }),
    );
    expect(
      (await admin.query("select count(*)::int as n from lms.appointments"))
        .rows[0].n,
    ).toBe(3);
  });
  it("deduplicates concurrent submissions, rejects altered retries and stale edits, and retains the original receipt after later edits", async () => {
    const w = await workflow(engine, owner, a, "property"),
      data = appointmentData(w),
      operationId = randomUUID();
    const results = await Promise.all([
      engine.saveRecord(owner, a, "appointments", data, undefined, operationId),
      engine.saveRecord(owner, a, "appointments", data, undefined, operationId),
    ]);
    expect(results[0].id).toBe(results[1].id);
    const first = results[0];
    await expect(
      engine.saveRecord(
        owner,
        a,
        "appointments",
        { ...data, notes: "Changed" },
        undefined,
        operationId,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      engine.saveRecord(staff, a, "appointments", data, undefined, operationId),
    ).rejects.toMatchObject({ status: 409 });
    const next = await engine.saveRecord(
      owner,
      a,
      "appointments",
      { ...data, start: "2026-11-06T20:00:00Z", end: "2026-11-06T21:00:00Z" },
      first,
      randomUUID(),
    );
    await expect(
      engine.saveRecord(owner, a, "appointments", data, first, randomUUID()),
    ).rejects.toMatchObject({ status: 409 });
    await engine.saveRecord(
      owner,
      a,
      "appointments",
      data,
      undefined,
      operationId,
    );
    expect(
      (await engine.snapshot(owner, a)).records.find((r) => r.id === first.id)!
        .revision,
    ).toBe(next.revision);
    expect(
      (await engine.snapshot(owner, a)).audit.filter(
        (e) => e.record_id === first.id,
      ),
    ).toHaveLength(2);
  });
  it("protects direct concurrent SQL and stale REPEATABLE READ snapshots without browser or service conflict checks", async () => {
    const w = await workflow(engine, owner, a, "property"),
      data = appointmentData(w);
    const results = await Promise.allSettled([
      rawTransaction(data),
      rawTransaction({ ...data, title: "SQL competitor" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")?.reason.code).toBe(
      "23P01",
    );
    await client(name, true, async (c) => {
      await c.query("begin isolation level repeatable read");
      await c.query("set local role lms_app");
      await c.query("select set_config('lms.user_id',$1,true)", [owner.userId]);
      await c.query("select * from lms.organizations where id=$1", [a]);
      await engine.saveRecord(
        owner,
        a,
        "appointments",
        appointmentData(w, {
          start: "2026-11-06T21:00:00Z",
          end: "2026-11-06T22:00:00Z",
        }),
      );
      await expect(
        rawInsert(
          c,
          a,
          owner.userId,
          appointmentData(w, {
            start: "2026-11-06T21:00:00Z",
            end: "2026-11-06T22:00:00Z",
          }),
        ),
      ).rejects.toMatchObject({ code: "40001" });
      await c.query("rollback");
    });
    expect(
      (await admin.query("select count(*)::int as n from lms.appointments"))
        .rows[0].n,
    ).toBe(2);
  });
  it("serializes a direct resource archive against a new booking without stranding either side", async () => {
    const w = await workflow(engine, owner, a, "property");
    const archive = client(name, true, async (c) => {
      await c.query("begin");
      try {
        await c.query("set local role lms_app");
        await c.query("select set_config('lms.user_id',$1,true)", [
          owner.userId,
        ]);
        await c.query(
          "update lms.records set archived=true where organization_id=$1 and id=$2",
          [a, w.resource.id],
        );
        await c.query("commit");
      } catch (e) {
        await c.query("rollback");
        throw e;
      }
    });
    const results = await Promise.allSettled([
      rawTransaction(appointmentData(w)),
      archive,
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const count = (
      await admin.query(
        "select count(*)::int as n from lms.appointments where organization_id=$1",
        [a],
      )
    ).rows[0].n;
    const state = (
      await admin.query(
        "select archived from lms.records where organization_id=$1 and id=$2",
        [a, w.resource.id],
      )
    ).rows[0].archived;
    expect(state).toBe(count === 0);
  });
  it("retains links and historical reservations; archive/restore and cancellation are revalidated atomically", async () => {
    const w = await workflow(engine, owner, a, "property"),
      data = appointmentData(w),
      first = await engine.saveRecord(owner, a, "appointments", data);
    for (const target of [w.customer, w.work, w.resource, w.site!])
      await expect(
        engine.archiveRecord(owner, a, target.id, target.revision, true),
      ).rejects.toMatchObject({ status: 409 });
    await expect(
      engine.saveRecord(
        owner,
        a,
        "tasks",
        { ...w.work.data, customer: "" },
        w.work,
      ),
    ).rejects.toMatchObject({ status: 409 });
    const completed = await engine.saveRecord(
      owner,
      a,
      "appointments",
      { ...data, status: "Completed" },
      first,
    );
    await expect(
      engine.saveRecord(owner, a, "appointments", data),
    ).rejects.toMatchObject({ status: 409 });
    const cancelled = await engine.saveRecord(
      owner,
      a,
      "appointments",
      { ...data, status: "Cancelled" },
      completed,
    );
    const replacement = await engine.saveRecord(owner, a, "appointments", {
      ...data,
      title: "Replacement",
    });
    await expect(
      engine.saveRecord(owner, a, "appointments", data, cancelled),
    ).rejects.toMatchObject({ status: 409 });
    const archiveOperation = randomUUID();
    const archived = await engine.archiveRecord(
      owner,
      a,
      replacement.id,
      replacement.revision,
      true,
      archiveOperation,
    );
    expect(
      (
        await engine.archiveRecord(
          owner,
          a,
          replacement.id,
          replacement.revision,
          true,
          archiveOperation,
        )
      ).revision,
    ).toBe(archived.revision);
    const current = await engine.saveRecord(owner, a, "appointments", {
      ...data,
      title: "Current",
    });
    await expect(
      engine.archiveRecord(owner, a, replacement.id, archived.revision, false),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await engine.snapshot(owner, a)).records.find(
        (r) => r.id === cancelled.id,
      )!.data.status,
    ).toBe("Cancelled");
    expect(current.id).not.toBe(archived.id);
  });
  it("changes the business display zone through configuration history without moving stored instants", async () => {
    const w = await workflow(engine, owner, a, "property"),
      first = await engine.saveRecord(
        owner,
        a,
        "appointments",
        appointmentData(w),
      );
    await engine.publishConfig(
      owner,
      a,
      { ...presets.property, timeZone: "Pacific/Auckland" },
      1,
    );
    const snapshot = await engine.snapshot(owner, a);
    expect(snapshot.records.find((r) => r.id === first.id)!.data).toEqual(
      first.data,
    );
    expect(snapshot.history).toHaveLength(2);
    await expect(
      engine.publishConfig(
        staff,
        a,
        { ...presets.property, timeZone: "UTC" },
        2,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("upgrades migration 6 only with hosts stopped while preserving existing configuration, records and audit bytes", async () => {
    await client(legacyName, false, async (c) => {
      await migrate(c, (await loadMigrations()).slice(0, 6));
      await c.query(
        "insert into lms.users values($1,'Fictional legacy owner')",
        [owner.userId],
      );
      const legacy = structuredClone(presets.property);
      legacy.modules = legacy.modules.filter(
        (m) => !["scheduling", "workforce"].includes(m.id),
      );
      legacy.entities = legacy.entities
        .filter((e) => !["scheduling", "workforce"].includes(e.module))
        .map((e) => ({
          ...e,
          fields: e.fields.filter((f) => f.type !== "reference"),
        }));
      legacy.navigation = legacy.navigation.filter(
        (id) =>
          ![
            "appointments",
            "resources",
            "employees",
            "resource-memberships",
            "availability",
          ].includes(id),
      );
      delete legacy.timeZone;
      const id = randomUUID();
      await org(c, id, owner.userId, legacy);
      await c.query(
        "insert into lms.records(organization_id,entity,data,config_revision,created_by,updated_by)values($1,'customers',$2,1,$3,$3)",
        [id, { name: "Retained legacy customer" }, owner.userId],
      );
      const before = (
        await c.query(
          "select (select jsonb_agg(to_jsonb(t))from lms.records t)as records,(select jsonb_agg(to_jsonb(t))from lms.config_revisions t)as config,(select jsonb_agg(to_jsonb(t))from lms.audit_events t)as audit",
        )
      ).rows[0];
      const lease = await connectPostgres({
        connectionString: url(legacyName, true),
      });
      try {
        await expect(migrate(c)).rejects.toThrow(/Stop runtime/);
      } finally {
        await lease.close();
      }
      expect(await migrate(c)).toEqual([
        "007_relationship_scheduling",
        "008_workforce_availability",
        "009_service_estimates",
        "010_inventory_ledger",
        "011_build_plan_studio",
        "012_business_branding",
      ]);
      expect(
        (
          await c.query(
            "select (select jsonb_agg(to_jsonb(t))from lms.records t)as records,(select jsonb_agg(to_jsonb(t))from lms.config_revisions t)as config,(select jsonb_agg(to_jsonb(t))from lms.audit_events t)as audit",
          )
        ).rows[0],
      ).toEqual(before);
    });
  });
  it("backs up and restores appointment links and operation receipts while keeping recovery activation blocked", async () => {
    const w = await workflow(engine, owner, a, "property"),
      operationId = randomUUID(),
      r = await engine.saveRecord(
        owner,
        a,
        "appointments",
        appointmentData(w),
        undefined,
        operationId,
      );
    const file = path.join(directory, "schedule.dump");
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
            "select data from lms.records where organization_id=$1 and id=$2",
            [a, r.id],
          )
        ).rows[0].data,
      ).toEqual(r.data);
      expect(
        (
          await c.query(
            "select * from lms.record_links where organization_id=$1 and source_id=$2",
            [a, r.id],
          )
        ).rows,
      ).toHaveLength(4);
      expect(
        (
          await c.query(
            "select * from lms.record_operations where organization_id=$1 and operation_id=$2",
            [a, operationId],
          )
        ).rows,
      ).toHaveLength(1);
      expect(
        (await c.query("select lms_control.is_blocked() as blocked")).rows[0]
          .blocked,
      ).toBe(true);
      expect(await migrate(c)).toEqual([]);
    });
    await expect(
      connectPostgres({ connectionString: url(restoreName, true) }),
    ).rejects.toThrow(/activation blocked/i);
  });
});
