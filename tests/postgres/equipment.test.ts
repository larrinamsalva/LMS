import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  reservationFixture,
  mappingRequest,
} from "../helpers/equipment-reservations";
import { workflow, appointmentData } from "../helpers/scheduling";
import { selectModules } from "../../src/core/buildplan";
import {
  equipmentFixture,
  releaseEquipment,
  checkoutEquipment,
  equipmentAction,
} from "../helpers/equipment";
import { retireEquipmentConfirmation } from "../../src/core/equipment";
import { enroll } from "../helpers/workforce";
import { inventory, movement } from "../helpers/inventory";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { Client } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Engine, type WorkspaceRecord } from "../../src/core/engine";
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
    "LMS_TEST_ADMIN_URL is required; equipment PostgreSQL tests never skip.",
  );
const controlName = decodeURIComponent(new URL(raw).pathname.slice(1));
if (!controlName.startsWith("lms_test_"))
  throw new Error("Use a disposable fictional lms_test_* control.");
const control = localTarget(raw, controlName),
  suffix = randomBytes(5).toString("hex"),
  name = "lms_test_equipment_" + suffix,
  restoreName = "lms_restore_equipment_" + suffix,
  legacyName = "lms_test_equipment_legacy_" + suffix;
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
    "insert into lms.organizations(id,name) values($1,'Fictional equipment workspace')",
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
  directory = await mkdtemp(path.join(os.tmpdir(), "lms-equipment-"));
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
      "equipment",
    ]),
  );
  await org(
    admin,
    b,
    other.userId,
    selectModules(presets.cleaning, [
      ...presets.cleaning.modules.map((m) => m.id),
      "equipment",
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
const make = () => equipmentFixture(engine, owner, a);
async function ready() {
  const f = await make();
  return {
    ...f,
    equipment: await releaseEquipment(
      engine,
      owner,
      a,
      f.equipment,
      f.employee,
    ),
  };
}
async function out() {
  const f = await ready();
  return {
    ...f,
    equipment: await engine.writeEquipment(
      staff,
      a,
      checkoutEquipment(f.equipment, f.employee),
      randomUUID(),
    ),
  };
}
const active = async () =>
  (await engine.snapshot(owner, a)).equipmentCheckouts.find(
    (c) => !c.returned_at,
  )!;
it("stores editable equipment separately from consumable quantities and retains all registry revisions", async () => {
  const supplies = await inventory(engine, owner, a);
  await engine.saveRecord(
    owner,
    a,
    "stock-movements",
    movement(supplies.product, supplies.location),
    undefined,
    randomUUID(),
  );
  const f = await make(),
    before = await engine.snapshot(owner, a);
  const edited = await engine.saveRecord(
    owner,
    a,
    "equipment",
    {
      ...f.equipment.data,
      name: "Updated fictional machine",
      model: "Fictional model",
    },
    f.equipment,
    randomUUID(),
  );
  const after = await engine.snapshot(owner, a);
  expect(after.stockBalances).toEqual(before.stockBalances);
  expect(after.stockMovements).toEqual(before.stockMovements);
  expect(after.equipmentEvents.map((e) => e.action)).toEqual([
    "Register",
    "Edit",
  ]);
  expect(after.equipmentEvents[0].data.name).toBe("Fictional floor machine");
  expect(edited.revision).toBe(2);
});
it("enforces permanent case-insensitive organization IDs and current asset-tag uniqueness without global serial uniqueness", async () => {
  const f = await make();
  for (const data of [
    { ...f.equipment.data, asset_id: "machine-01", barcode: "OTHER" },
    { ...f.equipment.data, asset_id: "OTHER", barcode: "tool-001" },
  ])
    await expect(
      engine.saveRecord(owner, a, "equipment", data, undefined, randomUUID()),
    ).rejects.toMatchObject({ status: 409 });
  await engine.saveRecord(
    owner,
    a,
    "equipment",
    { ...f.equipment.data, asset_id: "MACHINE-02", barcode: "TOOL-002" },
    undefined,
    randomUUID(),
  );
  const peer = await equipmentFixture(engine, other, b);
  expect(peer.equipment.data.asset_id).toBe("MACHINE-01");
  await expect(
    engine.saveRecord(
      owner,
      a,
      "equipment",
      { ...f.equipment.data, asset_id: "RENAMED" },
      f.equipment,
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
});
it("uses one atomic active checkout, resolves identical retries and rejects distinct competing assignments", async () => {
  const f = await ready(),
    op = randomUUID(),
    req = checkoutEquipment(f.equipment, f.employee),
    results = await Promise.all([
      engine.writeEquipment(staff, a, req, op),
      engine.writeEquipment(staff, a, req, op),
    ]);
  expect(results[0]).toEqual(results[1]);
  expect((await engine.snapshot(owner, a)).equipmentCheckouts).toHaveLength(1);
  await expect(
    engine.writeEquipment(
      staff,
      a,
      { ...req, notes: "Another fictional request" },
      op,
    ),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    engine.writeEquipment(staff, a, req, randomUUID()),
  ).rejects.toMatchObject({ status: 409 });
  const c = await active(),
    back = await engine.writeEquipment(
      staff,
      a,
      equipmentAction(results[0], "return", {
        checkoutId: c.id,
        checkoutRevision: c.revision,
        returnedAt: "2026-11-06T18:00:00Z",
        condition: "Serviceable",
      }),
      randomUUID(),
    );
  expect(await engine.writeEquipment(staff, a, req, op)).toEqual(results[0]);
  expect(
    (await engine.snapshot(owner, a)).equipmentCheckouts.filter(
      (c) => !c.returned_at,
    ),
  ).toEqual([]);
  const candidates = await Promise.allSettled([
    engine.writeEquipment(
      staff,
      a,
      checkoutEquipment(back, f.employee, {
        checkedOutAt: "2026-11-06T19:00:00Z",
      }),
      randomUUID(),
    ),
    engine.writeEquipment(
      staff,
      a,
      checkoutEquipment(back, f.employee, {
        checkedOutAt: "2026-11-06T19:00:00Z",
      }),
      randomUUID(),
    ),
  ]);
  expect(candidates.filter((c) => c.status === "fulfilled")).toHaveLength(1);
  expect(candidates.filter((c) => c.status === "rejected")).toHaveLength(1);
});
it("records begin-use/return assignment revisions and the actual authorized recording operator", async () => {
  const f = await out(),
    c = await active();
  const used = await engine.writeEquipment(
    staff,
    a,
    equipmentAction(f.equipment, "begin-use", {
      checkoutId: c.id,
      checkoutRevision: c.revision,
    }),
    randomUUID(),
  );
  await expect(
    engine.writeEquipment(
      staff,
      a,
      equipmentAction(used, "return", {
        checkoutId: c.id,
        checkoutRevision: 1,
        returnedAt: "2026-11-06T17:00:00Z",
        condition: "Serviceable",
      }),
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
  const current = await active();
  await engine.writeEquipment(
    staff,
    a,
    equipmentAction(used, "return", {
      checkoutId: current.id,
      checkoutRevision: 2,
      returnedAt: "2026-11-06T17:00:00Z",
      condition: "Serviceable",
    }),
    randomUUID(),
  );
  const history = (await engine.snapshot(owner, a)).equipmentEvents;
  expect(history.map((e) => e.action)).toEqual([
    "Register",
    "release",
    "checkout",
    "begin-use",
    "return",
  ]);
  expect(history.at(-1)?.checkout).toMatchObject({
    returned_by: staff.userId,
    return_condition: "Serviceable",
    employee_id: f.employee.id,
    status: "Returned",
    revision: 3,
  });
});
it("preserves blocking problems through serviceable returns and independently requires task, service and release", async () => {
  const f = await out(),
    problem = await engine.writeEquipment(
      staff,
      a,
      equipmentAction(f.equipment, "report-problem", {
        condition: "Out of service",
      }),
      randomUUID(),
    ),
    c = await active();
  const back = await engine.writeEquipment(
    staff,
    a,
    equipmentAction(problem, "return", {
      checkoutId: c.id,
      checkoutRevision: c.revision,
      returnedAt: "2026-11-06T18:00:00Z",
      condition: "Serviceable",
    }),
    randomUUID(),
  );
  expect((await engine.snapshot(owner, a)).equipmentStates[0].condition).toBe(
    "Out of service",
  );
  await expect(
    releaseEquipment(engine, owner, a, back, f.employee),
  ).rejects.toMatchObject({ status: 409 });
  const opened = await engine.writeEquipment(
    owner,
    a,
    equipmentAction(back, "open-maintenance", {
      workId: f.work.id,
      workRevision: f.work.revision,
    }),
    randomUUID(),
  );
  const serviced = await engine.writeEquipment(
    owner,
    a,
    equipmentAction(opened, "record-service", {
      employeeId: f.employee.id,
      employeeRevision: f.employee.revision,
      serviceDate: "2026-11-06",
      nextInspection: "2026-12-06",
    }),
    randomUUID(),
  );
  expect((await engine.snapshot(owner, a)).equipmentStates[0]).toMatchObject({
    condition: "Under maintenance",
    maintenance: "Service recorded",
  });
  await expect(
    engine.writeEquipment(
      staff,
      a,
      checkoutEquipment(serviced, f.employee),
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
  const released = await releaseEquipment(
    engine,
    owner,
    a,
    serviced,
    f.employee,
  );
  expect((await engine.snapshot(owner, a)).equipmentStates[0].condition).toBe(
    "Serviceable",
  );
  expect(released.revision).toBe(8);
});
it("does not let an old release receipt replay clear a newly reported problem", async () => {
  const f = await make(),
    op = randomUUID();
  const { releaseEquipmentConfirmation } = await import(
    "../../src/core/equipment"
  );
  const req = equipmentAction(f.equipment, "release", {
    employeeId: f.employee.id,
    employeeRevision: f.employee.revision,
    serviceDate: "2026-11-06",
    nextInspection: null,
    confirmation: releaseEquipmentConfirmation,
  });
  const released = await engine.writeEquipment(owner, a, req, op);
  await engine.writeEquipment(
    staff,
    a,
    equipmentAction(released, "report-problem"),
    randomUUID(),
  );
  expect(await engine.writeEquipment(owner, a, req, op)).toEqual(released);
  expect((await engine.snapshot(owner, a)).equipmentStates[0]).toMatchObject({
    condition: "Needs inspection",
    maintenance: "Problem reported",
  });
});
it("verifies current crew membership and rejects foreign, stale, inactive, archived and unavailable related records", async () => {
  const f = await ready(),
    peer = await equipmentFixture(engine, other, b);
  const crew = await engine.saveRecord(owner, a, "resources", {
    name: "Fictional equipment crew",
    kind: "Crew",
  });
  await expect(
    engine.writeEquipment(
      staff,
      a,
      checkoutEquipment(f.equipment, f.employee, {
        resourceId: crew.id,
        resourceRevision: crew.revision,
      }),
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
  const membership = await enroll(engine, owner, a, crew, f.employee);
  const out = await engine.writeEquipment(
    staff,
    a,
    checkoutEquipment(f.equipment, f.employee, {
      resourceId: crew.id,
      resourceRevision: crew.revision,
      workId: f.work.id,
      workRevision: f.work.revision,
    }),
    randomUUID(),
  );
  expect((await active()).membership_id).toBe(membership.id);
  for (const target of [f.employee, crew, f.work, membership])
    await expect(
      engine.archiveRecord(
        owner,
        a,
        target.id,
        target.revision,
        true,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 409 });
  await expect(
    engine.saveRecord(
      owner,
      a,
      "employees",
      { ...f.employee.data, status: "Inactive" },
      f.employee,
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
  const c = await active();
  const returned = await engine.writeEquipment(
    staff,
    a,
    equipmentAction(out, "return", {
      checkoutId: c.id,
      checkoutRevision: c.revision,
      returnedAt: "2026-11-06T18:00:00Z",
      condition: "Serviceable",
    }),
    randomUUID(),
  );
  for (const changes of [
    { employeeId: peer.employee.id, employeeRevision: 1 },
    { employeeRevision: 2 },
    { workId: peer.work.id, workRevision: 1 },
  ])
    await expect(
      engine.writeEquipment(
        staff,
        a,
        checkoutEquipment(returned, f.employee, changes),
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 409 });
  const inactive = await engine.saveRecord(
    owner,
    a,
    "employees",
    { ...f.employee.data, status: "Inactive" },
    f.employee,
    randomUUID(),
  );
  await expect(
    engine.writeEquipment(
      staff,
      a,
      checkoutEquipment(returned, inactive),
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
});
it("serializes raw employee deactivation against checkout so inactive employees never retain new active assignments", async () => {
  const f = await ready();
  const r = await Promise.allSettled([
    engine.writeEquipment(
      staff,
      a,
      checkoutEquipment(f.equipment, f.employee),
      randomUUID(),
    ),
    rawTx((c) =>
      c.query(
        "update lms.records set data=jsonb_set(data,'{status}','\"Inactive\"') where organization_id=$1 and id=$2",
        [a, f.employee.id],
      ),
    ),
  ]);
  expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  const s = await engine.snapshot(owner, a);
  if (s.equipmentCheckouts.some((c) => !c.returned_at))
    expect(s.records.find((r) => r.id === f.employee.id)?.data.status).toBe(
      "Active",
    );
});
it("enforces current operator roles, revoked authority, exact configuration and foreign organization isolation", async () => {
  const f = await ready();
  for (const actor of [viewer, other])
    await expect(
      engine.writeEquipment(
        actor,
        a,
        checkoutEquipment(f.equipment, f.employee),
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 403 });
  await expect(
    engine.writeEquipment(
      staff,
      a,
      equipmentAction(f.equipment, "retire", {
        confirmation: retireEquipmentConfirmation,
      }),
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    engine.writeEquipment(
      staff,
      a,
      { ...checkoutEquipment(f.equipment, f.employee), configRevision: 2 },
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
  await admin.query(
    "delete from lms.memberships where organization_id=$1 and user_id=$2",
    [a, staff.userId],
  );
  await expect(
    engine.writeEquipment(
      staff,
      a,
      checkoutEquipment(f.equipment, f.employee),
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 403 });
  for (const table of [
    "equipment_state",
    "equipment_checkouts",
    "equipment_events",
  ])
    expect(
      (
        await engine.asUser(other, (tx) =>
          tx.query(`select * from lms.${table} where organization_id=$1`, [a]),
        )
      ).rows,
    ).toEqual([]);
});
it("makes retirement terminal without freeing identifiers, discarding history or allowing raw state/archive changes", async () => {
  const f = await ready(),
    retired = await engine.writeEquipment(
      owner,
      a,
      equipmentAction(f.equipment, "retire", {
        confirmation: retireEquipmentConfirmation,
      }),
      randomUUID(),
    );
  for (const table of [
    "equipment_state",
    "equipment_checkouts",
    "equipment_events",
  ])
    await expect(
      rawTx((c) => c.query(`delete from lms.${table}`)),
    ).rejects.toMatchObject({ code: "42501" });
  await expect(
    admin.query("update lms.equipment_events set notes='hidden correction'"),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    engine.saveRecord(
      owner,
      a,
      "equipment",
      { ...retired.data, name: "Changed retired record" },
      retired,
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    engine.archiveRecord(
      owner,
      a,
      retired.id,
      retired.revision,
      true,
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    engine.saveRecord(
      owner,
      a,
      "equipment",
      f.equipment.data,
      undefined,
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
  const state = (await engine.snapshot(owner, a)).equipmentStates[0];
  expect(state.condition).toBe("Retired");
});
it("retains disabled module history and refuses populated schema changes under existing publication rules", async () => {
  const f = await make(),
    before = await engine.snapshot(owner, a),
    config = structuredClone(before.config.document);
  config.entities.find((e) => e.id === "equipment")!.fields[0].label =
    "Renamed field";
  await expect(engine.publishConfig(owner, a, config, 1)).rejects.toThrow();
  const disabled = selectModules(
    before.config.document,
    before.config.document.modules
      .filter((m) => m.id !== "equipment")
      .map((m) => m.id),
  );
  await engine.publishConfig(owner, a, disabled, 1);
  const s = await engine.snapshot(owner, a);
  expect(s.records.some((r) => r.id === f.equipment.id)).toBe(false);
  expect(s.equipmentEvents).toEqual(before.equipmentEvents);
  expect(
    (await engine.exportWorkspace(owner, a)).records.some(
      (r) => r.id === f.equipment.id,
    ),
  ).toBe(true);
  await expect(
    engine.writeEquipment(
      owner,
      a,
      equipmentAction(f.equipment, "report-problem", { configRevision: 2 }),
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
});
it("rolls back custody, record revision, state, receipts and audits when an event append fails", async () => {
  const f = await ready(),
    op = randomUUID(),
    before = await engine.exportWorkspace(owner, a);
  await admin.query(
    "create function lms_private.test_equipment_failure() returns trigger language plpgsql as $$begin raise exception 'Injected equipment failure' using errcode='23514';end$$;create trigger test_equipment_failure before insert on lms.equipment_events for each row execute function lms_private.test_equipment_failure()",
  );
  try {
    await expect(
      engine.writeEquipment(
        staff,
        a,
        checkoutEquipment(f.equipment, f.employee),
        op,
      ),
    ).rejects.toMatchObject({ status: 409 });
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
      "drop trigger test_equipment_failure on lms.equipment_events;drop function lms_private.test_equipment_failure()",
    );
  }
  await engine.writeEquipment(
    staff,
    a,
    checkoutEquipment(f.equipment, f.employee),
    op,
  );
  expect((await engine.snapshot(owner, a)).equipmentCheckouts).toHaveLength(1);
});
it("persists custody and immutable equipment/maintenance history across reconnect and a native quarantined restore", async () => {
  const f = await out(),
    c = await active();
  const returned = await engine.writeEquipment(
    staff,
    a,
    equipmentAction(f.equipment, "return", {
      checkoutId: c.id,
      checkoutRevision: c.revision,
      returnedAt: "2026-11-06T18:00:00Z",
      condition: "Needs inspection",
    }),
    randomUUID(),
  );
  const opened = await engine.writeEquipment(
    owner,
    a,
    equipmentAction(returned, "open-maintenance", {
      workId: f.work.id,
      workRevision: f.work.revision,
    }),
    randomUUID(),
  );
  const serviced = await engine.writeEquipment(
    owner,
    a,
    equipmentAction(opened, "record-service", {
      employeeId: f.employee.id,
      employeeRevision: f.employee.revision,
      serviceDate: "2026-11-06",
      nextInspection: "2026-12-06",
    }),
    randomUUID(),
  );
  const released = await releaseEquipment(
    engine,
    owner,
    a,
    serviced,
    f.employee,
  );
  await engine.saveRecord(
    owner,
    a,
    "equipment",
    { ...released.data, model: "Retained fictional repair model" },
    released,
    randomUUID(),
  );
  const review = (await engine.snapshot(owner, a)).config;
  await engine.publishConfig(
    owner,
    a,
    selectModules(review.document, [
      ...review.document.modules.map((m) => m.id),
      "equipment-reservations",
    ]),
    review.revision,
  );
  const current = await engine.snapshot(owner, a);
  const machine = current.records.find((r) => r.id === released.id)!;
  const w = await workflow(engine, owner, a, "property");
  w.resource = await engine.saveRecord(owner, a, "resources", {
    name: "Fictional retained machine calendar",
    kind: "Equipment",
  });
  await engine.mapEquipment(
    owner,
    a,
    mappingRequest(machine, w.resource, current.config.revision),
    randomUUID(),
  );
  await engine.saveRecord(
    owner,
    a,
    "appointments",
    appointmentData(w),
    undefined,
    randomUUID(),
  );
  await engine.saveRecord(
    owner,
    a,
    "appointments",
    appointmentData(w, {
      title: "Retained cancelled reservation",
      status: "Cancelled",
      start: "2026-11-06T20:00:00Z",
      end: "2026-11-06T21:00:00Z",
    }),
    undefined,
    randomUUID(),
  );
  const cancelled = await engine.saveRecord(
    owner,
    a,
    "appointments",
    appointmentData(w, {
      title: "Retained cancelled history",
      start: "2026-11-06T21:00:00Z",
      end: "2026-11-06T22:00:00Z",
    }),
    undefined,
    randomUUID(),
  );
  await engine.saveRecord(
    owner,
    a,
    "appointments",
    { ...cancelled.data, status: "Cancelled" },
    cancelled,
    randomUUID(),
  );
  const before = await engine.exportWorkspace(owner, a);
  expect(before.equipmentMappings).toHaveLength(1);
  expect(before.equipmentReservations.some((r) => !r.blocking)).toBe(true);
  expect(
    before.equipmentEvents.some((e) => e.action === "record-service"),
  ).toBe(true);
  expect(before.equipmentStates[0].next_inspection).toBe("2026-12-06");
  await db.close();
  db = await connectPostgres({
    connectionString: url(name, true),
    maxConnections: 4,
  });
  engine = new Engine(db);
  const reconnect = await engine.snapshot(owner, a);
  expect(reconnect.equipmentEvents).toEqual(before.equipmentEvents);
  expect(reconnect.equipmentMappings).toEqual(before.equipmentMappings);
  expect(reconnect.equipmentReservations).toEqual(before.equipmentReservations);
  const child = await promisify(execFile)(
    process.execPath,
    [
      "--import=tsx",
      "--input-type=module",
      "-e",
      `
    import { connectPostgres } from './src/server/postgres/adapter.ts';
    import { Engine } from './src/core/engine.ts';
    const db=await connectPostgres({connectionString:process.env.LMS_FICTIONAL_RESTART_URL});
    try { const s=await new Engine(db).snapshot({userId:process.env.LMS_FICTIONAL_RESTART_ACTOR},process.env.LMS_FICTIONAL_RESTART_ORG);
      process.stdout.write(JSON.stringify({mappings:s.equipmentMappings,reservations:s.equipmentReservations}));
    } finally { await db.close(); }
  `,
    ],
    {
      env: {
        ...process.env,
        LMS_FICTIONAL_RESTART_URL: url(name, true),
        LMS_FICTIONAL_RESTART_ACTOR: owner.userId,
        LMS_FICTIONAL_RESTART_ORG: a,
      },
      timeout: 20000,
    },
  );
  expect(JSON.parse(child.stdout)).toEqual(
    JSON.parse(
      JSON.stringify({
        mappings: before.equipmentMappings,
        reservations: before.equipmentReservations,
      }),
    ),
  );

  const tables = [
      "lms.records",
      "lms.equipment_state",
      "lms.equipment_checkouts",
      "lms.equipment_events",
      "lms.equipment_resource_mappings",
      "lms.equipment_mapping_history",
      "lms.equipment_reservations",
      "lms.appointments",
      "lms.appointment_staff",
      "lms.record_operations",
      "lms.audit_events",
      "lms.config_revisions",
    ],
    expected: unknown[] = [];
  for (const table of tables)
    expected.push(
      (
        await admin.query(
          `select * from ${table} where organization_id=$1 order by to_jsonb(${table.split(".")[1]})::text`,
          [a],
        )
      ).rows,
    );
  const file = path.join(directory, "equipment-history.dump");
  await backupDatabase(url(), name, file, process.env.LMS_PG_BIN);
  await restoreDatabase(
    url(restoreName),
    restoreName,
    file,
    process.env.LMS_PG_BIN,
  );
  await client(restoreName, false, async (c) => {
    for (const [i, table] of tables.entries())
      expect(
        (
          await c.query(
            `select * from ${table} where organization_id=$1 order by to_jsonb(${table.split(".")[1]})::text`,
            [a],
          )
        ).rows,
      ).toEqual(expected[i]);
    expect(
      (await c.query("select lms_control.is_blocked() as blocked")).rows[0]
        .blocked,
    ).toBe(true);
    await c.query("begin;set local role lms_app");
    await c.query("select set_config('lms.user_id',$1,true)", [other.userId]);
    expect(
      (
        await c.query(
          "select * from lms.equipment_events where organization_id=$1",
          [a],
        )
      ).rows,
    ).toEqual([]);
    for (const table of [
      "equipment_resource_mappings",
      "equipment_mapping_history",
      "equipment_reservations",
    ]) {
      expect(
        (
          await c.query(`select * from lms.${table} where organization_id=$1`, [
            a,
          ])
        ).rows,
      ).toEqual([]);
    }
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
it("requires explicit stopped-host migration before equipment enablement without altering earlier records", async () => {
  await client(legacyName, false, async (c) => {
    await migrate(c, (await loadMigrations()).slice(0, 16));
    await c.query(
      "insert into lms.users values($1,'Legacy fictional equipment owner')",
      [owner.userId],
    );
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
            "equipment",
          ]),
          1,
        ),
      ).rejects.toMatchObject({ status: 409 });
      await expect(migrate(c)).rejects.toThrow(/Stop runtime/);
    } finally {
      await legacy.close();
    }
    expect(await migrate(c)).toEqual([
      "017_equipment_lifecycle",
      "018_equipment_reservations",
    ]);
    expect((await c.query("select * from lms.equipment_events")).rows).toEqual(
      [],
    );
  });
});
it("serializes crew membership changes against checkout and protects the effective membership snapshot", async () => {
  const f = await ready(),
    crew = await engine.saveRecord(owner, a, "resources", {
      name: "Fictional checkout crew",
      kind: "Crew",
    }),
    membership = await enroll(engine, owner, a, crew, f.employee);
  const results = await Promise.allSettled([
    engine.writeEquipment(
      staff,
      a,
      checkoutEquipment(f.equipment, f.employee, {
        resourceId: crew.id,
        resourceRevision: crew.revision,
      }),
      randomUUID(),
    ),
    engine.saveRecord(
      owner,
      a,
      "resource-memberships",
      { ...membership.data, end: "2026-11-06T15:00:00Z" },
      membership,
      randomUUID(),
    ),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const s = await engine.snapshot(owner, a),
    out = s.equipmentCheckouts.find((c) => !c.returned_at);
  if (out) {
    expect(out.membership_id).toBe(membership.id);
    expect(s.records.find((r) => r.id === membership.id)?.data.end).toBe(
      membership.data.end,
    );
  }
});
it("fails closed on missing state and malformed commands without modifying historical snapshots", async () => {
  const f = await make();
  const before = (await engine.snapshot(owner, a)).equipmentEvents;
  await expect(
    rawTx((c) =>
      c.query("select lms.write_equipment($1,$2,$3)", [
        a,
        randomUUID(),
        { ...equipmentAction(f.equipment, "report-problem"), sql: "select 1" },
      ]),
    ),
  ).rejects.toMatchObject({ code: "23514" });
  await admin.query(
    "delete from lms.equipment_state where organization_id=$1 and record_id=$2",
    [a, f.equipment.id],
  );
  await expect(
    engine.writeEquipment(
      owner,
      a,
      equipmentAction(f.equipment, "report-problem"),
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect((await engine.snapshot(owner, a)).equipmentEvents).toEqual(before);
});
it("rechecks sensitive-action authority even for an exact historical release retry after an admin becomes staff", async () => {
  const f = await make(),
    op = randomUUID(),
    { releaseEquipmentConfirmation } = await import("../../src/core/equipment");
  await admin.query(
    "update lms.memberships set role='admin' where organization_id=$1 and user_id=$2",
    [a, staff.userId],
  );
  const req = equipmentAction(f.equipment, "release", {
    employeeId: f.employee.id,
    employeeRevision: f.employee.revision,
    serviceDate: "2026-11-06",
    nextInspection: null,
    confirmation: releaseEquipmentConfirmation,
  });
  await engine.writeEquipment(staff, a, req, op);
  await admin.query(
    "update lms.memberships set role='staff' where organization_id=$1 and user_id=$2",
    [a, staff.userId],
  );
  await expect(engine.writeEquipment(staff, a, req, op)).rejects.toMatchObject({
    status: 403,
  });
  expect((await engine.snapshot(owner, a)).equipmentEvents).toHaveLength(2);
});
it("refuses a frozen repeatable-read operator snapshot after membership revocation", async () => {
  const f = await ready();
  await client(name, true, async (c) => {
    await c.query(
      "begin isolation level repeatable read;set local role lms_app",
    );
    await c.query("select set_config('lms.user_id',$1,true)", [staff.userId]);
    await c.query("select * from lms.memberships where organization_id=$1", [
      a,
    ]);
    await admin.query(
      "delete from lms.memberships where organization_id=$1 and user_id=$2",
      [a, staff.userId],
    );
    try {
      await expect(
        c.query("select lms.write_equipment($1,$2,$3)", [
          a,
          randomUUID(),
          checkoutEquipment(f.equipment, f.employee),
        ]),
      ).rejects.toMatchObject({ code: "40001" });
    } finally {
      await c.query("rollback");
    }
  });
  expect((await engine.snapshot(owner, a)).equipmentCheckouts).toEqual([]);
});
it("serializes competing equipment reservations using the existing resource exclusion, with back-to-back support", async () => {
  const f = await reservationFixture(engine, owner, a);
  const attempts = await Promise.allSettled([
    engine.saveRecord(
      owner,
      a,
      "appointments",
      f.data,
      undefined,
      randomUUID(),
    ),
    engine.saveRecord(
      staff,
      a,
      "appointments",
      f.data,
      undefined,
      randomUUID(),
    ),
  ]);
  expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(attempts.filter((r) => r.status === "rejected")).toHaveLength(1);
  const back = await engine.saveRecord(
    staff,
    a,
    "appointments",
    { ...f.data, start: "2026-11-06T19:00:00Z", end: "2026-11-06T20:00:00Z" },
    undefined,
    randomUUID(),
  );
  await expect(
    engine.saveRecord(
      owner,
      a,
      "appointments",
      { ...back.data, start: "2026-11-06T18:30:00Z" },
      back,
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect((await engine.snapshot(owner, a)).equipmentReservations).toHaveLength(
    2,
  );
});
it("atomically serializes mapping competitors and exact receipts while retaining permanent physical enrollment", async () => {
  const f = await reservationFixture(engine, owner, a);
  const unmap = { ...f.request, kind: "unmap", mappingRevision: 1 };
  await engine.mapEquipment(owner, a, unmap, randomUUID());
  const req = { ...f.request, mappingRevision: 2 },
    op = randomUUID();
  const both = await Promise.all([
    engine.mapEquipment(owner, a, req, op),
    engine.mapEquipment(owner, a, req, op),
  ]);
  expect(both[0]).toEqual(both[1]);
  await expect(
    engine.mapEquipment(
      owner,
      a,
      { ...req, notes: "Conflicting concurrent mapping request" },
      op,
    ),
  ).rejects.toMatchObject({ status: 409 });
  const bookings = await engine.saveRecord(
    owner,
    a,
    "appointments",
    f.data,
    undefined,
    randomUUID(),
  );
  await expect(
    engine.mapEquipment(
      owner,
      a,
      { ...unmap, mappingRevision: 3 },
      randomUUID(),
    ),
  ).rejects.toThrow(/blocking/i);
  await engine.archiveRecord(
    owner,
    a,
    bookings.id,
    bookings.revision,
    true,
    randomUUID(),
  );
  await engine.mapEquipment(
    owner,
    a,
    { ...unmap, mappingRevision: 3 },
    randomUUID(),
  );
  const different = await engine.saveRecord(
    owner,
    a,
    "equipment",
    { ...f.equipment.data, asset_id: "ANOTHER", barcode: "ANOTHER" },
    undefined,
    randomUUID(),
  );
  await expect(
    engine.mapEquipment(
      owner,
      a,
      mappingRequest(different, f.workflow.resource, 2),
      randomUUID(),
    ),
  ).rejects.toThrow(/physical.*identity/i);
  expect(
    (await engine.snapshot(owner, a)).equipmentMappingHistory,
  ).toHaveLength(4);
});
it("records maintenance even with future reservations and serializes safety changes against bookings without hiding history", async () => {
  const f = await reservationFixture(engine, owner, a);
  await engine.saveRecord(
    owner,
    a,
    "appointments",
    f.data,
    undefined,
    randomUUID(),
  );
  const operations = await Promise.allSettled([
    engine.writeEquipment(
      staff,
      a,
      equipmentAction(f.equipment, "report-problem"),
      randomUUID(),
    ),
    engine.saveRecord(
      owner,
      a,
      "appointments",
      { ...f.data, start: "2026-11-06T20:00:00Z", end: "2026-11-06T21:00:00Z" },
      undefined,
      randomUUID(),
    ),
  ]);
  expect(operations[0].status).toBe("fulfilled");
  const s = await engine.snapshot(owner, a);
  expect(s.equipmentStates[0].condition).toBe("Needs inspection");
  expect(s.equipmentReservations.length).toBeGreaterThanOrEqual(1);
  await expect(
    engine.saveRecord(
      owner,
      a,
      "appointments",
      { ...f.data, start: "2026-11-06T22:00:00Z", end: "2026-11-06T23:00:00Z" },
      undefined,
      randomUUID(),
    ),
  ).rejects.toThrow(/unsafe/i);
  expect(
    s.records
      .filter((r) => r.entity === "appointments")
      .every((r) => r.data.status === "Scheduled" && !r.archived),
  ).toBe(true);
});
it("rejects foreign references, stale configuration and resource cursors, revoked roles and direct projection writes", async () => {
  const f = await reservationFixture(engine, owner, a),
    foreign = await reservationFixture(engine, other, b, "cleaning");
  await expect(
    engine.mapEquipment(
      owner,
      a,
      {
        ...f.request,
        resourceId: foreign.workflow.resource.id,
        mappingRevision: 1,
      },
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    engine.mapEquipment(
      owner,
      a,
      { ...f.request, configRevision: 1, mappingRevision: 1 },
      randomUUID(),
    ),
  ).rejects.toThrow(/configuration/i);
  const resource = await engine.saveRecord(
    owner,
    a,
    "resources",
    { ...f.workflow.resource.data, name: "Reviewed revised calendar" },
    f.workflow.resource,
    randomUUID(),
  );
  await expect(
    engine.mapEquipment(
      owner,
      a,
      { ...f.request, mappingRevision: 1, kind: "unmap" },
      randomUUID(),
    ),
  ).rejects.toThrow(/exact revision/i);
  const op = randomUUID(),
    req = mappingRequest(f.equipment, resource, 2, 1, "unmap");
  await engine.mapEquipment(owner, a, req, op);
  await admin.query(
    "update lms.memberships set role='staff' where organization_id=$1 and user_id=$2",
    [a, owner.userId],
  );
  await expect(engine.mapEquipment(owner, a, req, op)).rejects.toMatchObject({
    status: 403,
  });
  await rawTx(async (c) => {
    expect(
      (
        await c.query(
          "select * from lms.equipment_resource_mappings where organization_id=$1",
          [b],
        )
      ).rows,
    ).toEqual([]);
  });
  for (const table of [
    "equipment_resource_mappings",
    "equipment_mapping_history",
    "equipment_reservations",
  ])
    await expect(
      rawTx((c) =>
        c.query(`delete from lms.${table} where organization_id=$1`, [a]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
});
it("rolls back mapping and booking projections, audits and receipts when an immutable history insert fails", async () => {
  const f = await reservationFixture(engine, owner, a);
  const before = await engine.exportWorkspace(owner, a),
    op = randomUUID();
  await admin.query(
    "create function lms_private.pr33_fail_history() returns trigger language plpgsql as $$begin raise exception 'Injected fictional failure';end;$$",
  );
  await admin.query(
    "create trigger pr33_fail before insert on lms.equipment_reservations for each row execute function lms_private.pr33_fail_history()",
  );
  try {
    await expect(
      engine.saveRecord(owner, a, "appointments", f.data, undefined, op),
    ).rejects.toThrow();
  } finally {
    await admin.query("drop trigger pr33_fail on lms.equipment_reservations");
  }
  expect(await engine.exportWorkspace(owner, a)).toEqual({
    ...before,
    exportedAt: expect.any(String),
  });
  await engine.saveRecord(owner, a, "appointments", f.data, undefined, op);
  const appointment = (await engine.snapshot(owner, a)).records.find(
    (r) => r.entity === "appointments",
  )!;
  await engine.archiveRecord(
    owner,
    a,
    appointment.id,
    appointment.revision,
    true,
    randomUUID(),
  );
  const mappingBefore = await engine.exportWorkspace(owner, a),
    mappingOp = randomUUID(),
    req = { ...f.request, kind: "unmap", mappingRevision: 1 };
  await admin.query(
    "create trigger pr33_fail before insert on lms.equipment_mapping_history for each row execute function lms_private.pr33_fail_history()",
  );
  try {
    await expect(
      engine.mapEquipment(owner, a, req, mappingOp),
    ).rejects.toThrow();
  } finally {
    await admin.query(
      "drop trigger pr33_fail on lms.equipment_mapping_history",
    );
    await admin.query("drop function lms_private.pr33_fail_history()");
  }
  expect(await engine.exportWorkspace(owner, a)).toEqual({
    ...mappingBefore,
    exportedAt: expect.any(String),
  });
  await engine.mapEquipment(owner, a, req, mappingOp);
});
it("refuses frozen repeatable-read mapping authority after owner revocation", async () => {
  const f = await reservationFixture(engine, owner, a);
  await client(name, true, async (c) => {
    await c.query(
      "begin isolation level repeatable read;set local role lms_app",
    );
    await c.query("select set_config('lms.user_id',$1,true)", [owner.userId]);
    await c.query("select * from lms.memberships where organization_id=$1", [
      a,
    ]);
    await admin.query(
      "update lms.memberships set role='staff' where organization_id=$1 and user_id=$2",
      [a, owner.userId],
    );
    try {
      await expect(
        c.query("select lms.write_equipment_mapping($1,$2,$3::jsonb)", [
          a,
          randomUUID(),
          { ...f.request, kind: "unmap", mappingRevision: 1 },
        ]),
      ).rejects.toMatchObject({ code: "40001" });
    } finally {
      await c.query("rollback");
    }
  });
  expect(
    (await engine.snapshot(owner, a)).equipmentMappingHistory,
  ).toHaveLength(1);
});
