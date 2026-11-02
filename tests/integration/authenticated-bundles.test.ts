import { afterAll, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { POST, PATCH } from "../../src/app/api/demo/logo/route";
import { startDemo, runtime, logoAccess } from "../../src/server/demo";
import { inspectAuthenticatedBrandedBundle } from "../../src/core/branded-bundle-provenance";
import { createBrandedBlueprintBundle } from "../../src/core/branded-bundle";
import { createLogoCompanion } from "../../src/core/logo-companion";
import { crc32 } from "../../src/core/stored-archive";
import { publishPlanConfirmation } from "../../src/core/buildplan";
import { fictionalBrandedBundle } from "../helpers/branded-logo";
import { testPublisher } from "../helpers/blueprint-provenance";
import { testBundleAttestation } from "../helpers/branded-bundle-provenance";
const base = "http://localhost:3000";
afterAll(async () => {
  const rt = await runtime();
  rt.logos.close();
  await rt.db.close();
  delete (globalThis as typeof globalThis & { lmsDemo?: unknown }).lmsDemo;
});
function stage(
  token: string | undefined,
  org: string,
  bytes: Uint8Array,
  revision: number,
  operationId = randomUUID(),
) {
  return POST(
    new NextRequest(
      base +
        "/api/demo/logo?" +
        new URLSearchParams({
          organizationId: org,
          kind: "companion",
          revision: String(revision),
          operationId,
        }),
      {
        method: "POST",
        headers: {
          origin: base,
          host: "localhost:3000",
          "sec-fetch-site": "same-origin",
          "content-type": "application/octet-stream",
          ...(token ? { cookie: "lms_demo=" + token } : {}),
        },
        body: new Uint8Array(bytes),
      },
    ),
  );
}
it("keeps complete-bundle authentication separate from actual session authority, explicit sanitization, selection and data publication", async () => {
  const a = await startDemo(),
    b = await startDemo(),
    rt = await runtime(),
    org = a.session.organizations[0].id,
    other = b.session.organizations[0].id,
    s = await fictionalBrandedBundle(),
    publisher = testPublisher();
  const before = await rt.engine.snapshot(a.session.principal, org),
    state = rt.logos.state(a.session, org),
    otherBefore = await rt.engine.snapshot(b.session.principal, other);
  const signed = await testBundleAttestation(s.bundle, publisher),
    r = await inspectAuthenticatedBrandedBundle(
      s.bundle,
      { attestation: signed },
      publisher.registry,
    );
  expect(r.publisher.status).toBe("verified");
  expect(rt.logos.state(a.session, org)).toEqual(state);
  expect(await rt.engine.snapshot(a.session.principal, org)).toEqual(before);
  expect((await stage(undefined, org, r.bundle.logoBytes!, 0)).status).toBe(
    401,
  );
  expect((await stage(b.token, org, r.bundle.logoBytes!, 0)).status).toBe(403);
  const op = randomUUID(),
    first = await stage(a.token, org, r.bundle.logoBytes!, 0, op);
  expect(first.status).toBe(200);
  const staged = await first.json();
  expect(staged.selected).toBeNull();
  expect(staged.staged).not.toBeNull();
  const current = rt.logos.state(a.session, org);
  expect((await stage(a.token, org, r.bundle.logoBytes!, 0, op)).status).toBe(
    200,
  );
  expect(rt.logos.state(a.session, org)).toEqual(current);
  const changed = r.bundle.logoBytes!.slice();
  changed[80] ^= 1;
  expect((await stage(a.token, org, changed, 0, op)).status).toBe(409);
  expect((await stage(a.token, org, r.bundle.logoBytes!, 0)).status).toBe(409);
  const response = await PATCH(
    new NextRequest(base + "/api/demo/logo?organizationId=" + org, {
      method: "PATCH",
      headers: {
        origin: base,
        host: "localhost:3000",
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        cookie: "lms_demo=" + a.token,
      },
      body: JSON.stringify({
        action: "select",
        assetId: staged.staged.id,
        revision: 1,
        operationId: randomUUID(),
      }),
    }),
  );
  expect(response.status).toBe(200);
  expect(await rt.engine.snapshot(a.session.principal, org)).toEqual(before);
  expect(await rt.engine.snapshot(b.session.principal, other)).toEqual(
    otherBefore,
  );
  for (const table of [
    "lms.logo_assets",
    "lms.logo_associations",
    "lms.logo_transfer_receipts",
  ])
    expect(
      (
        await rt.db.query<{ t: string | null }>(
          "select to_regclass($1)::text t",
          [table],
        )
      ).rows[0].t,
    ).toBeNull();
});
it("rejects a correctly signed hostile image at the original sanitizer and preserves the current image/engine state", async () => {
  const { session, token } = await startDemo(),
    rt = await runtime(),
    org = session.organizations[0].id,
    s = await fictionalBrandedBundle(),
    publisher = testPublisher();
  const before = await rt.engine.snapshot(session.principal, org),
    chunk = Buffer.alloc(20);
  chunk.writeUInt32BE(8);
  chunk.write("acTL", 4);
  chunk.writeUInt32BE(2, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 16)), 16);
  const png = Buffer.concat([
      s.image.subarray(0, 33),
      chunk,
      s.image.subarray(33),
    ]),
    companion = await createLogoCompanion(png, {
      width: 128,
      height: 64,
      display: "rectangle",
    }),
    bytes = await createBrandedBlueprintBundle(s.zip, companion);
  const r = await inspectAuthenticatedBrandedBundle(
    bytes,
    { attestation: await testBundleAttestation(bytes, publisher) },
    publisher.registry,
  );
  expect(r.publisher.status).toBe("verified");
  expect((await stage(token, org, r.bundle.logoBytes!, 0)).status).toBe(422);
  expect(rt.logos.state(session, org)).toMatchObject({
    revision: 0,
    staged: null,
    selected: null,
    remainingUploads: 11,
  });
  expect(await rt.engine.snapshot(session.principal, org)).toEqual(before);
});
it("rechecks revoked roles and expired sessions even with complete authenticated component commitments", async () => {
  const { session, token } = await startDemo(),
    rt = await runtime(),
    org = session.organizations[0].id,
    s = await fictionalBrandedBundle(),
    publisher = testPublisher(),
    r = await inspectAuthenticatedBrandedBundle(
      s.bundle,
      { attestation: await testBundleAttestation(s.bundle, publisher) },
      publisher.registry,
    );
  const admin = randomUUID(),
    original = session.principal;
  await rt.db.query(
    "insert into lms.users values($1,'Fictional signed bundle admin')",
    [admin],
  );
  await rt.db.query("insert into lms.memberships values($1,$2,'admin')", [
    org,
    admin,
  ]);
  session.principal = { userId: admin };
  await expect(
    rt.logos.stage(
      session,
      org,
      r.bundle.logoBytes!,
      0,
      randomUUID(),
      async () => {
        await rt.db.query(
          "delete from lms.memberships where organization_id=$1 and user_id=$2",
          [org, admin],
        );
        await logoAccess(session, org, true);
      },
      "companion",
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect((await stage(token, org, r.bundle.logoBytes!, 0)).status).toBe(403);
  session.principal = original;
  session.expiresAt = Date.now() - 1;
  expect((await stage(token, org, r.bundle.logoBytes!, 0)).status).toBe(401);
});

it("rejects stale saved/configuration revisions and foreign draft publication even after complete-bundle authentication", async () => {
  const { session } = await startDemo(),
    rt = await runtime(),
    org = session.organizations[1].id,
    other = session.organizations[0].id,
    s = await fictionalBrandedBundle(),
    publisher = testPublisher(),
    verified = await inspectAuthenticatedBrandedBundle(
      s.bundle,
      { attestation: await testBundleAttestation(s.bundle, publisher) },
      publisher.registry,
    ),
    id = randomUUID(),
    current = (await rt.engine.snapshot(session.principal, org)).config;
  const plan = verified.bundle.blueprint.plan;
  await rt.engine.saveBuildPlan(
    session.principal,
    org,
    plan,
    id,
    0,
    current.revision,
  );
  await rt.engine.saveBuildPlan(
    session.principal,
    org,
    {
      ...plan,
      configuration: {
        ...plan.configuration,
        name: "Newer deliberate choices",
      },
    },
    id,
    1,
    current.revision,
  );
  const before = await rt.engine.snapshot(session.principal, org);
  await expect(
    rt.engine.publishBuildPlan(session.principal, org, {
      id,
      revision: 1,
      configRevision: current.revision,
      confirmation: publishPlanConfirmation,
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(await rt.engine.snapshot(session.principal, org)).toEqual(before);
  await expect(
    rt.engine.publishBuildPlan(session.principal, other, {
      id,
      revision: 2,
      configRevision: current.revision,
      confirmation: publishPlanConfirmation,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await rt.engine.publishConfig(
    session.principal,
    org,
    { ...current.document, name: "Changed after import review" },
    current.revision,
  );
  const published = await rt.engine.snapshot(session.principal, org);
  await expect(
    rt.engine.publishBuildPlan(session.principal, org, {
      id,
      revision: 2,
      configRevision: current.revision,
      confirmation: publishPlanConfirmation,
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(await rt.engine.snapshot(session.principal, org)).toEqual(published);
  expect(published.buildPlans.filter((p) => p.id === id)).toHaveLength(2);
});
