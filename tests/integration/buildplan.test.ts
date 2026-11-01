import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createDatabase, sqlDatabase } from "../../src/server/database";
import { Engine } from "../../src/core/engine";
import { presets } from "../../src/presets";
import {
  newBuildPlan,
  planForConfig,
  publishPlanConfirmation,
  addCustomField,
} from "../../src/core/buildplan";
import { reviewedGallery, remixGalleryEntry } from "../../src/core/gallery";
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
it("saves immutable scoped draft revisions with exact retries, reopens choices and audits once", async () => {
  const plan = planForConfig(presets.property),
    draft = randomUUID();
  plan.configuration.name = "Fictional plan";
  const first = await engine.saveBuildPlan(owner, a, plan, draft, 0, 1);
  expect(
    (await engine.saveBuildPlan(owner, a, plan, draft, 0, 1)).revision,
  ).toBe(1);
  plan.configuration.name = "Revised plan";
  await expect(
    engine.saveBuildPlan(owner, a, plan, draft, 0, 1),
  ).rejects.toMatchObject({ status: 409 });
  await engine.saveBuildPlan(owner, a, plan, draft, 1, 1);
  const snap = await engine.snapshot(owner, a);
  expect(
    snap.buildPlans.filter((p) => p.id === draft).map((p) => p.revision),
  ).toEqual([2, 1]);
  expect(snap.audit.filter((e) => e.record_id === draft)).toHaveLength(2);
  for (const query of [
    "delete from lms.build_plan_revisions",
    "update lms.build_plan_revisions set revision=1",
  ])
    await expect(
      engine.asUser(owner, (tx) => tx.query(query)),
    ).rejects.toMatchObject({ code: "42501" });
  expect((await engine.snapshot(other, b)).buildPlans).toEqual([]);
  expect((await engine.snapshot(staff, a)).buildPlans).toEqual([]);
  for (const p of [staff, viewer, other])
    await expect(
      engine.saveBuildPlan(p, a, plan, randomUUID(), 0, 1),
    ).rejects.toMatchObject({ status: 403 });
  expect(first.document.configuration.name).toBe("Fictional plan");
});
it("publishes the reviewed saved revision through the shared Engine and retains controlled rollback", async () => {
  const plan = planForConfig(presets.property),
    draft = randomUUID();
  plan.configuration.name = "Studio publication";
  plan.configuration.entities[0].navigationLabel = "Clients";
  await engine.saveRecord(owner, a, "customers", { name: "Retained customer" });
  await engine.saveBuildPlan(owner, a, plan, draft, 0, 1);
  await expect(
    engine.publishBuildPlan(owner, a, {
      id: draft,
      revision: 1,
      configRevision: 1,
      confirmation: "skip",
    }),
  ).rejects.toThrow();
  expect(
    await engine.publishBuildPlan(owner, a, {
      id: draft,
      revision: 1,
      configRevision: 1,
      confirmation: publishPlanConfirmation,
    }),
  ).toBe(2);
  const snap = await engine.snapshot(owner, a);
  expect(snap.config.document.name).toBe("Studio publication");
  expect(snap.records.some((r) => r.data.name === "Retained customer")).toBe(
    true,
  );
  await expect(
    engine.publishBuildPlan(owner, a, {
      id: draft,
      revision: 1,
      configRevision: 1,
      confirmation: publishPlanConfirmation,
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(await engine.publishConfig(owner, a, presets.property, 2, 1)).toBe(3);
});
it("refuses migration-requiring and identity changes, stale reviews, unsupported imports and foreign drafts", async () => {
  const plan = planForConfig(presets.property),
    draft = randomUUID();
  await engine.saveRecord(owner, a, "customers", { name: "Populated" });
  plan.configuration = addCustomField(plan.configuration, "customers", {
    key: "extra_code",
    label: "Extra notes",
    type: "text",
    required: false,
  });
  await engine.saveBuildPlan(owner, a, plan, draft, 0, 1);
  await expect(
    engine.publishBuildPlan(owner, a, {
      id: draft,
      revision: 1,
      configRevision: 1,
      confirmation: publishPlanConfirmation,
    }),
  ).rejects.toThrow(/migration/);
  const custom = newBuildPlan("custom"),
    id = randomUUID();
  await engine.saveBuildPlan(owner, a, custom, id, 0, 1);
  await expect(
    engine.publishBuildPlan(owner, a, {
      id,
      revision: 1,
      configRevision: 1,
      confirmation: publishPlanConfirmation,
    }),
  ).rejects.toThrow(/identity/);
  await expect(
    engine.publishBuildPlan(other, b, {
      id: draft,
      revision: 1,
      configRevision: 1,
      confirmation: publishPlanConfirmation,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    engine.saveBuildPlan(owner, a, { ...plan, version: 3 }, randomUUID(), 0, 1),
  ).rejects.toThrow();
  expect((await engine.snapshot(owner, a)).history).toHaveLength(1);
});
it("limits drafts and retires only whole host-deleted sandboxes while direct stock deletion still refuses", async () => {
  const plan = newBuildPlan("property");
  for (let i = 0; i < 5; i++)
    await engine.saveBuildPlan(owner, a, plan, randomUUID(), 0, 1);
  await expect(
    engine.saveBuildPlan(owner, a, plan, randomUUID(), 0, 1),
  ).rejects.toMatchObject({ status: 409 });
  const { inventory, movement } = await import("../helpers/inventory");
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
    db.query(
      "delete from lms.records where organization_id=$1 and entity='stock-movements'",
      [a],
    ),
  ).rejects.toMatchObject({ code: "23514" });
  await db.query("delete from lms.organizations where id=$1", [a]);
  expect(
    (
      await db.query(
        "select * from lms.build_plan_revisions where organization_id=$1",
        [a],
      )
    ).rows,
  ).toEqual([]);
});

it("stores gallery remixes as ordinary isolated drafts and preserves disabled-module behavior", async () => {
  const before = await engine.snapshot(owner, a),
    entries = reviewedGallery();
  for (const entry of entries)
    await engine.saveBuildPlan(
      owner,
      a,
      remixGalleryEntry(entry),
      randomUUID(),
      0,
      1,
    );
  const saved = await engine.snapshot(owner, a);
  expect(saved.buildPlans).toHaveLength(5);
  expect(saved.history).toEqual(before.history);
  expect(saved.records).toEqual(before.records);
  const basic = remixGalleryEntry(entries[0]);
  await engine.publishConfig(other, b, basic.configuration, 1);
  for (const entity of [
    "appointments",
    "employees",
    "service-rates",
    "stock-movements",
  ])
    await expect(engine.saveRecord(other, b, entity, {})).rejects.toThrow(
      /disabled/,
    );
  expect((await engine.snapshot(staff, a)).buildPlans).toEqual([]);
});
it("keeps saved gallery choices independent of later metadata and protects populated schema publication", async () => {
  const entry = reviewedGallery()[0],
    plan = remixGalleryEntry(entry),
    id = randomUUID();
  plan.configuration.name = "My fictional cleaning";
  await engine.saveRecord(other, b, "customers", {
    name: "Retained gallery customer",
  });
  await engine.saveBuildPlan(other, b, plan, id, 0, 1);
  entry.metadata.revision = 2;
  entry.plan.configuration.name = "Changed upstream template";
  const saved = (await engine.snapshot(other, b)).buildPlans[0];
  expect(saved.document.configuration.name).toBe("My fictional cleaning");
  expect(saved.document).not.toHaveProperty("metadata");
  expect((await engine.snapshot(other, b)).config.revision).toBe(1);
  plan.configuration = addCustomField(plan.configuration, "customers", {
    key: "extra_gallery",
    label: "Extra notes",
    type: "text",
    required: false,
  });
  await engine.saveBuildPlan(other, b, plan, id, 1, 1);
  await expect(
    engine.publishBuildPlan(other, b, {
      id,
      revision: 2,
      configRevision: 1,
      confirmation: publishPlanConfirmation,
    }),
  ).rejects.toThrow(/migration/);
  expect((await engine.snapshot(other, b)).records[0].data.name).toBe(
    "Retained gallery customer",
  );
});
