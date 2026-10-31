import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createDatabase, sqlDatabase } from "../../src/server/database";
import { Engine } from "../../src/core/engine";
import { presets } from "../../src/presets";
import { workflow, appointmentData } from "../helpers/scheduling";
let db: PGlite, engine: Engine, a: string, b: string;
const owner = { userId: randomUUID() },
  other = { userId: randomUUID() },
  viewer = { userId: randomUUID() };
beforeAll(async () => {
  db = await createDatabase();
  engine = new Engine(sqlDatabase(db));
  for (const p of [owner, other, viewer])
    await db.query("insert into lms.users values($1,'Fictional scheduler')", [
      p.userId,
    ]);
});
beforeEach(async () => {
  a = randomUUID();
  b = randomUUID();
  for (const [org, p, industry] of [
    [a, owner, "property"],
    [b, other, "cleaning"],
  ] as const) {
    await db.query(
      "insert into lms.organizations(id,name)values($1,'Fictional schedule')",
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
  await db.query("insert into lms.memberships values($1,$2,'viewer')", [
    a,
    viewer.userId,
  ]);
});
afterAll(async () => {
  await db?.close();
});
it("uses the same appointment records, relationships and audit for both workflows", async () => {
  for (const [org, p, industry] of [
    [a, owner, "property"],
    [b, other, "cleaning"],
  ] as const) {
    const w = await workflow(engine, p, org, industry),
      appointment = await engine.saveRecord(
        p,
        org,
        "appointments",
        appointmentData(w),
        undefined,
        randomUUID(),
      );
    expect(appointment.data.work).toBe(w.work.id);
    const links = await engine.asUser(p, (tx) =>
      tx.query("select * from lms.record_links where source_id=$1", [
        appointment.id,
      ]),
    );
    expect(links.rows.length).toBe(industry === "property" ? 4 : 3);
    expect(
      (await engine.snapshot(p, org)).audit.some(
        (e) => e.record_id === appointment.id,
      ),
    ).toBe(true);
  }
});
it("rejects overlap transactionally, allows adjacent intervals and rechecks archive restoration", async () => {
  const w = await workflow(engine, owner, a, "property"),
    one = await engine.saveRecord(owner, a, "appointments", appointmentData(w));
  await expect(
    engine.saveRecord(
      owner,
      a,
      "appointments",
      appointmentData(w, { title: "Conflict" }),
    ),
  ).rejects.toMatchObject({ status: 409 });
  await engine.saveRecord(
    owner,
    a,
    "appointments",
    appointmentData(w, {
      start: "2026-11-06T19:00:00Z",
      end: "2026-11-06T20:00:00Z",
    }),
  );
  const archived = await engine.archiveRecord(
    owner,
    a,
    one.id,
    one.revision,
    true,
  );
  await engine.saveRecord(
    owner,
    a,
    "appointments",
    appointmentData(w, { title: "Replacement" }),
  );
  await expect(
    engine.archiveRecord(owner, a, one.id, archived.revision, false),
  ).rejects.toMatchObject({ status: 409 });
});
it("rejects cross-workspace customer/resource links and viewer writes independently of form filtering", async () => {
  const x = await workflow(engine, owner, a, "property"),
    y = await workflow(engine, other, b, "cleaning");
  for (const data of [
    appointmentData(x, { customer: y.customer.id }),
    appointmentData(x, { resource: y.resource.id }),
    appointmentData(x, { work: y.work.id }),
  ])
    await expect(
      engine.saveRecord(owner, a, "appointments", data),
    ).rejects.toMatchObject({ status: 409 });
  await expect(
    engine.saveRecord(viewer, a, "appointments", appointmentData(x)),
  ).rejects.toMatchObject({ status: 403 });
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
it("deduplicates confirmed saves/archives without repeating audit or overwriting later edits", async () => {
  const w = await workflow(engine, owner, a, "property"),
    op = randomUUID(),
    data = appointmentData(w),
    first = await engine.saveRecord(
      owner,
      a,
      "appointments",
      data,
      undefined,
      op,
    );
  expect(
    (await engine.saveRecord(owner, a, "appointments", data, undefined, op)).id,
  ).toBe(first.id);
  await expect(
    engine.saveRecord(
      owner,
      a,
      "appointments",
      { ...data, title: "Changed request" },
      undefined,
      op,
    ),
  ).rejects.toMatchObject({ status: 409 });
  const changed = await engine.saveRecord(
    owner,
    a,
    "appointments",
    { ...data, notes: "Updated" },
    first,
    randomUUID(),
  );
  await engine.saveRecord(owner, a, "appointments", data, undefined, op);
  expect(
    (await engine.snapshot(owner, a)).records.find((r) => r.id === first.id)!
      .revision,
  ).toBe(changed.revision);
  const archiveOp = randomUUID(),
    archived = await engine.archiveRecord(
      owner,
      a,
      first.id,
      changed.revision,
      true,
      archiveOp,
    );
  expect(
    (
      await engine.archiveRecord(
        owner,
        a,
        first.id,
        changed.revision,
        true,
        archiveOp,
      )
    ).revision,
  ).toBe(archived.revision);
  expect(
    (await engine.snapshot(owner, a)).audit.filter(
      (e) => e.record_id === first.id,
    ),
  ).toHaveLength(3);
});
it("retains historical links, protects referenced records and does not retime bookings when business zone changes", async () => {
  const w = await workflow(engine, owner, a, "property"),
    first = await engine.saveRecord(
      owner,
      a,
      "appointments",
      appointmentData(w),
    );
  const secondWork = await engine.saveRecord(owner, a, "tasks", {
    ...w.work.data,
    title: "Different work",
  });
  await expect(
    engine.saveRecord(
      owner,
      a,
      "appointments",
      { ...first.data, work: secondWork.id },
      first,
    ),
  ).rejects.toMatchObject({ status: 409 });
  for (const target of [w.customer, w.resource, w.work, w.site!])
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
  await engine.publishConfig(
    owner,
    a,
    { ...presets.property, timeZone: "UTC" },
    1,
  );
  const kept = (await engine.snapshot(owner, a)).records.find(
    (r) => r.id === first.id,
  )!;
  expect(kept.data.start).toBe(first.data.start);
  expect(kept.data.time_zone).toBe("America/Los_Angeles");
  const archived = await engine.archiveRecord(
    owner,
    a,
    first.id,
    first.revision,
    true,
  );
  await engine.archiveRecord(owner, a, w.work.id, w.work.revision, true);
  expect(
    (await engine.snapshot(owner, a)).records.find((r) => r.id === first.id)!
      .data.work,
  ).toBe(w.work.id);
  await expect(
    engine.archiveRecord(owner, a, first.id, archived.revision, false),
  ).rejects.toMatchObject({ status: 409 });
});
