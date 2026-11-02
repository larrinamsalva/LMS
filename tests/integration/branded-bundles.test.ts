import { afterAll, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { GET, POST, PATCH } from "../../src/app/api/demo/logo/route";
import { POST as DOWNLOAD } from "../../src/app/api/demo/logo/download/route";
import { startDemo, runtime, logoAccess } from "../../src/server/demo";
import {
  createBrandedBlueprintBundle,
  inspectBrandedBlueprintBundle,
} from "../../src/core/branded-bundle";
import { createBlueprintPackage } from "../../src/core/blueprint";
import { planForConfig, brandBuildPlan } from "../../src/core/buildplan";
import { defaultBranding } from "../../src/core/branding";
import { presets } from "../../src/presets";
import {
  createLogoCompanion,
  inspectLogoCompanion,
} from "../../src/core/logo-companion";
import { crc32 } from "../../src/core/stored-archive";
import { logoFixture } from "../helpers/logo-fixtures";
const base = "http://localhost:3000";
afterAll(async () => {
  const rt = await runtime();
  rt.logos.close();
  await rt.db.close();
  delete (globalThis as typeof globalThis & { lmsDemo?: unknown }).lmsDemo;
});
function req(
  token: string | undefined,
  org: string,
  method = "GET",
  body?: Uint8Array | object,
  query: Record<string, string> = {},
) {
  return new NextRequest(
    `${base}/api/demo/logo?${new URLSearchParams({ organizationId: org, ...query })}`,
    {
      method,
      headers: {
        origin: base,
        host: "localhost:3000",
        "sec-fetch-site": "same-origin",
        ...(token ? { cookie: `lms_demo=${token}` } : {}),
        ...(body
          ? {
              "content-type":
                body instanceof Uint8Array
                  ? "application/octet-stream"
                  : "application/json",
            }
          : {}),
      },
      ...(body
        ? {
            body:
              body instanceof Uint8Array
                ? new Uint8Array(body)
                : JSON.stringify(body),
          }
        : {}),
    },
  );
}
function stage(
  token: string | undefined,
  org: string,
  bytes: Uint8Array,
  revision: number,
  operationId = randomUUID(),
) {
  return POST(
    req(token, org, "POST", bytes, {
      kind: "companion",
      revision: String(revision),
      operationId,
    }),
  );
}
async function fixture() {
  const zip = await createBlueprintPackage(
      brandBuildPlan(
        planForConfig(presets.cleaning),
        defaultBranding("cleaning"),
      ),
      {
        name: "Fictional bundle integration",
        description: "No operational records or authority travel.",
      },
    ),
    png = await logoFixture(),
    companion = await createLogoCompanion(png, {
      width: 128,
      height: 64,
      display: "rectangle",
    });
  return {
    zip,
    png,
    companion,
    bundle: await createBrandedBlueprintBundle(zip, companion),
  };
}
it("exports an approved selected logo, imports exact components into another fresh demo, and requires independent staging/selection without changing either business", async () => {
  const source = await startDemo(),
    target = await startDemo(),
    rt = await runtime(),
    a = source.session.organizations[0].id,
    b = target.session.organizations[0].id;
  const before = await rt.engine.snapshot(source.session.principal, a),
    targetBefore = await rt.engine.snapshot(target.session.principal, b);
  const uploaded = await (
    await POST(
      req(source.token, a, "POST", await logoFixture(), {
        revision: "0",
        operationId: randomUUID(),
      }),
    )
  ).json();
  const chosen = await (
    await PATCH(
      req(source.token, a, "PATCH", {
        action: "select",
        assetId: uploaded.staged.id,
        revision: 1,
        operationId: randomUUID(),
      }),
    )
  ).json();
  const sourceState = rt.logos.state(source.session, a),
    body = {
      organizationId: a,
      assetId: chosen.selected.id,
      revision: 2,
      format: "companion",
    };
  const response = await DOWNLOAD(
    new NextRequest(
      `${base}/api/demo/logo/download`,
      req(source.token, a, "POST", body),
    ),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const companion = new Uint8Array(await response.arrayBuffer()),
    s = await fixture(),
    bundle = await createBrandedBlueprintBundle(s.zip, companion),
    inspection = await inspectBrandedBlueprintBundle(bundle);
  expect(inspection.blueprintBytes).toEqual(s.zip);
  expect(inspection.logoBytes).toEqual(companion);
  expect(JSON.stringify(inspection.manifest)).not.toContain(chosen.selected.id);
  expect(rt.logos.state(source.session, a)).toEqual(sourceState);
  expect(rt.logos.state(target.session, b)).toMatchObject({
    revision: 0,
    selected: null,
    staged: null,
    remainingUploads: 12,
  });
  expect((await stage(undefined, b, inspection.logoBytes!, 0)).status).toBe(
    401,
  );
  expect((await stage(source.token, b, inspection.logoBytes!, 0)).status).toBe(
    403,
  );
  expect((await stage(target.token, b, inspection.logoBytes!, 0)).status).toBe(
    200,
  );
  const staged = rt.logos.state(target.session, b);
  expect(staged.selected).toBeNull();
  expect(staged.staged!.id).not.toBe(chosen.selected.id);
  expect(staged.remainingUploads).toBe(11);
  expect(
    (
      await GET(
        req(target.token, a, "GET", undefined, { assetId: chosen.selected.id }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await GET(
        req(target.token, b, "GET", undefined, { assetId: chosen.selected.id }),
      )
    ).status,
  ).toBe(404);
  const selected = await PATCH(
    req(target.token, b, "PATCH", {
      action: "select",
      assetId: staged.staged!.id,
      revision: 1,
      operationId: randomUUID(),
    }),
  );
  expect(selected.status).toBe(200);
  expect(await rt.engine.snapshot(source.session.principal, a)).toEqual(before);
  expect(await rt.engine.snapshot(target.session.principal, b)).toEqual(
    targetBefore,
  );
  expect(rt.logos.state(source.session, a)).toEqual(sourceState);
  expect(
    (
      await rt.db.query<{ t: string | null }>(
        "select to_regclass('lms.logo_associations')::text t",
      )
    ).rows[0].t,
  ).toBeNull();
});
it("never treats valid bundle/image hashes as safety: the original sanitizer rejects animation and preserves the selected logo", async () => {
  const { session, token } = await startDemo(),
    rt = await runtime(),
    org = session.organizations[0].id,
    s = await fixture();
  const first = await (await stage(token, org, s.companion, 0)).json();
  await PATCH(
    req(token, org, "PATCH", {
      action: "select",
      assetId: first.staged.id,
      revision: 1,
      operationId: randomUUID(),
    }),
  );
  const before = rt.logos.state(session, org),
    business = await rt.engine.snapshot(session.principal, org),
    chunk = Buffer.alloc(20);
  chunk.writeUInt32BE(8, 0);
  chunk.write("acTL", 4);
  chunk.writeUInt32BE(1, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 16)), 16);
  const animated = Buffer.concat([
      s.png.subarray(0, 33),
      chunk,
      s.png.subarray(33),
    ]),
    companion = await createLogoCompanion(animated, {
      width: 128,
      height: 64,
      display: "rectangle",
    }),
    inspection = await inspectBrandedBlueprintBundle(
      await createBrandedBlueprintBundle(s.zip, companion),
    );
  expect(inspection.logo!.image.sha256).toBe(
    (await inspectLogoCompanion(companion)).manifest.image.sha256,
  );
  expect(inspection).not.toHaveProperty("image");
  const failed = await stage(
    token,
    org,
    inspection.logoBytes!,
    before.revision,
  );
  expect(failed.status).toBe(422);
  expect(rt.logos.state(session, org)).toMatchObject({
    revision: before.revision,
    selected: before.selected,
    staged: null,
    remainingUploads: 10,
  });
  expect(await rt.engine.snapshot(session.principal, org)).toEqual(business);
});
it("uses current membership, post-sanitization revocation and session expiry rather than bundle possession as authority", async () => {
  const source = await startDemo(),
    rt = await runtime(),
    org = source.session.organizations[0].id,
    s = await fixture(),
    r = await inspectBrandedBlueprintBundle(s.bundle),
    admin = randomUUID(),
    owner = source.session.principal;
  await rt.db.query(
    "insert into lms.users values($1,'Fictional bundle administrator')",
    [admin],
  );
  await rt.db.query("insert into lms.memberships values($1,$2,'admin')", [
    org,
    admin,
  ]);
  source.session.principal = { userId: admin };
  const op = randomUUID();
  await expect(
    rt.logos.stage(
      source.session,
      org,
      r.logoBytes!,
      0,
      op,
      async () => {
        await rt.db.query(
          "delete from lms.memberships where organization_id=$1 and user_id=$2",
          [org, admin],
        );
        await logoAccess(source.session, org, true);
      },
      "companion",
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect(rt.logos.state(source.session, org)).toMatchObject({
    revision: 0,
    selected: null,
    staged: null,
    remainingUploads: 11,
  });
  expect((await stage(source.token, org, r.logoBytes!, 0)).status).toBe(403);
  source.session.principal = owner;
  source.session.expiresAt = Date.now() - 1;
  expect((await stage(source.token, org, r.logoBytes!, 0)).status).toBe(401);
});
it("retains the original upload budget, exact retries and stale/conflicting-request rejection across bundle reuse", async () => {
  const { session, token } = await startDemo(),
    rt = await runtime(),
    org = session.organizations[0].id,
    s = await fixture(),
    r = await inspectBrandedBlueprintBundle(s.bundle),
    id = randomUUID(),
    before = await rt.engine.snapshot(session.principal, org);
  const first = await stage(token, org, r.logoBytes!, 0, id);
  expect(first.status).toBe(200);
  const snapshot = rt.logos.state(session, org);
  expect((await stage(token, org, r.logoBytes!, 0, id)).status).toBe(200);
  expect(rt.logos.state(session, org)).toEqual(snapshot);
  const bad = r.logoBytes!.slice();
  bad[80] ^= 1;
  expect((await stage(token, org, bad, 0, id)).status).toBe(409);
  expect((await stage(token, org, r.logoBytes!, 0)).status).toBe(409);
  for (let i = 1; i < 12; i++) {
    const inspected = await inspectBrandedBlueprintBundle(s.bundle);
    expect((await stage(token, org, inspected.logoBytes!, i)).status).toBe(200);
  }
  const exhausted = rt.logos.state(session, org);
  expect(exhausted.remainingUploads).toBe(0);
  expect(
    (await stage(token, org, r.logoBytes!, exhausted.revision)).status,
  ).toBe(429);
  expect(rt.logos.state(session, org).staged).toEqual(exhausted.staged);
  expect(await rt.engine.snapshot(session.principal, org)).toEqual(before);
});
