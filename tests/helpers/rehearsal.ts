import { expect } from "vitest";
import { runFictionalChecks } from "../../src/server/rehearsal";
import { type Engine, type Principal } from "../../src/core/engine";
import { rehearsalReport } from "../../src/core/rehearsal";
import type { BuildPlan } from "../../src/core/buildplan";
export async function generatedInvariants(
  engine: Engine,
  p: Principal,
  source: string,
  target: string,
  plan: BuildPlan,
) {
  const before = await engine.snapshot(p, source),
    result = await runFictionalChecks(engine, p, target, plan);
  expect(result.outcomes.filter((c) => c.status === "failed")).toEqual([]);
  expect(result.status).toBe("completed");
  const after = await engine.snapshot(p, target);
  expect(after.config.document).toEqual(plan.configuration);
  expect(after.history).toHaveLength(1);
  expect(after.buildPlans).toEqual([]);
  expect(after.stockBalances[0]?.units).toBe("23");
  expect(after.stockMovements).toHaveLength(2);
  expect(after.estimateVersions).toHaveLength(1);
  expect(after.records.filter((r) => r.entity === "appointments")).toHaveLength(
    1,
  );
  const customer = after.records.find((r) => r.entity === "customers")!;
  expect(after.records.find((r) => r.entity === "tasks")!.data.customer).toBe(
    customer.id,
  );
  expect(JSON.stringify(after)).not.toContain("PRIVATE SOURCE");
  const review = await engine.reviewBuildPlanImpact(p, source, {
    document: plan,
  });
  if (plan.template === before.config.document.industry) {
    expect(review.overall).toBe("migration-review");
    expect(review.entities.find((e) => e.entity === "customers")).toMatchObject(
      { active: 0, archived: 1 },
    );
  }
  const report = JSON.stringify(
    rehearsalReport(review, {
      version: 1,
      ...result,
      workspace: { organizationId: target },
    }),
  );
  for (const value of [
    target,
    p.userId,
    "PRIVATE SOURCE",
    '"stockBalances":',
    "stateDigest",
  ])
    expect(report).not.toContain(value);
  await expect(
    runFictionalChecks(engine, p, target, plan),
  ).rejects.toMatchObject({ status: 409 });
  expect(await engine.snapshot(p, target)).toEqual(after);
  expect(await engine.snapshot(p, source)).toEqual(before);
}
export async function refusalAndFailure(
  engine: Engine,
  p: Principal,
  source: string,
  target: string,
  plan: BuildPlan,
  denied: Principal[],
) {
  const before = await engine.snapshot(p, source),
    empty = await engine.snapshot(p, target);
  for (const actor of denied)
    await expect(
      runFictionalChecks(engine, actor, target, plan),
    ).rejects.toMatchObject({ status: 403 });
  await expect(
    runFictionalChecks(engine, p, source, plan),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    runFictionalChecks(engine, p, target, { ...plan, version: 3 } as any),
  ).rejects.toThrow();
  const failed = new Proxy(engine, {
    get(object, key) {
      if (key === "saveRecord")
        return () => Promise.reject(new Error("SECRET failure details"));
      const value = Reflect.get(object, key);
      return typeof value === "function" ? value.bind(object) : value;
    },
  });
  const result = await runFictionalChecks(failed, p, target, plan);
  expect(result.status).toBe("failed");
  expect(JSON.stringify(result)).not.toContain("SECRET");
  expect(await engine.snapshot(p, target)).toEqual(empty);
  expect(await engine.snapshot(p, source)).toEqual(before);
}
