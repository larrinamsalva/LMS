import { afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  startDemo,
  runtime,
  previewBuildPlan,
  requireDemoOrg,
  findSession,
} from "../../src/server/demo";
import { newBuildPlan } from "../../src/core/buildplan";
afterAll(async () => {
  const rt = await runtime();
  await rt.db.close();
  delete (globalThis as typeof globalThis & { lmsDemo?: unknown }).lmsDemo;
});
it("materializes isolated real-Engine previews with bounded concurrent/idempotent creation", async () => {
  const { session } = await startDemo(),
    rt = await runtime(),
    source = session.organizations[0].id,
    plan = newBuildPlan("custom"),
    op = randomUUID();
  const same = await Promise.all([
    previewBuildPlan(session, source, plan, op),
    previewBuildPlan(session, source, plan, op),
  ]);
  expect(same[0].id).toBe(same[1].id);
  const before = await rt.engine.snapshot(session.principal, same[0].id);
  expect(before.config.document).toEqual(plan.configuration);
  expect(before.records).toEqual([]);
  await rt.engine.saveRecord(session.principal, same[0].id, "customers", {
    name: "Preview-only customer",
  });
  expect(
    (await rt.engine.snapshot(session.principal, source)).records.some(
      (r) => r.data.name === "Preview-only customer",
    ),
  ).toBe(false);
  await expect(
    previewBuildPlan(session, source, newBuildPlan("cleaning"), op),
  ).rejects.toMatchObject({ status: 409 });
  await Promise.all([
    previewBuildPlan(session, source, newBuildPlan("property"), randomUUID()),
    previewBuildPlan(session, source, newBuildPlan("cleaning"), randomUUID()),
  ]);
  await expect(
    previewBuildPlan(session, source, plan, randomUUID()),
  ).rejects.toMatchObject({ status: 409 });
  const other = await startDemo();
  expect(() => requireDemoOrg(other.session, same[0].id)).toThrow();
});
it("expires preview access and retires the whole fictional organization including protected stock history", async () => {
  const { session, token } = await startDemo(),
    rt = await runtime(),
    user = session.principal.userId;
  const preview = await previewBuildPlan(
    session,
    session.organizations[0].id,
    newBuildPlan("property"),
    randomUUID(),
  );
  session.expiresAt = Date.now() - 1;
  await expect(findSession(token)).rejects.toMatchObject({ status: 401 });
  await startDemo();
  expect(
    (
      await rt.db.query("select * from lms.organizations where id=$1", [
        preview.id,
      ])
    ).rows,
  ).toEqual([]);
  expect(
    (await rt.db.query("select * from lms.users where id=$1", [user])).rows,
  ).toEqual([]);
});
