import { afterAll, afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  startDemo,
  runtime,
  previewBuildPlan,
  rehearseBuildPlan,
} from "../../src/server/demo";
import {
  planForConfig,
  addCustomField,
  brandBuildPlan,
  selectModules,
  newBuildPlan,
} from "../../src/core/buildplan";
import { defaultBranding } from "../../src/core/branding";
import { rehearsalReport } from "../../src/core/rehearsal";
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  const rt = await runtime();
  await rt.db.close();
  delete (globalThis as typeof globalThis & { lmsDemo?: unknown }).lmsDemo;
});
it("rehearses branded optional-field changes once with concurrent exact retries, fictional privacy and preserved source history", async () => {
  const { session } = await startDemo(),
    rt = await runtime(),
    org = session.organizations[0].id;
  await rt.engine.saveRecord(session.principal, org, "customers", {
    name: "PRIVATE SOURCE CUSTOMER",
    notes: "PRIVATE SOURCE NOTES",
  });
  const plan = brandBuildPlan(
    planForConfig(
      (await rt.engine.snapshot(session.principal, org)).config.document,
    ),
    defaultBranding("property"),
  );
  plan.configuration = addCustomField(plan.configuration, "customers", {
    key: "extra_rehearsal",
    label: "Rehearsal notes",
    type: "text",
    required: false,
  });
  const id = randomUUID();
  await rt.engine.saveBuildPlan(session.principal, org, plan, id, 0, 1);
  const before = await rt.engine.snapshot(session.principal, org),
    review = await rt.engine.reviewBuildPlanImpact(session.principal, org, {
      document: plan,
      draft: { id, revision: 1 },
    });
  expect(review.overall).toBe("migration-review");
  const input = {
    document: plan,
    draft: { id, revision: 1 },
    expected: review.state,
    operationId: randomUUID(),
  };
  const [a, b] = await Promise.all([
    rehearseBuildPlan(session, org, input),
    rehearseBuildPlan(session, org, input),
  ]);
  expect(a).toEqual(b);
  expect(a.outcomes.filter((c) => c.status === "failed")).toEqual([]);
  expect(a).toMatchObject({ status: "completed" });
  expect(a.outcomes.every((c) => c.status === "passed")).toBe(true);
  expect(session.rehearsals.size).toBe(1);
  expect(session.organizations).toHaveLength(3);
  const generated = await rt.engine.snapshot(
    session.principal,
    a.workspace!.organizationId,
  );
  expect(generated.config.document).toEqual(plan.configuration);
  expect(generated.history).toHaveLength(1);
  expect(generated.buildPlans).toEqual([]);
  expect(JSON.stringify(generated)).not.toContain("PRIVATE SOURCE");
  expect(JSON.stringify(rehearsalReport(review, a))).not.toContain(
    "PRIVATE SOURCE",
  );
  expect(await rt.engine.snapshot(session.principal, org)).toEqual(before);
  const customer = generated.records.find((r) => r.entity === "customers")!;
  expect(customer.data.extra_rehearsal).toBe("Fictional rehearsal value");
  a.outcomes[0].status = "failed";
  expect((await rehearseBuildPlan(session, org, input)).status).toBe(
    "completed",
  );
  await rt.engine.saveRecord(
    session.principal,
    generated.organizationId,
    "customers",
    { ...customer.data, name: "Fictional manual edit" },
    customer,
  );
  await expect(rehearseBuildPlan(session, org, input)).rejects.toMatchObject({
    status: 409,
  });
  expect(await rt.engine.snapshot(session.principal, org)).toEqual(before);
});
it("marks disabled modules untested and refuses stale, unsupported, changed-identity and foreign-scope requests before allocation", async () => {
  const { session } = await startDemo(),
    rt = await runtime(),
    org = session.organizations[1].id;
  let plan = planForConfig(
    (await rt.engine.snapshot(session.principal, org)).config.document,
  );
  plan.configuration = selectModules(plan.configuration, [
    "customers",
    "tasks",
    "cleaning",
  ]);
  const review = await rt.engine.reviewBuildPlanImpact(session.principal, org, {
      document: plan,
    }),
    input = {
      document: plan,
      expected: review.state,
      operationId: randomUUID(),
    };
  const result = await rehearseBuildPlan(session, org, input);
  expect(result).toMatchObject({ status: "completed" });
  expect(
    result.outcomes
      .filter((c) => c.status === "not-applicable")
      .map((c) => c.id),
  ).toEqual(["scheduling", "inventory", "estimates"]);
  const other = await startDemo();
  await expect(
    rehearseBuildPlan(other.session, org, input),
  ).rejects.toMatchObject({ status: 403 });
  const before = await rt.engine.snapshot(session.principal, org);
  for (const bad of [
    { ...input, expected: undefined },
    { ...input, force: true },
    { ...input, document: { ...plan, version: 3 } },
    {
      ...input,
      document: {
        ...plan,
        configuration: {
          ...plan.configuration,
          modules: plan.configuration.modules.filter(
            (m) => m.id !== "customers",
          ),
        },
      },
    },
  ])
    await expect(rehearseBuildPlan(session, org, bad)).rejects.toThrow();
  const wrong = newBuildPlan("property"),
    wrongReview = await rt.engine.reviewBuildPlanImpact(
      session.principal,
      org,
      { document: wrong },
    );
  await expect(
    rehearseBuildPlan(session, org, {
      document: wrong,
      expected: wrongReview.state,
      operationId: randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(session.rehearsals.size).toBe(1);
  expect(await rt.engine.snapshot(session.principal, org)).toEqual(before);
  await rt.engine.saveRecord(session.principal, org, "customers", {
    name: "Fictional concurrent change",
  });
  await expect(
    rehearseBuildPlan(session, org, { ...input, operationId: randomUUID() }),
  ).rejects.toMatchObject({ status: 409 });
  const fresh = await rt.engine.reviewBuildPlanImpact(session.principal, org, {
    document: plan,
  });
  await expect(
    rehearseBuildPlan(session, org, { ...input, expected: fresh.state }),
  ).rejects.toMatchObject({ status: 409 });
  expect(session.rehearsals.size).toBe(1);
});
it("retires failed generated workspaces including immutable stock, sanitizes failures, retains exact failure retries and changes no source data", async () => {
  const { session } = await startDemo(),
    rt = await runtime(),
    org = session.organizations[0].id;
  const plan = planForConfig(
      (await rt.engine.snapshot(session.principal, org)).config.document,
    ),
    review = await rt.engine.reviewBuildPlanImpact(session.principal, org, {
      document: plan,
    });
  const input = {
      document: plan,
      expected: review.state,
      operationId: randomUUID(),
    },
    before = await rt.engine.snapshot(session.principal, org);
  const original = rt.engine.saveRecord.bind(rt.engine);
  const spy = vi
    .spyOn(rt.engine, "saveRecord")
    .mockImplementation((...args) => {
      if (args[2] === "estimates")
        return Promise.reject(new Error("SECRET DATABASE DETAILS"));
      return original(...args);
    });
  const failed = await rehearseBuildPlan(session, org, input);
  spy.mockRestore();
  expect(failed.status).toBe("failed");
  expect(failed.workspace).toBeUndefined();
  expect(failed.outcomes.find((c) => c.id === "inventory")?.status).toBe(
    "passed",
  );
  expect(failed.outcomes.find((c) => c.id === "estimates")?.status).toBe(
    "failed",
  );
  expect(JSON.stringify(failed)).not.toContain("SECRET");
  expect(await rehearseBuildPlan(session, org, input)).toEqual(failed);
  expect(session.organizations).toHaveLength(2);
  expect(session.rehearsalOrganizations.size).toBe(0);
  expect(
    (
      await rt.db.query(
        "select count(*)::int as n from lms.memberships where user_id=$1",
        [session.principal.userId],
      )
    ).rows[0],
  ).toEqual({ n: 2 });
  expect(await rt.engine.snapshot(session.principal, org)).toEqual(before);
  expect(
    (
      await rehearseBuildPlan(session, org, {
        ...input,
        operationId: randomUUID(),
      })
    ).status,
  ).toBe("completed");
});
it("shares the three-slot preview quota, binds draft versions and expires every generated organization", async () => {
  const { session } = await startDemo(),
    rt = await runtime(),
    org = session.organizations[0].id;
  const plan = planForConfig(
      (await rt.engine.snapshot(session.principal, org)).config.document,
    ),
    draft = randomUUID();
  await rt.engine.saveBuildPlan(session.principal, org, plan, draft, 0, 1);
  const review = await rt.engine.reviewBuildPlanImpact(session.principal, org, {
      document: plan,
      draft: { id: draft, revision: 1 },
    }),
    input = {
      document: plan,
      draft: { id: draft, revision: 1 },
      expected: review.state,
      operationId: randomUUID(),
    };
  await previewBuildPlan(session, org, plan, randomUUID());
  await previewBuildPlan(session, org, plan, randomUUID());
  const result = await rehearseBuildPlan(session, org, input);
  expect(result).toMatchObject({ status: "completed" });
  expect(await rehearseBuildPlan(session, org, input)).toEqual(result);
  await expect(
    rehearseBuildPlan(session, org, { ...input, operationId: randomUUID() }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    previewBuildPlan(session, org, plan, randomUUID()),
  ).rejects.toMatchObject({ status: 409 });
  const changed = structuredClone(plan);
  changed.configuration.name = "Changed fictional draft";
  await rt.engine.saveBuildPlan(session.principal, org, changed, draft, 1, 1);
  await expect(rehearseBuildPlan(session, org, input)).rejects.toMatchObject({
    status: 409,
  });
  const ids = session.organizations.map((o) => o.id);
  session.expiresAt = Date.now() - 1;
  await expect(rehearseBuildPlan(session, org, input)).rejects.toMatchObject({
    status: 401,
  });
  await startDemo();
  expect(
    (
      await rt.db.query(
        "select id from lms.organizations where id=any($1::uuid[])",
        [ids],
      )
    ).rows,
  ).toEqual([]);
});
it("rejects source changes during fixture execution and retires only the generated workspace", async () => {
  const { session } = await startDemo(),
    rt = await runtime(),
    org = session.organizations[0].id;
  const plan = planForConfig(
      (await rt.engine.snapshot(session.principal, org)).config.document,
    ),
    review = await rt.engine.reviewBuildPlanImpact(session.principal, org, {
      document: plan,
    });
  const before = await rt.engine.snapshot(session.principal, org),
    original = rt.engine.saveRecord.bind(rt.engine);
  let changed = false;
  const spy = vi
    .spyOn(rt.engine, "saveRecord")
    .mockImplementation(async (...args) => {
      const row = await original(...args);
      if (args[1] !== org && args[2] === "items" && !changed) {
        changed = true;
        await original(session.principal, org, "customers", {
          name: "Fictional concurrent host edit",
        });
      }
      return row;
    });
  await expect(
    rehearseBuildPlan(session, org, {
      document: plan,
      expected: review.state,
      operationId: randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 409 });
  spy.mockRestore();
  expect(session.organizations).toHaveLength(2);
  expect(session.rehearsalOrganizations.size).toBe(0);
  const after = await rt.engine.snapshot(session.principal, org);
  expect(after.history).toEqual(before.history);
  expect(after.buildPlans).toEqual(before.buildPlans);
  expect(after.records).toHaveLength(before.records.length + 1);
  expect(
    after.records.some((r) => r.data.name === "Fictional rehearsal customer"),
  ).toBe(false);
});
