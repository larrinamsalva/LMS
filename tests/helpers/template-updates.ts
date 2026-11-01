import { expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { Engine, Principal } from "../../src/core/engine";
import {
  reviewedTemplateHistory,
  latestTemplate,
  savedTemplateBaseline,
} from "../../src/core/template-history";
import {
  reviewTemplateUpdate,
  useTemplateChanges,
} from "../../src/core/template-update";
import {
  brandBuildPlan,
  publishPlanConfirmation,
} from "../../src/core/buildplan";
import { defaultBranding } from "../../src/core/branding";
import { inventory, movement } from "./inventory";
export async function templateUpdatePersistence(
  engine: Engine,
  owner: Principal,
  a: string,
  others: Principal[],
  other: Principal,
  b: string,
) {
  const history = await reviewedTemplateHistory(),
    base = history.find(
      (h) =>
        h.entry.metadata.id === "property-maintenance" &&
        h.entry.metadata.revision === 1,
    )!,
    target = latestTemplate(history, "property-maintenance")!;
  const stock = await inventory(engine, owner, a);
  await engine.saveRecord(
    owner,
    a,
    "stock-movements",
    movement(stock.product, stock.location),
    undefined,
    randomUUID(),
  );
  await engine.saveRecord(owner, a, "customers", {
    name: "Retained template customer",
  });
  const before = await engine.exportWorkspace(owner, a),
    otherBefore = await engine.snapshot(other, b),
    id = randomUUID();
  await engine.saveBuildPlan(owner, a, base.entry.plan, id, 0, 1);
  const current = brandBuildPlan(base.entry.plan, {
    ...defaultBranding("property"),
    palette: "plum-v1",
    monogram: "MY",
    tagline: "My retained brand.",
  });
  current.configuration.name = "My retained template choices";
  current.configuration.entities.find((e) => e.id === "tasks")!.plural =
    "My requests";
  await engine.saveBuildPlan(owner, a, current, id, 1, 1);
  const stored = await engine.snapshot(owner, a),
    baseline = await savedTemplateBaseline(
      history,
      stored.buildPlans,
      id,
      2,
      current,
    );
  expect(baseline?.sha256).toBe(base.sha256);
  const review = reviewTemplateUpdate(current, target, baseline, 1);
  expect(review.changes.find((r) => r.id === "branding")?.classification).toBe(
    "conflict",
  );
  const next = useTemplateChanges(review, ["module:estimates"], {
    current,
    config: stored.config.document,
    populated: stored.populatedEntities,
    revision: 1,
    allowVersionChange: false,
  });
  expect(await engine.snapshot(owner, a)).toEqual(stored); // review/use helpers have no DB side effects
  expect(next.configuration.name).toBe(current.configuration.name);
  expect(next.configuration.branding).toEqual(current.configuration.branding);
  for (const p of others)
    await expect(
      engine.saveBuildPlan(p, a, next, randomUUID(), 0, 1),
    ).rejects.toMatchObject({ status: 403 });
  await engine.saveBuildPlan(owner, a, next, id, 2, 1);
  await engine.saveBuildPlan(owner, a, next, id, 2, 1);
  await expect(
    engine.saveBuildPlan(owner, a, next, id, 1, 1),
  ).rejects.toMatchObject({ status: 409 });
  const saved = await engine.snapshot(owner, a);
  expect(saved.buildPlans).toHaveLength(3);
  expect(saved.buildPlans.find((r) => r.revision === 1)?.document).toEqual(
    base.entry.plan,
  );
  expect(saved.audit.filter((e) => e.record_id === id)).toHaveLength(3);
  await expect(
    engine.asUser(owner, (tx) =>
      tx.query(
        "update lms.build_plan_revisions set document=$1 where organization_id=$2 and id=$3 and revision=1",
        [next, a, id],
      ),
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    engine.publishBuildPlan(owner, a, {
      id,
      revision: 3,
      configRevision: 1,
      confirmation: "",
    }),
  ).rejects.toThrow();
  await engine.publishBuildPlan(owner, a, {
    id,
    revision: 3,
    configRevision: 1,
    confirmation: publishPlanConfirmation,
  });
  const exported = await engine.exportWorkspace(owner, a);
  for (const key of [
    "records",
    "stockBalances",
    "stockMovements",
    "estimateVersions",
    "staffAssignments",
  ] as const)
    expect(exported[key]).toEqual(before[key]);
  expect(await engine.snapshot(other, b)).toEqual(otherBefore);
  await engine.publishConfig(owner, a, before.config.document, 2, 1);
  expect((await engine.snapshot(owner, a)).config.document).toEqual(
    before.config.document,
  );
  expect((await engine.snapshot(owner, a)).buildPlans).toHaveLength(3);
}
export async function templateUpdateConcurrency(
  engine: Engine,
  owner: Principal,
  a: string,
  other: Principal,
  b: string,
) {
  const history = await reviewedTemplateHistory(),
    base = history.find(
      (h) =>
        h.entry.metadata.id === "property-maintenance" &&
        h.entry.metadata.revision === 1,
    )!,
    target = latestTemplate(history, "property-maintenance")!,
    id = randomUUID();
  await engine.saveBuildPlan(owner, a, base.entry.plan, id, 0, 1);
  const current = structuredClone(base.entry.plan);
  current.configuration.name = "Retained concurrent choices";
  await engine.saveBuildPlan(owner, a, current, id, 1, 1);
  const snap = await engine.snapshot(owner, a),
    review = reviewTemplateUpdate(current, target, base, 1),
    next = useTemplateChanges(review, ["module:estimates"], {
      current,
      config: snap.config.document,
      populated: snap.populatedEntities,
      revision: 1,
      allowVersionChange: false,
    }),
    competing = structuredClone(next);
  competing.configuration.name = "Competing choices";
  const results = await Promise.allSettled([
    engine.saveBuildPlan(owner, a, next, id, 2, 1),
    engine.saveBuildPlan(owner, a, competing, id, 2, 1),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")?.reason.status).toBe(409);
  expect(
    await savedTemplateBaseline(
      history,
      (await engine.snapshot(other, b)).buildPlans,
      id,
      3,
      next,
    ),
  ).toBeUndefined();
  const renamed = structuredClone(snap.config.document);
  renamed.name = "Externally changed during review";
  await engine.publishConfig(owner, a, renamed, 1);
  expect(() =>
    useTemplateChanges(review, ["module:estimates"], {
      current,
      config: renamed,
      populated: snap.populatedEntities,
      revision: 2,
      allowVersionChange: false,
    }),
  ).toThrow(/revision changed/);
  await expect(
    engine.publishBuildPlan(owner, a, {
      id,
      revision: 3,
      configRevision: 1,
      confirmation: publishPlanConfirmation,
    }),
  ).rejects.toMatchObject({ status: 409 });
  const after = await engine.snapshot(owner, a);
  expect(after.buildPlans).toHaveLength(3);
  expect(after.audit.filter((e) => e.record_id === id)).toHaveLength(3);
  expect(after.config.document.name).toBe(renamed.name);
}
