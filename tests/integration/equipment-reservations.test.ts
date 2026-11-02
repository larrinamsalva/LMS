import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createDatabase, sqlDatabase } from "../../src/server/database";
import { Engine } from "../../src/core/engine";
import { presets } from "../../src/presets";
import {
  reservationFixture,
  mappingRequest,
} from "../helpers/equipment-reservations";
import { equipmentAction, checkoutEquipment } from "../helpers/equipment";
import { selectModules } from "../../src/core/buildplan";
let db: PGlite, engine: Engine, org: string;
const owner = { userId: randomUUID() },
  staff = { userId: randomUUID() },
  other = { userId: randomUUID() };
beforeAll(async () => {
  db = await createDatabase();
  engine = new Engine(sqlDatabase(db));
  for (const p of [owner, staff, other])
    await db.query(
      "insert into lms.users values($1,'Fictional reservation operator')",
      [p.userId],
    );
});
beforeEach(async () => {
  org = randomUUID();
  await db.query(
    "insert into lms.organizations values($1,'Fictional reservations')",
    [org],
  );
  await db.query(
    "insert into lms.memberships values($1,$2,'owner'),($1,$3,'staff')",
    [org, owner.userId, staff.userId],
  );
  await db.transaction(async (tx) => {
    await tx.query("select set_config('lms.user_id',$1,true)", [owner.userId]);
    await tx.query(
      "insert into lms.config_revisions(organization_id,revision,document,created_by)values($1,1,$2,$3)",
      [org, presets.property, owner.userId],
    );
  });
});
afterAll(async () => {
  await db?.close();
});
it("explicitly maps, reserves, rejects overlaps and retains cancellation, restore and exact receipts", async () => {
  const f = await reservationFixture(engine, owner, org);
  const op = randomUUID();
  const appointment = await engine.saveRecord(
    staff,
    org,
    "appointments",
    f.data,
    undefined,
    op,
  );
  expect(
    await engine.saveRecord(staff, org, "appointments", f.data, undefined, op),
  ).toEqual(appointment);
  for (const changes of [
    {},
    { start: "2026-11-06T18:30:00Z", end: "2026-11-06T19:30:00Z" },
    { start: "2026-11-06T17:00:00Z", end: "2026-11-06T20:00:00Z" },
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
  await engine.saveRecord(
    staff,
    org,
    "appointments",
    {
      ...f.data,
      title: "Back to back",
      start: "2026-11-06T19:00:00Z",
      end: "2026-11-06T20:00:00Z",
    },
    undefined,
    randomUUID(),
  );
  const cancelled = await engine.saveRecord(
    staff,
    org,
    "appointments",
    { ...appointment.data, status: "Cancelled" },
    appointment,
    randomUUID(),
  );
  const otherBooking = await engine.saveRecord(
    owner,
    org,
    "appointments",
    f.data,
    undefined,
    randomUUID(),
  );
  await expect(
    engine.saveRecord(
      staff,
      org,
      "appointments",
      appointment.data,
      cancelled,
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
  await engine.archiveRecord(
    owner,
    org,
    otherBooking.id,
    otherBooking.revision,
    true,
    randomUUID(),
  );
  const restored = await engine.saveRecord(
    staff,
    org,
    "appointments",
    appointment.data,
    cancelled,
    randomUUID(),
  );
  expect(restored.revision).toBe(3);
  const s = await engine.snapshot(owner, org);
  expect(
    s.equipmentReservations.filter((r) => r.appointment_id === appointment.id),
  ).toHaveLength(3);
  expect(s.equipmentMappingHistory).toHaveLength(1);
});
it("records safety problems with future bookings unchanged, refuses unsafe restores and never equates checkout with reservations", async () => {
  const f = await reservationFixture(engine, owner, org);
  const booking = await engine.saveRecord(
    owner,
    org,
    "appointments",
    f.data,
    undefined,
    randomUUID(),
  );
  await engine.writeEquipment(
    staff,
    org,
    equipmentAction(f.equipment, "report-problem"),
    randomUUID(),
  );
  const s = await engine.snapshot(owner, org);
  expect(s.records.find((r) => r.id === booking.id)).toEqual(booking);
  expect(s.equipmentStates[0].condition).toBe("Needs inspection");
  await expect(
    engine.saveRecord(
      staff,
      org,
      "appointments",
      { ...f.data, start: "2026-11-06T20:00:00Z", end: "2026-11-06T21:00:00Z" },
      undefined,
      randomUUID(),
    ),
  ).rejects.toThrow(/unsafe/i);
  await engine.archiveRecord(
    owner,
    org,
    booking.id,
    booking.revision,
    true,
    randomUUID(),
  );
  await expect(
    engine.archiveRecord(
      owner,
      org,
      booking.id,
      booking.revision + 1,
      false,
      randomUUID(),
    ),
  ).rejects.toThrow(/unsafe/i);
  expect(s.equipmentCheckouts).toHaveLength(0);
});
it("refuses current custody, unreviewed mappings, stale revisions, unauthorized and foreign operations", async () => {
  const f = await reservationFixture(engine, owner, org);
  await expect(
    engine.mapEquipment(staff, org, f.request, randomUUID()),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    engine.mapEquipment(other, org, f.request, randomUUID()),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    engine.mapEquipment(owner, org, f.request, randomUUID()),
  ).rejects.toThrow(/changed/i);
  await engine.writeEquipment(
    staff,
    org,
    checkoutEquipment(f.equipment, f.employee),
    randomUUID(),
  );
  await expect(
    engine.saveRecord(
      staff,
      org,
      "appointments",
      f.data,
      undefined,
      randomUUID(),
    ),
  ).rejects.toThrow(/checked out/i);
  const resource = await engine.saveRecord(owner, org, "resources", {
    name: "Same name no adoption",
    kind: "Equipment",
  });
  await expect(
    engine.saveRecord(
      owner,
      org,
      "appointments",
      { ...f.data, resource: resource.id },
      undefined,
      randomUUID(),
    ),
  ).rejects.toThrow(/unmapped/i);
  await expect(
    engine.mapEquipment(
      owner,
      org,
      mappingRequest(f.equipment, resource, 2, 1),
      randomUUID(),
    ),
  ).rejects.toThrow();
});
it("preserves enrollment and histories when disabled, rejects direct state/history writes and prevents remapping around bookings", async () => {
  const f = await reservationFixture(engine, owner, org),
    op = randomUUID(),
    req = { ...f.request, kind: "unmap" as const, mappingRevision: 1 };
  const unmap = await engine.mapEquipment(owner, org, req, op);
  expect(await engine.mapEquipment(owner, org, req, op)).toEqual(unmap);
  await expect(
    engine.mapEquipment(
      owner,
      org,
      { ...req, notes: "A conflicting retry" },
      op,
    ),
  ).rejects.toThrow(/different/i);
  await expect(
    engine.saveRecord(
      owner,
      org,
      "appointments",
      f.data,
      undefined,
      randomUUID(),
    ),
  ).rejects.toThrow(/unmapped/i);
  await engine.mapEquipment(
    owner,
    org,
    { ...f.request, mappingRevision: 2 },
    randomUUID(),
  );
  const booking = await engine.saveRecord(
    owner,
    org,
    "appointments",
    f.data,
    undefined,
    randomUUID(),
  );
  await expect(
    engine.mapEquipment(
      owner,
      org,
      { ...req, mappingRevision: 3 },
      randomUUID(),
    ),
  ).rejects.toThrow(/blocking/i);
  const config = (await engine.snapshot(owner, org)).config;
  await engine.publishConfig(
    owner,
    org,
    selectModules(
      config.document,
      config.document.modules
        .map((m) => m.id)
        .filter((id) => id !== "equipment-reservations"),
    ),
    config.revision,
  );
  await expect(
    engine.saveRecord(
      owner,
      org,
      "appointments",
      { ...f.data, title: "Disabled booking" },
      undefined,
      randomUUID(),
    ),
  ).rejects.toThrow(/disabled/i);
  await engine.archiveRecord(
    owner,
    org,
    booking.id,
    booking.revision,
    true,
    randomUUID(),
  );
  await db.transaction(async (tx) => {
    await tx.exec("set local role lms_app");
    await tx.query("select set_config('lms.user_id',$1,true)", [owner.userId]);
    await expect(
      tx.query(
        "delete from lms.equipment_mapping_history where organization_id=$1",
        [org],
      ),
    ).rejects.toThrow();
  });
  expect(
    (await engine.snapshot(owner, org)).equipmentMappingHistory,
  ).toHaveLength(3);
});

it("refuses due inspections, preserves disabled enrollment on restoration and distinguishes display-zone changes from saved instants", async () => {
  const f = await reservationFixture(engine, owner, org);
  await expect(
    engine.saveRecord(
      owner,
      org,
      "appointments",
      {
        ...f.data,
        start: "2026-12-06T18:00:00Z",
        end: "2026-12-06T19:00:00Z",
        scheduled_date: "2026-12-06",
      },
      undefined,
      randomUUID(),
    ),
  ).rejects.toThrow(/inspection.*due/i);
  const booking = await engine.saveRecord(
      owner,
      org,
      "appointments",
      f.data,
      undefined,
      randomUUID(),
    ),
    cfg = (await engine.snapshot(owner, org)).config;
  await engine.publishConfig(
    owner,
    org,
    { ...cfg.document, timeZone: "America/New_York" },
    cfg.revision,
  );
  const next = await engine.snapshot(owner, org);
  expect(next.records.find((r) => r.id === booking.id)!.data.start).toBe(
    f.data.start,
  );
  await expect(
    engine.mapEquipment(
      owner,
      org,
      { ...f.request, kind: "unmap", mappingRevision: 1 },
      randomUUID(),
    ),
  ).rejects.toThrow(/configuration/i);
});
