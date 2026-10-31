import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createDatabase, sqlDatabase } from "../../src/server/database";
import { Engine } from "../../src/core/engine";
import { presets } from "../../src/presets";
import { workflow, appointmentData } from "../helpers/scheduling";
import { employee, enroll, period } from "../helpers/workforce";
let db: PGlite, engine: Engine, a: string, b: string;
const owner = { userId: randomUUID() },
  other = { userId: randomUUID() },
  staff = { userId: randomUUID() },
  viewer = { userId: randomUUID() };
beforeAll(async () => {
  db = await createDatabase();
  engine = new Engine(sqlDatabase(db));
  for (const p of [owner, other, staff, viewer])
    await db.query(
      "insert into lms.users values($1,'Fictional workforce principal')",
      [p.userId],
    );
});
beforeEach(async () => {
  a = randomUUID();
  b = randomUUID();
  for (const [org, p, industry] of [
    [a, owner, "property"],
    [b, other, "cleaning"],
  ] as const) {
    await db.query(
      "insert into lms.organizations values($1,'Fictional workforce')",
      [org],
    );
    await db.query("insert into lms.memberships values($1,$2,'owner')", [
      org,
      p.userId,
    ]);
    await db.transaction(async (tx) => {
      await tx.query("select set_config('lms.user_id',$1,true)", [p.userId]);
      await tx.query(
        "insert into lms.config_revisions(organization_id,revision,document,created_by)values($1,1,$2,$3)",
        [org, presets[industry], p.userId],
      );
    });
  }
  for (const [p, role] of [
    [staff, "staff"],
    [viewer, "viewer"],
  ] as const)
    await db.query("insert into lms.memberships values($1,$2,$3)", [
      a,
      p.userId,
      role,
    ]);
});
afterAll(async () => {
  await db?.close();
});
it("reserves an employee through both individual and multi-person crew resources and keeps assignment history", async () => {
  const w = await workflow(engine, owner, a, "property"),
    person = await employee(engine, owner, a);
  const member = await enroll(engine, owner, a, w.resource, person.profile);
  const one = await engine.saveRecord(
    staff,
    a,
    "appointments",
    appointmentData(w),
  );
  const crew = await engine.saveRecord(owner, a, "resources", {
    name: "Second crew",
    kind: "Crew",
  });
  const second = await employee(engine, owner, a, "Morgan Sample");
  await enroll(engine, owner, a, crew, person.profile);
  await enroll(engine, owner, a, crew, second.profile);
  await expect(
    engine.saveRecord(
      staff,
      a,
      "appointments",
      appointmentData({ ...w, resource: crew }),
    ),
  ).rejects.toMatchObject({ status: 409 });
  const archived = await engine.archiveRecord(
    staff,
    a,
    one.id,
    one.revision,
    true,
  );
  const two = await engine.saveRecord(
    staff,
    a,
    "appointments",
    appointmentData({ ...w, resource: crew }),
  );
  let snapshot = await engine.snapshot(owner, a);
  expect(
    snapshot.staffAssignments.filter(
      (s) => s.appointment_id === two.id && s.active,
    ),
  ).toHaveLength(2);
  expect(
    snapshot.staffAssignments.find((s) => s.appointment_id === one.id)?.active,
  ).toBe(false);
  expect(
    snapshot.staffAssignments.find((s) => s.appointment_id === one.id)
      ?.membership_id,
  ).toBe(member.id);
  await expect(
    engine.archiveRecord(staff, a, one.id, archived.revision, false),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    (await engine.exportWorkspace(owner, a)).staffAssignments,
  ).toHaveLength(3);
});
it("rejects missing hours, time off, inactive employees and invalidated roster changes with atomic audit rollback", async () => {
  const w = await workflow(engine, owner, a, "property"),
    person = await employee(engine, owner, a);
  const member = await enroll(engine, owner, a, w.resource, person.profile);
  await expect(
    engine.saveRecord(
      owner,
      a,
      "appointments",
      appointmentData(w, {
        start: "2026-11-06T14:00:00Z",
        end: "2026-11-06T15:00:00Z",
      }),
    ),
  ).rejects.toMatchObject({ status: 409 });
  const one = await engine.saveRecord(
    owner,
    a,
    "appointments",
    appointmentData(w),
  );
  const before = await engine.snapshot(owner, a);
  for (const attempt of [
    () =>
      engine.saveRecord(
        owner,
        a,
        "appointments",
        appointmentData(w, {
          start: "2026-11-06T14:00:00Z",
          end: "2026-11-06T15:00:00Z",
        }),
        one,
        randomUUID(),
      ),
    () =>
      engine.saveRecord(
        owner,
        a,
        "availability",
        period({ employee: person.profile.id, kind: "Vacation" }),
      ),
    () =>
      engine.saveRecord(
        owner,
        a,
        "availability",
        { ...person.hours.data, end: "2026-11-06T17:00:00Z" },
        person.hours,
      ),
    () =>
      engine.saveRecord(
        owner,
        a,
        "employees",
        { ...person.profile.data, status: "Inactive" },
        person.profile,
      ),
    () => engine.archiveRecord(owner, a, member.id, member.revision, true),
  ])
    await expect(attempt()).rejects.toMatchObject({ status: 409 });
  expect((await engine.snapshot(owner, a)).audit.length).toBe(
    before.audit.length,
  );
  const removed = await engine.archiveRecord(
    owner,
    a,
    one.id,
    one.revision,
    true,
  );
  await engine.saveRecord(
    owner,
    a,
    "availability",
    period({ employee: person.profile.id, kind: "Vacation" }),
  );
  await expect(
    engine.archiveRecord(owner, a, one.id, removed.revision, false),
  ).rejects.toMatchObject({ status: 409 });
});
it("keeps manager-only writes, cross-organization references and direct SQL projections protected", async () => {
  const w = await workflow(engine, owner, a, "property"),
    person = await employee(engine, other, b);
  await expect(
    enroll(engine, owner, a, w.resource, person.profile),
  ).rejects.toMatchObject({ status: 409 });
  for (const p of [staff, viewer]) {
    await expect(employee(engine, p, a)).rejects.toMatchObject({ status: 403 });
    await expect(
      engine.asUser(p, (tx) =>
        tx.query(
          "insert into lms.records(organization_id,entity,data,config_revision,created_by,updated_by)values($1,'employees',$2,1,$3,$3)",
          [a, { name: "Fake", role: "Owner", status: "Active" }, p.userId],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  }
  await expect(
    engine.asUser(owner, (tx) => tx.query("delete from lms.appointment_staff")),
  ).rejects.toMatchObject({ code: "42501" });
  expect(
    (
      await engine.asUser(other, (tx) =>
        tx.query(
          "select * from lms.resource_memberships where organization_id=$1",
          [a],
        ),
      )
    ).rows,
  ).toEqual([]);
});
it("preserves permanent enrollment, worker identity, dates, exact retries and existing resource-only compatibility", async () => {
  const w = await workflow(engine, owner, a, "property"),
    person = await employee(engine, owner, a);
  const legacy = await engine.saveRecord(
    owner,
    a,
    "appointments",
    appointmentData(w),
  );
  await expect(
    enroll(engine, owner, a, w.resource, person.profile),
  ).rejects.toMatchObject({ status: 409 });
  await engine.archiveRecord(owner, a, legacy.id, legacy.revision, true);
  const member = await enroll(engine, owner, a, w.resource, person.profile);
  const another = await employee(engine, owner, a, "Another worker");
  await expect(
    enroll(engine, owner, a, w.resource, another.profile),
  ).rejects.toMatchObject({ status: 409 });
  await engine.archiveRecord(owner, a, member.id, member.revision, true);
  await expect(
    engine.saveRecord(owner, a, "appointments", appointmentData(w)),
  ).rejects.toMatchObject({ status: 409 });
  const op = randomUUID(),
    data = period({
      employee: person.profile.id,
      kind: "Day off",
      start: "2026-11-08T08:00:00Z",
      end: "2026-11-09T08:00:00Z",
    });
  const first = await engine.saveRecord(
    owner,
    a,
    "availability",
    data,
    undefined,
    op,
  );
  expect(
    (await engine.saveRecord(owner, a, "availability", data, undefined, op)).id,
  ).toBe(first.id);
  await expect(
    engine.saveRecord(
      owner,
      a,
      "availability",
      { ...data, kind: "Vacation" },
      undefined,
      op,
    ),
  ).rejects.toMatchObject({ status: 409 });
});
it("checks crew/resource hours as well as every employee and refuses membership transitions inside an appointment", async () => {
  const w = await workflow(engine, other, b, "cleaning"),
    person = await employee(engine, other, b);
  await enroll(engine, other, b, w.resource, person.profile, {
    end: "2026-11-06T18:30:00Z",
  });
  await expect(
    engine.saveRecord(other, b, "appointments", appointmentData(w)),
  ).rejects.toMatchObject({ status: 409 });
  const membership = (await engine.snapshot(other, b)).records.find(
    (r) => r.entity === "resource-memberships",
  )!;
  await engine.saveRecord(
    other,
    b,
    "resource-memberships",
    { ...membership.data, end: "2027-01-01T08:00:00Z" },
    membership,
  );
  await engine.saveRecord(
    other,
    b,
    "availability",
    period({
      resource: w.resource.id,
      start: "2026-11-06T20:00:00Z",
      end: "2026-11-06T21:00:00Z",
    }),
  );
  await expect(
    engine.saveRecord(other, b, "appointments", appointmentData(w)),
  ).rejects.toMatchObject({ status: 409 });
  await engine.saveRecord(
    other,
    b,
    "appointments",
    appointmentData(w, {
      start: "2026-11-06T20:00:00Z",
      end: "2026-11-06T21:00:00Z",
    }),
  );
});
