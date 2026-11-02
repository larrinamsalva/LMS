import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { employee, enroll, period } from "../helpers/workforce";
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
    "LMS_TEST_ADMIN_URL is required; workforce PostgreSQL tests never skip.",
  );
const controlName = decodeURIComponent(new URL(raw).pathname.slice(1));
if (!controlName.startsWith("lms_test_"))
  throw new Error("Use a disposable fictional lms_test_* control.");
const control = localTarget(raw, controlName),
  suffix = randomBytes(5).toString("hex"),
  name = "lms_test_workforce_" + suffix,
  restoreName = "lms_restore_workforce_" + suffix,
  legacyName = "lms_test_workforce_legacy_" + suffix;
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
  directory = await mkdtemp(path.join(os.tmpdir(), "lms-workforce-"));
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
async function rawRecord(entity: string, data: unknown) {
  return client(name, true, async (c) => {
    await c.query("begin");
    try {
      await c.query("set local role lms_app");
      await c.query("select set_config('lms.user_id',$1,true)", [owner.userId]);
      const r = await c.query(
        "insert into lms.records(organization_id,entity,data,config_revision,created_by,updated_by)values($1,$2,$3,1,$4,$4)returning *",
        [a, entity, data, owner.userId],
      );
      await c.query("commit");
      return r.rows[0];
    } catch (e) {
      await c.query("rollback");
      throw e;
    }
  });
}
describe("employee and crew availability with native PostgreSQL transactions", () => {
  it("reserves a multi-person crew, rejects the same employee via another crew/worker and preserves exact assignment history", async () => {
    const w = await workflow(engine, owner, a, "property"),
      first = await employee(engine, owner, a),
      second = await employee(engine, owner, a, "Second Example");
    await enroll(engine, owner, a, w.resource, first.profile);
    const crew = await engine.saveRecord(owner, a, "resources", {
      name: "Shared crew",
      kind: "Crew",
    });
    await enroll(engine, owner, a, crew, first.profile);
    await enroll(engine, owner, a, crew, second.profile);
    const appt = await engine.saveRecord(
      staff,
      a,
      "appointments",
      appointmentData({ ...w, resource: crew }),
    );
    await expect(
      engine.saveRecord(staff, a, "appointments", appointmentData(w)),
    ).rejects.toMatchObject({ status: 409 });
    const snap = await engine.snapshot(owner, a);
    expect(snap.staffAssignments.filter((s) => s.active)).toHaveLength(2);
    expect(
      snap.staffAssignments.every(
        (s) =>
          s.membership_revision === 1 &&
          s.appointment_revision === appt.revision,
      ),
    ).toBe(true);
    await engine.archiveRecord(owner, a, appt.id, appt.revision, true);
    expect(
      (await engine.snapshot(owner, a)).staffAssignments.filter(
        (s) => !s.active,
      ),
    ).toHaveLength(2);
  });
  it("enforces cross-resource employee conflicts for simultaneous direct SQL writers without the Engine organization lock", async () => {
    const w = await workflow(engine, owner, a, "property"),
      person = await employee(engine, owner, a);
    await enroll(engine, owner, a, w.resource, person.profile);
    const crew = await engine.saveRecord(owner, a, "resources", {
      name: "Other crew",
      kind: "Crew",
    });
    await enroll(engine, owner, a, crew, person.profile);
    const results = await Promise.allSettled([
      rawTransaction(appointmentData(w)),
      rawTransaction(appointmentData({ ...w, resource: crew })),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")?.reason).toMatchObject({
      code: "23P01",
      constraint: "exclusive_employee_time",
    });
    expect(
      (await admin.query("select * from lms.appointment_staff where active"))
        .rows,
    ).toHaveLength(1);
  });
  it("orders time-off changes against bookings and rejects a frozen repeatable-read availability writer", async () => {
    const w = await workflow(engine, owner, a, "property"),
      person = await employee(engine, owner, a);
    await enroll(engine, owner, a, w.resource, person.profile);
    const results = await Promise.allSettled([
      rawTransaction(appointmentData(w)),
      rawRecord(
        "availability",
        period({ employee: person.profile.id, kind: "Vacation" }),
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")?.reason.code).toBe(
      "23514",
    );
    const appts = (
      await admin.query(
        "select count(*)::int as n from lms.appointments where blocking",
      )
    ).rows[0].n;
    const off = (
      await admin.query(
        "select count(*)::int as n from lms.availability_windows where kind='Vacation'",
      )
    ).rows[0].n;
    expect(appts + off).toBe(1);
    if (off) {
      const vacation = (await engine.snapshot(owner, a)).records.find(
        (r) => r.entity === "availability" && r.data.kind === "Vacation",
      )!;
      await engine.archiveRecord(
        owner,
        a,
        vacation.id,
        vacation.revision,
        true,
      );
    }
    await client(name, true, async (c) => {
      await c.query("begin isolation level repeatable read");
      await c.query("set local role lms_app");
      await c.query("select set_config('lms.user_id',$1,true)", [owner.userId]);
      await c.query("select * from lms.records where organization_id=$1", [a]);
      await engine.saveRecord(
        owner,
        a,
        "appointments",
        appointmentData(w, {
          start: "2026-11-06T22:00:00Z",
          end: "2026-11-06T23:00:00Z",
        }),
      );
      await expect(
        c.query(
          "insert into lms.records(organization_id,entity,data,config_revision,created_by,updated_by)values($1,'availability',$2,1,$3,$3)",
          [
            a,
            period({
              employee: person.profile.id,
              kind: "Unavailable",
              start: "2026-11-06T22:00:00Z",
              end: "2026-11-06T23:00:00Z",
            }),
            owner.userId,
          ],
        ),
      ).rejects.toMatchObject({ code: "40001" });
      await c.query("rollback");
    });
  });
  it("serializes membership additions with bookings, retaining the roster chosen at commit rather than silently changing reserved people", async () => {
    const w = await workflow(engine, owner, a, "property"),
      person = await employee(engine, owner, a),
      second = await employee(engine, owner, a, "Joining Example");
    const crew = await engine.saveRecord(owner, a, "resources", {
      name: "Changing crew",
      kind: "Crew",
    });
    await enroll(engine, owner, a, crew, person.profile);
    const results = await Promise.allSettled([
      rawTransaction(appointmentData({ ...w, resource: crew })),
      rawRecord("resource-memberships", {
        title: "Joining crew",
        employee: second.profile.id,
        resource: crew.id,
        start: "2026-01-01T08:00:00Z",
        end: "2027-01-01T08:00:00Z",
        time_zone: "America/Los_Angeles",
      }),
    ]);
    expect(results[0].status).toBe("fulfilled");
    const accepted = results[1].status === "fulfilled";
    if (!accepted)
      expect((results[1] as PromiseRejectedResult).reason.code).toBe("23514");
    const rows = (
      await admin.query("select * from lms.appointment_staff where active")
    ).rows;
    expect(rows).toHaveLength(accepted ? 2 : 1);
    expect(rows.some((s) => s.employee_id === second.profile.id)).toBe(
      accepted,
    );
  });
  it("orders inactive-profile changes with appointments and never reserves an inactive employee", async () => {
    const w = await workflow(engine, owner, a, "property"),
      person = await employee(engine, owner, a);
    await enroll(engine, owner, a, w.resource, person.profile);
    const update = client(name, true, async (c) => {
      await c.query("begin");
      try {
        await c.query("set local role lms_app");
        await c.query("select set_config('lms.user_id',$1,true)", [
          owner.userId,
        ]);
        await c.query(
          "update lms.records set data=jsonb_set(data,'{status}','\"Inactive\"') where organization_id=$1 and id=$2",
          [a, person.profile.id],
        );
        await c.query("commit");
      } catch (e) {
        await c.query("rollback");
        throw e;
      }
    });
    const results = await Promise.allSettled([
      rawTransaction(appointmentData(w)),
      update,
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const inactive =
      (
        await admin.query(
          "select data from lms.records where organization_id=$1 and id=$2",
          [a, person.profile.id],
        )
      ).rows[0].data.status === "Inactive";
    expect(
      (
        await admin.query(
          "select count(*)::int as n from lms.appointment_staff where active",
        )
      ).rows[0].n,
    ).toBe(inactive ? 0 : 1);
  });
  it("rejects staff/viewer administration, foreign subjects, malformed periods and projection/history tampering in SQL", async () => {
    const w = await workflow(engine, owner, a, "property"),
      person = await employee(engine, owner, a),
      foreign = await employee(engine, other, b);
    await enroll(engine, owner, a, w.resource, person.profile);
    await expect(
      engine.saveRecord(
        staff,
        a,
        "availability",
        period({ employee: person.profile.id }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      engine.archiveRecord(
        staff,
        a,
        person.profile.id,
        person.profile.revision,
        true,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      engine.asUser(viewer, (tx) =>
        tx.query(
          "insert into lms.records(organization_id,entity,data,config_revision,created_by,updated_by)values($1,'employees',$2,1,$3,$3)",
          [
            a,
            { name: "No permissions", role: "Owner", status: "Active" },
            viewer.userId,
          ],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    for (const data of [
      period({ employee: foreign.profile.id }),
      period({ employee: person.profile.id, resource: w.resource.id }),
      period({ resource: person.profile.id }),
      period({ employee: person.profile.id, end: "2026-11-06T16:00:00Z" }),
      period({ employee: person.profile.id, time_zone: "Invalid/Zone" }),
      period({ employee: person.profile.id, start: "2026-11-06T16:00:01Z" }),
    ])
      await expect(rawRecord("availability", data)).rejects.toThrow();
    await expect(
      engine.asUser(owner, (tx) =>
        tx.query("delete from lms.appointment_staff"),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      engine.asUser(owner, (tx) =>
        tx.query("update lms.resource_memberships set archived=true"),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    expect(
      (
        await engine.asUser(other, (tx) =>
          tx.query(
            "select * from lms.availability_windows where organization_id=$1",
            [a],
          ),
        )
      ).rows,
    ).toEqual([]);
  });
  it("revalidates reschedule/restore, retains old snapshots, rejects stale/altered retries and never removes enrollment by archive", async () => {
    const w = await workflow(engine, owner, a, "property"),
      person = await employee(engine, owner, a),
      member = await enroll(engine, owner, a, w.resource, person.profile);
    const op = randomUUID(),
      data = appointmentData(w),
      appt = await engine.saveRecord(
        owner,
        a,
        "appointments",
        data,
        undefined,
        op,
      );
    expect(
      (await engine.saveRecord(owner, a, "appointments", data, undefined, op))
        .id,
    ).toBe(appt.id);
    await expect(
      engine.saveRecord(
        owner,
        a,
        "appointments",
        appointmentData(w, {
          start: "2026-11-07T03:00:00Z",
          end: "2026-11-07T04:00:00Z",
        }),
        appt,
        randomUUID(),
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("work window"),
    });
    expect(
      (await engine.snapshot(owner, a)).staffAssignments.filter(
        (s) => s.active,
      ),
    ).toHaveLength(1);
    await expect(
      engine.saveRecord(
        owner,
        a,
        "resource-memberships",
        { ...member.data, end: "2026-11-06T18:30:00Z" },
        member,
      ),
    ).rejects.toMatchObject({ status: 409 });
    const archived = await engine.archiveRecord(
      owner,
      a,
      appt.id,
      appt.revision,
      true,
    );
    const changed = await engine.saveRecord(
      owner,
      a,
      "employees",
      { ...person.profile.data, name: "Renamed Example" },
      person.profile,
    );
    const restored = await engine.archiveRecord(
      owner,
      a,
      appt.id,
      archived.revision,
      false,
    );
    const snap = await engine.snapshot(owner, a);
    expect(snap.staffAssignments.find((s) => !s.active)?.employee_name).toBe(
      person.profile.data.name,
    );
    expect(snap.staffAssignments.find((s) => s.active)?.employee_name).toBe(
      changed.data.name,
    );
    await expect(
      engine.saveRecord(
        owner,
        a,
        "appointments",
        { ...data, end: "2026-11-06T20:00:00Z" },
        appt,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await engine.archiveRecord(owner, a, appt.id, restored.revision, true);
    const offOp = randomUUID(),
      offData = period({ employee: person.profile.id, kind: "Day off" });
    const off = await engine.saveRecord(
      owner,
      a,
      "availability",
      offData,
      undefined,
      offOp,
    );
    expect(
      (
        await engine.saveRecord(
          owner,
          a,
          "availability",
          offData,
          undefined,
          offOp,
        )
      ).id,
    ).toBe(off.id);
    await expect(
      engine.saveRecord(
        owner,
        a,
        "availability",
        { ...offData, kind: "Vacation" },
        undefined,
        offOp,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      engine.archiveRecord(owner, a, appt.id, restored.revision + 1, false),
    ).rejects.toMatchObject({ status: 409 });
    await engine.archiveRecord(owner, a, member.id, member.revision, true);
    await expect(
      engine.saveRecord(owner, a, "appointments", data),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("upgrades migration 7 with no fabricated people or assignments and preserves existing scheduling/history", async () => {
    await client(legacyName, false, async (c) => {
      await migrate(c, (await loadMigrations()).slice(0, 7));
      await c.query(
        "insert into lms.users values($1,'Fictional legacy owner')",
        [owner.userId],
      );
      const config = structuredClone(presets.property);
      config.modules = config.modules.filter((m) => m.id !== "workforce");
      config.entities = config.entities.filter((e) => e.module !== "workforce");
      config.navigation = config.navigation.filter(
        (id) =>
          !["employees", "resource-memberships", "availability"].includes(id),
      );
      const orgId = randomUUID();
      await org(c, orgId, owner.userId, config);
      const snapshot = async () =>
        (
          await c.query(
            "select (select jsonb_agg(to_jsonb(r)) from lms.records r) as records,(select jsonb_agg(to_jsonb(r)) from lms.config_revisions r) as config,(select jsonb_agg(to_jsonb(r)) from lms.audit_events r) as audit",
          )
        ).rows[0];
      const lease = await connectPostgres({
        connectionString: url(legacyName, true),
      });
      let before: Awaited<ReturnType<typeof snapshot>>;
      try {
        const legacyEngine = new Engine(lease);
        const w = await workflow(legacyEngine, owner, orgId, "property");
        await legacyEngine.saveRecord(
          owner,
          orgId,
          "appointments",
          appointmentData(w),
        );
        await expect(
          legacyEngine.publishConfig(owner, orgId, presets.property, 1),
        ).rejects.toMatchObject({
          status: 409,
          message: expect.stringContaining("migration 8"),
        });
        before = await snapshot();
        await expect(migrate(c)).rejects.toThrow(/Stop runtime/);
      } finally {
        await lease.close();
      }
      expect(await migrate(c)).toEqual([
        "008_workforce_availability",
        "009_service_estimates",
        "010_inventory_ledger",
        "011_build_plan_studio",
        "012_business_branding",
        "013_private_logo_assets",
        "014_private_logo_associations",
      ]);
      expect(await snapshot()).toEqual(before!);
      expect(
        (await c.query("select * from lms.appointment_staff")).rows,
      ).toEqual([]);
    });
  });
  it("backs up and restores effective memberships, periods and assignment history without restoring activation", async () => {
    const w = await workflow(engine, owner, a, "property"),
      person = await employee(engine, owner, a);
    await enroll(engine, owner, a, w.resource, person.profile);
    await engine.saveRecord(owner, a, "appointments", appointmentData(w));
    const snapshot = await engine.exportWorkspace(owner, a),
      file = path.join(directory, "workforce.dump");
    await backupDatabase(url(), name, file, process.env.LMS_PG_BIN);
    await restoreDatabase(
      url(restoreName),
      restoreName,
      file,
      process.env.LMS_PG_BIN,
    );
    await client(restoreName, false, async (c) => {
      expect(
        (await c.query("select * from lms.appointment_staff")).rows,
      ).toHaveLength(1);
      expect(
        (await c.query("select * from lms.resource_memberships")).rows,
      ).toHaveLength(1);
      expect(
        (await c.query("select * from lms.availability_windows")).rows,
      ).toHaveLength(1);
      expect(
        (
          await c.query(
            "select data from lms.records where organization_id=$1 order by entity,id",
            [a],
          )
        ).rows.map((r) => r.data),
      ).toEqual(snapshot.records.map((r) => r.data));
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
