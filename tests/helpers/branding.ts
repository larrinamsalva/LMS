import { expect } from "vitest";
import { randomUUID } from "node:crypto";
import { type Engine, type Principal } from "../../src/core/engine";
import {
  planForConfig,
  brandBuildPlan,
  publishPlanConfirmation,
} from "../../src/core/buildplan";
import { defaultBranding } from "../../src/core/branding";
import {
  createBlueprintPackage,
  importBlueprintPackage,
} from "../../src/core/blueprint";
import { presets } from "../../src/presets";
import { inventory, movement } from "./inventory";
export async function brandingDrafts(
  engine: Engine,
  owner: Principal,
  others: Principal[],
  a: string,
  other: Principal,
  b: string,
) {
  const plan = brandBuildPlan(planForConfig(presets.property), {
      ...defaultBranding("property"),
      monogram: "CG",
      tagline: "Fictional property care.",
    }),
    id = randomUUID();
  await engine.saveBuildPlan(owner, a, plan, id, 0, 1);
  const next = brandBuildPlan(plan, {
      ...plan.configuration.branding!,
      palette: "plum-v1",
    }),
    competing = brandBuildPlan(plan, {
      ...plan.configuration.branding!,
      palette: "ocean-v1",
    });
  const results = await Promise.allSettled([
    engine.saveBuildPlan(owner, a, next, id, 1, 1),
    engine.saveBuildPlan(owner, a, competing, id, 1, 1),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")?.reason.status).toBe(409);
  const accepted = results[0].status === "fulfilled" ? next : competing;
  await engine.saveBuildPlan(owner, a, accepted, id, 1, 1);
  const after = await engine.snapshot(owner, a);
  expect(after.buildPlans).toHaveLength(2);
  expect(after.buildPlans.find((r) => r.revision === 1)?.document).toEqual(
    plan,
  );
  expect(after.buildPlans.find((r) => r.revision === 2)?.document).toEqual(
    accepted,
  );
  expect(after.audit.filter((e) => e.record_id === id)).toHaveLength(2);
  expect(after.config.document).toEqual(presets.property);
  for (const principal of others) {
    await expect(
      engine.saveBuildPlan(principal, a, plan, randomUUID(), 0, 1),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      engine.publishBuildPlan(principal, a, {
        id,
        revision: 2,
        configRevision: 1,
        confirmation: publishPlanConfirmation,
      }),
    ).rejects.toMatchObject({ status: 403 });
  }
  expect((await engine.snapshot(other, b)).config.document).toEqual(
    presets.cleaning,
  );
  const restored = await importBlueprintPackage(
    await createBlueprintPackage(accepted, {
      name: "Fictional brand",
      description: "Saved draft choices, no records.",
    }),
  );
  expect(restored.plan).toEqual(accepted);
}
export async function brandingPublication(
  engine: Engine,
  owner: Principal,
  a: string,
  other: Principal,
  b: string,
) {
  const c = await inventory(engine, owner, a);
  await engine.saveRecord(
    owner,
    a,
    "stock-movements",
    movement(c.product, c.location),
    undefined,
    randomUUID(),
  );
  await engine.saveRecord(owner, a, "customers", {
    name: "Retained fictional client",
  });
  const before = await engine.snapshot(owner, a),
    plan = brandBuildPlan(planForConfig(presets.property), {
      ...defaultBranding("property"),
      monogram: "CG",
      tagline: "A fictional place to call home.",
      mark: "home",
    }),
    id = randomUUID();
  await engine.saveBuildPlan(owner, a, plan, id, 0, 1);
  await expect(
    engine.publishBuildPlan(owner, a, {
      id,
      revision: 1,
      configRevision: 1,
      confirmation: "",
    }),
  ).rejects.toThrow();
  expect((await engine.snapshot(owner, a)).config.revision).toBe(1);
  await engine.publishBuildPlan(owner, a, {
    id,
    revision: 1,
    configRevision: 1,
    confirmation: publishPlanConfirmation,
  });
  const second = brandBuildPlan(plan, {
    ...plan.configuration.branding!,
    palette: "copper-v1",
    appearance: "dark",
  });
  const competing = await Promise.allSettled([
    engine.publishConfig(owner, a, second.configuration, 2),
    engine.publishConfig(owner, a, plan.configuration, 2),
  ]);
  expect(competing.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(competing.find((r) => r.status === "rejected")?.reason.status).toBe(
    409,
  );
  await engine.publishConfig(owner, a, plan.configuration, 3, 2);
  expect((await engine.snapshot(owner, a)).config.document.branding).toEqual(
    plan.configuration.branding,
  );
  await engine.publishConfig(owner, a, presets.property, 4, 1);
  const after = await engine.snapshot(owner, a);
  expect(after.config.document).toEqual(presets.property);
  expect(after.config.revision).toBe(5);
  expect(after.history).toHaveLength(5);
  expect(after.buildPlans[0].document.configuration.branding).toEqual(
    plan.configuration.branding,
  );
  for (const key of [
    "records",
    "stockBalances",
    "stockMovements",
    "staffAssignments",
    "estimateVersions",
  ] as const)
    expect(after[key]).toEqual(before[key]);
  expect(after.audit.filter((e) => e.entity === "configuration")).toHaveLength(
    before.audit.filter((e) => e.entity === "configuration").length + 4,
  );
  expect((await engine.snapshot(other, b)).config.document).toEqual(
    presets.cleaning,
  );
}
