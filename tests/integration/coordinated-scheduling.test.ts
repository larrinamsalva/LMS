import { afterAll, beforeAll, beforeEach, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createDatabase, sqlDatabase } from "../../src/server/database";
import { Engine } from "../../src/core/engine";
import { presets } from "../../src/presets";
import { coordinatedFixture } from "../helpers/coordinated-scheduling";
import { equipmentAction, checkoutEquipment } from "../helpers/equipment";
import { period } from "../helpers/workforce";
import { mappingRequest } from "../helpers/equipment-reservations";
import { reviewAppointmentResources } from "../../src/core/coordinated-scheduling";
let db: PGlite, engine: Engine, org: string;
const owner = { userId: randomUUID() },
  staff = { userId: randomUUID() },
  other = { userId: randomUUID() };
beforeAll(async () => {
  db = await createDatabase();
  engine = new Engine(sqlDatabase(db));
  for (const p of [owner, staff, other])
    await db.query(
      "insert into lms.users values($1,'Fictional coordinated operator')",
      [p.userId],
    );
});
beforeEach(async () => {
  org = randomUUID();
  await db.query(
    "insert into lms.organizations values($1,'Fictional coordinated workspace')",
    [org],
  );
  await db.query(
    "insert into lms.memberships values($1,$2,'owner'),($1,$3,'staff')",
    [org, owner.userId, staff.userId],
  );
  await db.transaction(async (tx) => {
    await tx.query("select set_config('lms.user_id',$1,true)", [owner.userId]);
    await tx.query(
      "insert into lms.config_revisions(organization_id,revision,document,created_by) values($1,1,$2,$3)",
      [org, presets.property, owner.userId],
    );
  });
});
afterAll(async () => {
  await db?.close();
});
it("atomically reserves both resources, snapshots workforce/equipment and returns exact receipts", async () => {
  const f = await coordinatedFixture(engine, owner, org),
    op = randomUUID(),
    saved = await engine.saveRecord(
      staff,
      org,
      "appointments",
      f.data,
      undefined,
      op,
      f.resources,
    );
  expect(
    await engine.saveRecord(
      staff,
      org,
      "appointments",
      f.data,
      undefined,
      op,
      f.resources,
    ),
  ).toEqual(saved);
  const s = await engine.snapshot(owner, org),
    alloc = s.appointmentAllocations.filter(
      (a) => a.appointment_id === saved.id,
    );
  expect(alloc.map((a) => a.resource_id).sort()).toEqual(
    [f.primary.id, f.workflow.resource.id].sort(),
  );
  expect(alloc.every((a) => a.blocking && a.present)).toBe(true);
  expect(
    s.staffAssignments
      .filter((a) => a.appointment_id === saved.id && a.active)
      .map((a) => a.employee_id),
  ).toEqual([f.person.profile.id]);
  expect(
    s.equipmentReservations.find((a) => a.appointment_id === saved.id)!
      .equipment_id,
  ).toBe(f.equipment.id);
  expect(s.equipmentCheckouts).toHaveLength(0);
  await expect(
    engine.saveRecord(staff, org, "appointments", f.data, undefined, op, {
      ...f.resources,
      equipment: null,
    }),
  ).rejects.toMatchObject({ status: 409 });
});
it("rejects cross-slot and same-slot collisions and permits back-to-back intervals", async () => {
  const f = await coordinatedFixture(engine, owner, org);
  await engine.saveRecord(
    owner,
    org,
    "appointments",
    f.data,
    undefined,
    randomUUID(),
    f.resources,
  );
  for (const changes of [
    { resource: f.primary.id },
    { resource: f.workflow.resource.id },
  ])
    await expect(
      engine.saveRecord(
        owner,
        org,
        "appointments",
        { ...f.data, ...changes },
        undefined,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 409 });
  const otherPrimary = await engine.saveRecord(owner, org, "resources", {
    name: "Other unstaffed crew",
    kind: "Crew",
  });
  await expect(
    engine.saveRecord(
      owner,
      org,
      "appointments",
      { ...f.data, resource: otherPrimary.id },
      undefined,
      randomUUID(),
      {
        ...f.resources,
        primaryId: otherPrimary.id,
        primaryRevision: otherPrimary.revision,
      },
    ),
  ).rejects.toMatchObject({ status: 409 });
  const adjacent = await engine.saveRecord(
    owner,
    org,
    "appointments",
    { ...f.data, start: "2026-11-06T19:00:00Z", end: "2026-11-06T20:00:00Z" },
    undefined,
    randomUUID(),
    f.resources,
  );
  expect(adjacent.id).toBeTruthy();
});
it("releases and restores both allocations without losing immutable revisions or adopting stale equipment", async () => {
  const f = await coordinatedFixture(engine, owner, org),
    saved = await engine.saveRecord(
      owner,
      org,
      "appointments",
      f.data,
      undefined,
      randomUUID(),
      f.resources,
    );
  await expect(
    engine.saveRecord(
      owner,
      org,
      "appointments",
      { ...f.data, notes: "Legacy client cannot drop equipment" },
      saved,
      randomUUID(),
    ),
  ).rejects.toThrow(/both current resources/i);
  const cancelled = await engine.saveRecord(
    staff,
    org,
    "appointments",
    { ...f.data, status: "Cancelled" },
    saved,
    randomUUID(),
  );
  expect(
    (await engine.snapshot(owner, org)).appointmentAllocations.every(
      (a) => !a.blocking,
    ),
  ).toBe(true);
  const restored = await engine.saveRecord(
    owner,
    org,
    "appointments",
    f.data,
    cancelled,
    randomUUID(),
    f.resources,
  );
  await engine.archiveRecord(
    owner,
    org,
    restored.id,
    restored.revision,
    true,
    randomUUID(),
  );
  await expect(
    engine.archiveRecord(
      owner,
      org,
      restored.id,
      restored.revision + 1,
      false,
      randomUUID(),
    ),
  ).rejects.toThrow(/both current resources/i);
  await engine.archiveRecord(
    owner,
    org,
    restored.id,
    restored.revision + 1,
    false,
    randomUUID(),
    f.resources,
  );
  const s = await engine.snapshot(owner, org);
  expect(s.appointmentAllocationHistory).toHaveLength(10);
  expect(s.appointmentAllocations.every((a) => a.blocking)).toBe(true);
  const removed = await engine.saveRecord(
    owner,
    org,
    "appointments",
    f.data,
    { id: saved.id, revision: 5 },
    randomUUID(),
    { ...f.resources, equipment: null },
  );
  expect(
    (await engine.snapshot(owner, org)).appointmentAllocations.find(
      (a) => a.slot === "Equipment",
    )!.present,
  ).toBe(false);
  expect(removed.revision).toBe(6);
});
it("always records problems, retains customer appointments, refuses unsafe restores and blocks mapping changes while secondary-reserved", async () => {
  const f = await coordinatedFixture(engine, owner, org),
    saved = await engine.saveRecord(
      owner,
      org,
      "appointments",
      f.data,
      undefined,
      randomUUID(),
      f.resources,
    );
  await expect(
    engine.mapEquipment(
      owner,
      org,
      mappingRequest(
        f.equipment,
        f.workflow.resource,
        f.resources.configRevision,
        1,
        "unmap",
      ),
      randomUUID(),
    ),
  ).rejects.toThrow(/blocking.*reservations/i);
  await engine.writeEquipment(
    staff,
    org,
    equipmentAction(
      { ...f.equipment, config_revision: f.resources.configRevision },
      "report-problem",
    ),
    randomUUID(),
  );
  const s = await engine.snapshot(owner, org);
  expect(s.records.find((r) => r.id === saved.id)).toEqual(saved);
  expect(s.appointmentAllocations.every((a) => a.blocking)).toBe(true);
  const cancelled = await engine.saveRecord(
    owner,
    org,
    "appointments",
    { ...f.data, status: "Cancelled" },
    saved,
    randomUUID(),
  );
  const changed = await engine.snapshot(owner, org),
    review = reviewAppointmentResources(
      changed.config.revision,
      changed.records,
      changed.equipmentMappings,
      f.primary.id,
      f.workflow.resource.id,
    );
  await expect(
    engine.saveRecord(
      owner,
      org,
      "appointments",
      f.data,
      cancelled,
      randomUUID(),
      review,
    ),
  ).rejects.toThrow(/unsafe/i);
});
it("keeps crew time off and additional resource windows authoritative without manufacturing employees", async () => {
  const f = await coordinatedFixture(engine, owner, org),
    saved = await engine.saveRecord(
      owner,
      org,
      "appointments",
      f.data,
      undefined,
      randomUUID(),
      f.resources,
    );
  for (const target of <Record<string, string>[]>[
    { employee: f.person.profile.id },
    { resource: f.workflow.resource.id },
  ])
    await expect(
      engine.saveRecord(
        owner,
        org,
        "availability",
        period({ ...target, kind: "Unavailable" }),
        undefined,
        randomUUID(),
      ),
    ).rejects.toThrow(/unavailable/i);
  await expect(
    engine.saveRecord(
      owner,
      org,
      "resource-memberships",
      { ...f.membership.data, end: "2026-11-06T18:30:00Z" },
      f.membership,
      randomUUID(),
    ),
  ).rejects.toThrow(/reserved work/i);
  const s = await engine.snapshot(owner, org);
  expect(
    s.staffAssignments.filter((a) => a.appointment_id === saved.id && a.active),
  ).toHaveLength(1);
});
it("refuses stale config, resource and mapping proofs, foreign actors and incomplete approvals", async () => {
  const f = await coordinatedFixture(engine, owner, org);
  for (const changed of [
    { configRevision: 1 },
    { primaryRevision: 2 },
    { equipment: { ...f.resources.equipment!, mappingRevision: 2 } },
    { equipment: { ...f.resources.equipment!, equipmentId: randomUUID() } },
    { equipment: { ...f.resources.equipment!, resourceRevision: 2 } },
  ])
    await expect(
      engine.saveRecord(
        owner,
        org,
        "appointments",
        f.data,
        undefined,
        randomUUID(),
        { ...f.resources, ...changed },
      ),
    ).rejects.toMatchObject({ status: 409 });
  await expect(
    engine.saveRecord(
      other,
      org,
      "appointments",
      f.data,
      undefined,
      randomUUID(),
      f.resources,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await db.query(
    "delete from lms.memberships where organization_id=$1 and user_id=$2",
    [org, staff.userId],
  );
  await expect(
    engine.saveRecord(
      staff,
      org,
      "appointments",
      f.data,
      undefined,
      randomUUID(),
      f.resources,
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect((await engine.snapshot(owner, org)).appointmentAllocations).toEqual(
    [],
  );
});
it("rolls back partial allocation/history/receipt failures and protects direct writes", async () => {
  const f = await coordinatedFixture(engine, owner, org),
    before = await engine.exportWorkspace(owner, org),
    op = randomUUID();
  await db.exec(
    "create function lms_private.fail_allocation_test() returns trigger language plpgsql as $$begin if new.slot='Equipment' then raise exception 'Injected allocation history failure';end if;return new;end;$$;create trigger fail_test before insert on lms.appointment_allocation_history for each row execute function lms_private.fail_allocation_test()",
  );
  await expect(
    engine.saveRecord(
      owner,
      org,
      "appointments",
      f.data,
      undefined,
      op,
      f.resources,
    ),
  ).rejects.toThrow();
  await db.exec(
    "drop trigger fail_test on lms.appointment_allocation_history;drop function lms_private.fail_allocation_test()",
  );
  expect(await engine.exportWorkspace(owner, org)).toEqual({
    ...before,
    exportedAt: expect.any(String),
  });
  await engine.saveRecord(
    owner,
    org,
    "appointments",
    f.data,
    undefined,
    op,
    f.resources,
  );
  for (const table of [
    "appointment_resource_allocations",
    "appointment_allocation_history",
  ])
    await expect(
      engine.asUser(owner, (tx) =>
        tx.query(`delete from lms.${table} where organization_id=$1`, [org]),
      ),
    ).rejects.toThrow(/permission denied/i);
});
