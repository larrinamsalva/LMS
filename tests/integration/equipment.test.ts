import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createDatabase, sqlDatabase } from "../../src/server/database";
import { Engine } from "../../src/core/engine";
import { presets } from "../../src/presets";
import { selectModules } from "../../src/core/buildplan";
import {
  equipmentFixture,
  releaseEquipment,
  checkoutEquipment,
  equipmentAction,
} from "../helpers/equipment";
import { retireEquipmentConfirmation } from "../../src/core/equipment";
let db: PGlite, engine: Engine, org: string;
const owner = { userId: randomUUID() },
  staff = { userId: randomUUID() },
  other = { userId: randomUUID() };
beforeAll(async () => {
  db = await createDatabase();
  engine = new Engine(sqlDatabase(db));
  for (const p of [owner, staff, other])
    await db.query(
      "insert into lms.users values($1,'Fictional equipment operator')",
      [p.userId],
    );
});
beforeEach(async () => {
  org = randomUUID();
  await db.query(
    "insert into lms.organizations values($1,'Fictional equipment')",
    [org],
  );
  await db.query(
    "insert into lms.memberships values($1,$2,'owner'),($1,$3,'staff')",
    [org, owner.userId, staff.userId],
  );
  const config = selectModules(presets.property, [
    ...presets.property.modules.map((m) => m.id),
    "equipment",
  ]);
  await db.transaction(async (tx) => {
    await tx.query("select set_config('lms.user_id',$1,true)", [owner.userId]);
    await tx.query(
      "insert into lms.config_revisions(organization_id,revision,document,created_by) values($1,1,$2,$3)",
      [org, config, owner.userId],
    );
  });
});
afterAll(async () => {
  await db?.close();
});
it("starts blocked for inspection, reviews release, atomically checks out, returns and preserves every revision", async () => {
  const f = await equipmentFixture(engine, owner, org);
  expect((await engine.snapshot(owner, org)).equipmentStates[0].condition).toBe(
    "Needs inspection",
  );
  await expect(
    engine.writeEquipment(
      staff,
      org,
      checkoutEquipment(f.equipment, f.employee),
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
  const ready = await releaseEquipment(
      engine,
      owner,
      org,
      f.equipment,
      f.employee,
    ),
    op = randomUUID(),
    req = checkoutEquipment(ready, f.employee);
  const out = await engine.writeEquipment(staff, org, req, op);
  expect(await engine.writeEquipment(staff, org, req, op)).toEqual(out);
  await expect(
    engine.writeEquipment(
      staff,
      org,
      { ...req, notes: "Different fictional request" },
      op,
    ),
  ).rejects.toMatchObject({ status: 409 });
  const s = await engine.snapshot(owner, org),
    c = s.equipmentCheckouts[0];
  expect(c.employee_id).toBe(f.employee.id);
  const returned = await engine.writeEquipment(
    staff,
    org,
    equipmentAction(out, "return", {
      checkoutId: c.id,
      checkoutRevision: c.revision,
      returnedAt: "2026-11-07T15:00:00Z",
      condition: "Serviceable",
    }),
    randomUUID(),
  );
  expect(returned.revision).toBe(4);
  const after = await engine.snapshot(owner, org);
  expect(after.equipmentEvents.map((e) => e.action)).toEqual([
    "Register",
    "release",
    "checkout",
    "return",
  ]);
  expect(after.equipmentCheckouts[0].status).toBe("Returned");
  expect(after.equipmentStates[0].condition).toBe("Serviceable");
});
it("keeps an unresolved reported problem blocked even after a serviceable return and requires task/service/release reviews", async () => {
  const f = await equipmentFixture(engine, owner, org),
    ready = await releaseEquipment(engine, owner, org, f.equipment, f.employee);
  const out = await engine.writeEquipment(
    staff,
    org,
    checkoutEquipment(ready, f.employee),
    randomUUID(),
  );
  const reported = await engine.writeEquipment(
    staff,
    org,
    equipmentAction(out, "report-problem"),
    randomUUID(),
  );
  const c = (await engine.snapshot(owner, org)).equipmentCheckouts[0];
  const returned = await engine.writeEquipment(
    staff,
    org,
    equipmentAction(reported, "return", {
      checkoutId: c.id,
      checkoutRevision: c.revision,
      returnedAt: "2026-11-06T17:00:00Z",
      condition: "Serviceable",
    }),
    randomUUID(),
  );
  expect((await engine.snapshot(owner, org)).equipmentStates[0].condition).toBe(
    "Needs inspection",
  );
  await expect(
    releaseEquipment(engine, owner, org, returned, f.employee),
  ).rejects.toMatchObject({ status: 409 });
  const opened = await engine.writeEquipment(
    owner,
    org,
    equipmentAction(returned, "open-maintenance", {
      workId: f.work.id,
      workRevision: f.work.revision,
    }),
    randomUUID(),
  );
  const serviced = await engine.writeEquipment(
    owner,
    org,
    equipmentAction(opened, "record-service", {
      employeeId: f.employee.id,
      employeeRevision: f.employee.revision,
      serviceDate: "2026-11-06",
      nextInspection: "2026-12-06",
    }),
    randomUUID(),
  );
  expect((await engine.snapshot(owner, org)).equipmentStates[0].condition).toBe(
    "Under maintenance",
  );
  const released = await releaseEquipment(
    engine,
    owner,
    org,
    serviced,
    f.employee,
  );
  const retired = await engine.writeEquipment(
    owner,
    org,
    equipmentAction(released, "retire", {
      confirmation: retireEquipmentConfirmation,
    }),
    randomUUID(),
  );
  expect((await engine.snapshot(owner, org)).equipmentStates[0].condition).toBe(
    "Retired",
  );
  await expect(
    engine.writeEquipment(
      owner,
      org,
      equipmentAction(retired, "report-problem"),
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
});
it("protects roles, scoped unique identifiers, active employees, raw state, history and retained stock/configuration", async () => {
  const f = await equipmentFixture(engine, owner, org);
  await expect(
    engine.saveRecord(
      owner,
      org,
      "equipment",
      { ...f.equipment.data, asset_id: "machine-01", barcode: "OTHER" },
      undefined,
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    engine.saveRecord(
      staff,
      org,
      "equipment",
      f.equipment.data,
      undefined,
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    engine.writeEquipment(
      other,
      org,
      equipmentAction(f.equipment, "report-problem"),
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    engine.asUser(owner, (tx) =>
      tx.query("update lms.equipment_state set condition='Serviceable'"),
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    engine.asUser(owner, (tx) => tx.query("delete from lms.equipment_events")),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    engine.archiveRecord(
      owner,
      org,
      f.equipment.id,
      f.equipment.revision,
      true,
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect((await engine.snapshot(owner, org)).stockMovements).toEqual([]);
  const inactive = await engine.saveRecord(
    owner,
    org,
    "employees",
    { ...f.employee.data, status: "Inactive" },
    f.employee,
    randomUUID(),
  );
  await expect(
    releaseEquipment(engine, owner, org, f.equipment, inactive),
  ).rejects.toMatchObject({ status: 409 });
});
