import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createDatabase, sqlDatabase } from "../../src/server/database";
import { Engine } from "../../src/core/engine";
import { presets } from "../../src/presets";
import { catalog, selection, savedPricing } from "../helpers/pricing";
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
      "insert into lms.users values($1,'Fictional pricing principal')",
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
      "insert into lms.organizations values($1,'Fictional pricing')",
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
async function draft(org = a, p = owner) {
  const c = await catalog(engine, p, org),
    customer = await engine.saveRecord(p, org, "customers", {
      name: "Example customer",
    });
  const pricing = selection(c.rate, c.service, "0.5");
  return {
    ...c,
    customer,
    data: {
      title: "Fictional estimate",
      customer: customer.id,
      zone: c.zone.id,
      as_of: "2026-11-06",
      status: "Draft",
      pricing,
      notes: "",
    },
  };
}
it("materializes exact catalog snapshots and preserves them through catalog edits, quantity changes, archive and restore", async () => {
  const c = await draft(),
    first = await engine.saveRecord(
      owner,
      a,
      "estimates",
      c.data,
      undefined,
      randomUUID(),
    );
  expect(savedPricing(first)).toMatchObject({
    subtotalMinor: "501",
    totalMinor: "501",
    customerName: "Example customer",
  });
  await engine.saveRecord(
    owner,
    a,
    "service-rates",
    { ...c.rate.data, amount: "2000" },
    c.rate,
  );
  await engine.saveRecord(
    owner,
    a,
    "services",
    { ...c.service.data, description: "Changed later" },
    c.service,
  );
  const data = {
    ...first.data,
    pricing: {
      ...savedPricing(first),
      lines: savedPricing(first).lines.map((l) => ({ ...l, quantity: "2" })),
    },
  };
  const second = await engine.saveRecord(owner, a, "estimates", data, first);
  expect(savedPricing(second).totalMinor).toBe("2002");
  expect(savedPricing(second).lines[0].snapshot.description).toBe(
    "Original service description",
  );
  const snap = await engine.snapshot(owner, a);
  expect(
    snap.estimateVersions.filter((v) => v.record_id === first.id),
  ).toHaveLength(2);
  const archived = await engine.archiveRecord(
    owner,
    a,
    second.id,
    second.revision,
    true,
  );
  await engine.archiveRecord(owner, a, second.id, archived.revision, false);
});
it("rejects stale catalog selections, wrong areas, date ranges, duplicate rates and extras without a base", async () => {
  const c = await draft();
  const changed = await engine.saveRecord(
    owner,
    a,
    "service-rates",
    { ...c.rate.data, amount: "3000" },
    c.rate,
  );
  await expect(
    engine.saveRecord(owner, a, "estimates", c.data),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    engine.saveRecord(owner, a, "service-rates", {
      ...changed.data,
      title: "Overlap",
    }),
  ).rejects.toMatchObject({ status: 409 });
  const p = selection(changed, c.service);
  const zone = await engine.saveRecord(owner, a, "pricing-zones", {
    name: "Other area",
  });
  await expect(
    engine.saveRecord(owner, a, "estimates", {
      ...c.data,
      zone: zone.id,
      pricing: p,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    engine.saveRecord(owner, a, "estimates", {
      ...c.data,
      as_of: "2027-01-01",
      pricing: p,
    }),
  ).rejects.toMatchObject({ status: 409 });
});
it("deduplicates original selections after prices change and refuses altered retries and stale edits", async () => {
  const c = await draft(),
    op = randomUUID(),
    first = await engine.saveRecord(
      owner,
      a,
      "estimates",
      c.data,
      undefined,
      op,
    );
  await engine.saveRecord(
    owner,
    a,
    "service-rates",
    { ...c.rate.data, amount: "9000" },
    c.rate,
  );
  expect(
    (await engine.saveRecord(owner, a, "estimates", c.data, undefined, op)).id,
  ).toBe(first.id);
  await expect(
    engine.saveRecord(
      owner,
      a,
      "estimates",
      { ...c.data, title: "Changed" },
      undefined,
      op,
    ),
  ).rejects.toMatchObject({ status: 409 });
  const next = await engine.saveRecord(
    owner,
    a,
    "estimates",
    { ...first.data, notes: "Edited" },
    first,
    randomUUID(),
  );
  await expect(
    engine.saveRecord(owner, a, "estimates", first.data, first, randomUUID()),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    (await engine.snapshot(owner, a)).estimateVersions.filter(
      (v) => v.record_id === next.id,
    ),
  ).toHaveLength(2);
});
it("keeps owner/admin authorization, scoped references and derived snapshot/history protection in the database", async () => {
  const c = await draft(),
    foreign = await catalog(engine, other, b);
  for (const p of [staff, viewer])
    await expect(
      engine.saveRecord(p, a, "estimates", c.data),
    ).rejects.toMatchObject({ status: 403 });
  await expect(
    engine.saveRecord(owner, a, "estimates", {
      ...c.data,
      pricing: selection(foreign.rate, foreign.service),
    }),
  ).rejects.toMatchObject({ status: 409 });
  const first = await engine.saveRecord(owner, a, "estimates", c.data);
  await expect(
    engine.asUser(owner, (tx) =>
      tx.query(
        "update lms.records set data=jsonb_set(data,'{pricing,totalMinor}','\"1\"') where organization_id=$1 and id=$2",
        [a, first.id],
      ),
    ),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    engine.asUser(owner, (tx) => tx.query("delete from lms.estimate_versions")),
  ).rejects.toMatchObject({ code: "42501" });
  expect(
    (
      await engine.asUser(other, (tx) =>
        tx.query(
          "select * from lms.estimate_versions where organization_id=$1",
          [a],
        ),
      )
    ).rows,
  ).toEqual([]);
});
it("controls review/reopen/void statuses and retains linked customer work and version snapshots", async () => {
  const c = await draft(),
    work = await engine.saveRecord(owner, a, "tasks", {
      title: "Fictional job",
      status: "Open",
      customer: c.customer.id,
    });
  const first = await engine.saveRecord(owner, a, "estimates", {
    ...c.data,
    work: work.id,
  });
  await expect(
    engine.saveRecord(owner, a, "tasks", { ...work.data, customer: "" }, work),
  ).rejects.toMatchObject({ status: 409 });
  const reviewed = await engine.saveRecord(
    owner,
    a,
    "estimates",
    { ...first.data, status: "Reviewed draft" },
    first,
  );
  await expect(
    engine.saveRecord(
      owner,
      a,
      "estimates",
      { ...reviewed.data, notes: "Changed" },
      reviewed,
    ),
  ).rejects.toMatchObject({ status: 409 });
  const reopened = await engine.saveRecord(
    owner,
    a,
    "estimates",
    { ...reviewed.data, status: "Draft" },
    reviewed,
  );
  const voided = await engine.saveRecord(
    owner,
    a,
    "estimates",
    { ...reopened.data, status: "Void" },
    reopened,
  );
  await expect(
    engine.saveRecord(
      owner,
      a,
      "estimates",
      { ...voided.data, status: "Draft" },
      voided,
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    (await engine.snapshot(owner, a)).estimateVersions
      .filter((v) => v.record_id === first.id)
      .map((v) => v.data.status),
  ).toEqual(["Draft", "Reviewed draft", "Draft", "Void"]);
});
