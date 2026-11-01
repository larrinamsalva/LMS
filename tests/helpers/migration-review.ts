import { expect } from "vitest";
import { randomUUID } from "node:crypto";
import { type Engine, type Principal } from "../../src/core/engine";
import {
  addCustomField,
  planForConfig,
  selectModules,
  newBuildPlan,
} from "../../src/core/buildplan";
import { migrationReport } from "../../src/core/migration-review";
import { inventory, movement } from "./inventory";
const add = (plan: ReturnType<typeof planForConfig>, entity = "customers") => ({
  ...plan,
  configuration: addCustomField(plan.configuration, entity, {
    key: "extra_planning",
    label: "Fictional planning notes",
    required: false,
    type: "text",
  }),
});
export async function impactRetention(engine: Engine, p: Principal, a: string) {
  const initial = await engine.snapshot(p, a),
    plan = add(planForConfig(initial.config.document));
  expect(
    (await engine.reviewBuildPlanImpact(p, a, { document: plan })).overall,
  ).toBe("compatible");
  expect(await engine.snapshot(p, a)).toEqual(initial);
  await engine.publishConfig(p, a, plan.configuration, 1);
  const live = await engine.saveRecord(p, a, "customers", {
    name: "PRIVATE CUSTOMER NEVER IN REPORT",
    extra_planning: "PRIVATE NOTES",
  });
  const archived = await engine.saveRecord(p, a, "customers", {
    name: "PRIVATE ARCHIVED CUSTOMER",
  });
  await engine.archiveRecord(p, a, archived.id, archived.revision, true);
  const unit = await engine.saveRecord(p, a, "units", {
    label: "PRIVATE SITE",
    kind: "RV site",
    condition: "Ready",
  });
  const oldUnit = await engine.saveRecord(p, a, "units", {
    label: "PRIVATE OLD SITE",
    kind: "Cabin",
    condition: "Ready",
  });
  await engine.archiveRecord(p, a, oldUnit.id, oldUnit.revision, true);
  await engine.saveRecord(p, a, "tasks", {
    title: "PRIVATE LINKED WORK",
    status: "Open",
    customer: live.id,
    site: unit.id,
  });
  const stock = await inventory(engine, p, a);
  await engine.saveRecord(
    p,
    a,
    "stock-movements",
    movement(stock.product, stock.location),
    undefined,
    randomUUID(),
  );
  const before = await engine.exportWorkspace(p, a),
    changed = structuredClone(plan);
  changed.configuration.entities
    .find((e) => e.id === "customers")!
    .fields.find((f) => f.key === "extra_planning")!.type = "longtext";
  const review = await engine.reviewBuildPlanImpact(p, a, {
    document: changed,
  });
  expect(review.overall).toBe("migration-review");
  expect(review.entities.find((e) => e.entity === "customers")).toMatchObject({
    active: 1,
    archived: 1,
    enabled: true,
  });
  expect(JSON.stringify(review)).not.toContain("PRIVATE");
  const output = JSON.stringify(migrationReport(review));
  for (const value of [
    live.id,
    archived.id,
    unit.id,
    p.userId,
    a,
    "PRIVATE",
    "stateDigest",
    '"active":',
    "stockBalances",
  ])
    expect(output).not.toContain(value);
  await expect(
    engine.publishConfig(p, a, changed.configuration, 2),
  ).rejects.toThrow(/migration/);
  const hidden = {
    ...plan,
    configuration: selectModules(
      plan.configuration,
      plan.configuration.modules
        .filter((m) => !["inventory", "property"].includes(m.id))
        .map((m) => m.id),
    ),
  };
  const disabling = await engine.reviewBuildPlanImpact(p, a, {
    document: hidden,
  });
  expect(disabling.overall).toBe("compatible");
  expect(
    disabling.changes.find((c) => c.change === "Module: inventory")?.reason,
  ).toMatch(/history are retained/);
  await engine.publishConfig(p, a, hidden.configuration, 2);
  const disabled = await engine.reviewBuildPlanImpact(p, a, {
    document: add(hidden, "units"),
  });
  expect(disabled.overall).toBe("migration-review");
  expect(disabled.entities.find((e) => e.entity === "units")).toMatchObject({
    active: 1,
    archived: 1,
    enabled: false,
    proposedEnabled: false,
  });
  expect(disabled.entities.find((e) => e.entity === "items")).toMatchObject({
    active: 1,
    enabled: false,
  });
  await expect(
    engine.publishConfig(p, a, disabled.proposed.configuration, 3),
  ).rejects.toThrow(/migration/);
  const after = await engine.exportWorkspace(p, a);
  for (const key of [
    "records",
    "stockBalances",
    "stockMovements",
    "staffAssignments",
    "estimateVersions",
  ] as const)
    expect(after[key]).toEqual(before[key]);
  await engine.publishConfig(p, a, plan.configuration, 3, 2);
  expect((await engine.exportWorkspace(p, a)).records).toEqual(before.records);
}
export async function impactFreshness(
  engine: Engine,
  p: Principal,
  a: string,
  other: Principal,
  b: string,
) {
  let plan = planForConfig((await engine.snapshot(p, a)).config.document);
  const draft = randomUUID();
  await engine.saveBuildPlan(p, a, plan, draft, 0, 1);
  const request = () => ({ document: plan, draft: { id: draft, revision: 1 } });
  let review = await engine.reviewBuildPlanImpact(p, a, request());
  await expect(engine.saveRecord(p, a, "customers", {})).rejects.toThrow();
  expect(
    (
      await engine.reviewBuildPlanImpact(p, a, {
        ...request(),
        expected: review.state,
      })
    ).state,
  ).toEqual(review.state);
  await engine.saveRecord(other, b, "customers", {
    name: "Other organization does not invalidate",
  });
  expect(
    (
      await engine.reviewBuildPlanImpact(p, a, {
        ...request(),
        expected: review.state,
      })
    ).state,
  ).toEqual(review.state);
  let record = await engine.saveRecord(p, a, "customers", {
    name: "PRIVATE FRESHNESS RECORD",
  });
  await expect(
    engine.reviewBuildPlanImpact(p, a, {
      ...request(),
      expected: review.state,
    }),
  ).rejects.toMatchObject({ status: 409 });
  review = await engine.reviewBuildPlanImpact(p, a, request());
  record = await engine.saveRecord(
    p,
    a,
    "customers",
    { name: "PRIVATE CHANGED RECORD" },
    { id: record.id, revision: record.revision },
  );
  await expect(
    engine.reviewBuildPlanImpact(p, a, {
      ...request(),
      expected: review.state,
    }),
  ).rejects.toMatchObject({ status: 409 });
  review = await engine.reviewBuildPlanImpact(p, a, request());
  record = await engine.archiveRecord(p, a, record.id, record.revision, true);
  await expect(
    engine.reviewBuildPlanImpact(p, a, {
      ...request(),
      expected: review.state,
    }),
  ).rejects.toMatchObject({ status: 409 });
  review = await engine.reviewBuildPlanImpact(p, a, request());
  await engine.archiveRecord(p, a, record.id, record.revision, false);
  await expect(
    engine.reviewBuildPlanImpact(p, a, {
      ...request(),
      expected: review.state,
    }),
  ).rejects.toMatchObject({ status: 409 });
  review = await engine.reviewBuildPlanImpact(p, a, request());
  const changed = structuredClone(plan);
  changed.configuration.name = "Fictional concurrent configuration";
  await engine.publishConfig(p, a, changed.configuration, 1);
  await expect(
    engine.reviewBuildPlanImpact(p, a, {
      ...request(),
      expected: review.state,
    }),
  ).rejects.toMatchObject({ status: 409 });
  review = await engine.reviewBuildPlanImpact(p, a, request());
  await expect(
    engine.reviewBuildPlanImpact(p, a, {
      document: changed,
      expected: review.state,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await engine.saveBuildPlan(p, a, changed, draft, 1, 2);
  await expect(
    engine.reviewBuildPlanImpact(p, a, {
      ...request(),
      expected: review.state,
    }),
  ).rejects.toMatchObject({ status: 409 });
  const latest = await engine.reviewBuildPlanImpact(p, a, {
    document: changed,
    draft: { id: draft, revision: 2 },
  });
  expect(latest.configurationRevision).toBe(2);
}
export async function impactAuthorization(
  engine: Engine,
  p: Principal,
  admin: Principal,
  a: string,
  denied: Principal[],
  other: Principal,
  b: string,
) {
  const plan = planForConfig((await engine.snapshot(p, a)).config.document);
  const before = await engine.snapshot(p, a);
  for (const actor of denied)
    await expect(
      engine.reviewBuildPlanImpact(actor, a, { document: plan }),
    ).rejects.toMatchObject({ status: 403 });
  expect(
    (await engine.reviewBuildPlanImpact(admin, a, { document: plan })).overall,
  ).toBe("compatible");
  await expect(
    engine.reviewBuildPlanImpact(p, b, { document: plan }),
  ).rejects.toMatchObject({ status: 403 });
  const own = await engine.reviewBuildPlanImpact(p, a, { document: plan });
  await expect(
    engine.reviewBuildPlanImpact(admin, a, {
      document: plan,
      expected: own.state,
    }),
  ).rejects.toMatchObject({ status: 409 });
  for (const document of [
    { ...plan, version: 3 },
    { ...plan, version: 2 },
    { ...plan, credentials: "never accepted" },
    migrationReport(own),
  ])
    await expect(
      engine.reviewBuildPlanImpact(p, a, { document }),
    ).rejects.toThrow();
  const otherDraft = randomUUID();
  await engine.saveRecord(other, b, "customers", {
    name: "PRIVATE FOREIGN CUSTOMER",
  });
  await engine.saveBuildPlan(
    other,
    b,
    newBuildPlan("cleaning"),
    otherDraft,
    0,
    1,
  );
  await expect(
    engine.reviewBuildPlanImpact(p, a, {
      document: plan,
      draft: { id: otherDraft, revision: 1 },
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    (
      await engine.asUser(p, (tx) =>
        tx.query("select id from lms.records where organization_id=$1", [b]),
      )
    ).rows,
  ).toEqual([]);
  expect(await engine.snapshot(p, a)).toEqual(before);
}
export async function impactConcurrency(
  engine: Engine,
  p: Principal,
  a: string,
) {
  const plan = add(
    planForConfig((await engine.snapshot(p, a)).config.document),
  );
  const [review] = await Promise.all([
    engine.reviewBuildPlanImpact(p, a, { document: plan }),
    engine.saveRecord(p, a, "customers", {
      name: "PRIVATE CONCURRENT CUSTOMER",
    }),
  ]);
  const count = review.entities.find((e) => e.entity === "customers")!.active;
  expect([0, 1]).toContain(count);
  expect(review.overall).toBe(count ? "migration-review" : "compatible");
  if (count === 0)
    await expect(
      engine.reviewBuildPlanImpact(p, a, {
        document: plan,
        expected: review.state,
      }),
    ).rejects.toMatchObject({ status: 409 });
  else
    expect(
      (
        await engine.reviewBuildPlanImpact(p, a, {
          document: plan,
          expected: review.state,
        })
      ).overall,
    ).toBe("migration-review");
  await expect(
    engine.publishConfig(p, a, plan.configuration, 1),
  ).rejects.toThrow(/migration/);
  const snapshot = await engine.snapshot(p, a);
  expect(snapshot.config.revision).toBe(1);
  expect(snapshot.records).toHaveLength(1);
}
