import { afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  startDemo,
  runtime,
  previewBuildPlan,
  requireDemoOrg,
  findSession,
} from "../../src/server/demo";
import { reviewedGallery, remixGalleryEntry } from "../../src/core/gallery";
import { newBuildPlan } from "../../src/core/buildplan";
import { brandBuildPlan } from "../../src/core/buildplan";
import { defaultBranding } from "../../src/core/branding";
import {
  reviewedTemplateHistory,
  latestTemplate,
} from "../../src/core/template-history";
import {
  reviewTemplateUpdate,
  useTemplateChanges,
} from "../../src/core/template-update";
afterAll(async () => {
  const rt = await runtime();
  await rt.db.close();
  delete (globalThis as typeof globalThis & { lmsDemo?: unknown }).lmsDemo;
});
it("previews explicitly reviewed template choices through the same isolated Engine without changing source history", async () => {
  const { session } = await startDemo(),
    rt = await runtime(),
    source = session.organizations[0].id,
    before = await rt.engine.snapshot(session.principal, source),
    history = await reviewedTemplateHistory(),
    base = history.find(
      (h) =>
        h.entry.metadata.id === "property-maintenance" &&
        h.entry.metadata.revision === 1,
    )!,
    review = reviewTemplateUpdate(
      base.entry.plan,
      latestTemplate(history, "property-maintenance")!,
      undefined,
      1,
    );
  const plan = useTemplateChanges(review, ["branding"], {
    current: base.entry.plan,
    config: before.config.document,
    populated: before.populatedEntities,
    revision: 1,
    allowVersionChange: true,
  });
  const preview = await previewBuildPlan(session, source, plan, randomUUID());
  expect(
    (await rt.engine.snapshot(session.principal, preview.id)).config.document,
  ).toEqual(plan.configuration);
  expect(await rt.engine.snapshot(session.principal, source)).toEqual(before);
});
it("previews exact branded configuration through the shared Engine without changing the source workspace", async () => {
  const { session } = await startDemo(),
    rt = await runtime(),
    source = session.organizations[0].id,
    before = await rt.engine.snapshot(session.principal, source),
    plan = brandBuildPlan(newBuildPlan("cleaning"), {
      ...defaultBranding("cleaning"),
      monogram: "FC",
      tagline: "Fictional shine.",
    });
  const preview = await previewBuildPlan(session, source, plan, randomUUID());
  expect(
    (await rt.engine.snapshot(session.principal, preview.id)).config.document,
  ).toEqual(plan.configuration);
  expect(await rt.engine.snapshot(session.principal, source)).toEqual(before);
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

it("uses the same real preview engine for gallery templates and preserves its existing three-slot quota", async () => {
  const { session } = await startDemo(),
    rt = await runtime(),
    source = session.organizations[0].id,
    entries = reviewedGallery();
  const plan = remixGalleryEntry(entries[0]),
    op = randomUUID(),
    org = await previewBuildPlan(session, source, plan, op);
  expect((await previewBuildPlan(session, source, plan, op)).id).toBe(org.id);
  await rt.engine.saveRecord(session.principal, org.id, "customers", {
    name: "Gallery preview client",
  });
  await expect(
    rt.engine.saveRecord(session.principal, org.id, "appointments", {}),
  ).rejects.toThrow(/disabled/);
  expect(
    (await rt.engine.snapshot(session.principal, source)).records.some(
      (r) => r.data.name === "Gallery preview client",
    ),
  ).toBe(false);
  await previewBuildPlan(
    session,
    source,
    remixGalleryEntry(entries[1]),
    randomUUID(),
  );
  await previewBuildPlan(
    session,
    source,
    remixGalleryEntry(entries[3]),
    randomUUID(),
  );
  await expect(
    previewBuildPlan(
      session,
      source,
      remixGalleryEntry(entries[4]),
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
});
