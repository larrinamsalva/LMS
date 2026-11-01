import { expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { Engine, Principal } from "../../src/core/engine";
import {
  addCustomField,
  planForConfig,
  publishPlanConfirmation,
} from "../../src/core/buildplan";
import { createBlueprintPackage } from "../../src/core/blueprint";
import { inspectBlueprintPackage } from "../../src/core/blueprint-provenance";
import { testAttestation, testPublisher } from "./blueprint-provenance";
/** Shared PGlite / forced-RLS native PostgreSQL assertion: signatures never grant business permissions. */
export async function publisherBoundary(
  engine: Engine,
  owner: Principal,
  a: string,
  unauthorized: Principal[],
  other: Principal,
  b: string,
) {
  await engine.saveRecord(owner, a, "customers", {
    name: "PRIVATE FICTIONAL CUSTOMER",
  });
  const before = await engine.snapshot(owner, a),
    otherBefore = await engine.snapshot(other, b),
    plan = planForConfig(before.config.document),
    publisher = testPublisher();
  plan.configuration = addCustomField(plan.configuration, "customers", {
    key: "extra_publisher",
    label: "Fictional option",
    type: "text",
    required: false,
  });
  const bytes = await createBlueprintPackage(plan, {
      name: "Signed fictional configuration",
      description: "No operations authorized.",
    }),
    result = await inspectBlueprintPackage(
      bytes,
      await testAttestation(bytes, publisher),
      publisher.registry,
    ),
    id = randomUUID();
  expect(result.publisher.status).toBe("verified");
  expect(await engine.snapshot(owner, a)).toEqual(before);
  for (const p of unauthorized) {
    await expect(
      engine.saveBuildPlan(p, a, result.blueprint.plan, id, 0, 1),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      engine.publishBuildPlan(p, a, {
        id,
        revision: 1,
        configRevision: 1,
        confirmation: publishPlanConfirmation,
      }),
    ).rejects.toMatchObject({ status: 403 });
  }
  await engine.saveBuildPlan(owner, a, result.blueprint.plan, id, 0, 1);
  await expect(
    engine.publishBuildPlan(owner, a, {
      id,
      revision: 1,
      configRevision: 1,
      confirmation: publishPlanConfirmation,
    }),
  ).rejects.toThrow(/populated|migration/i);
  plan.configuration.name = "Explicit later draft";
  await engine.saveBuildPlan(owner, a, plan, id, 1, 1);
  await expect(
    engine.publishBuildPlan(owner, a, {
      id,
      revision: 1,
      configRevision: 1,
      confirmation: publishPlanConfirmation,
    }),
  ).rejects.toMatchObject({ status: 409 });
  const after = await engine.snapshot(owner, a);
  expect(after.records).toEqual(before.records);
  expect(after.config).toEqual(before.config);
  expect(after.audit.filter((e) => e.record_id !== id)).toEqual(before.audit);
  expect(after.buildPlans).toHaveLength(2);
  expect(await engine.snapshot(other, b)).toEqual(otherBefore);
}
