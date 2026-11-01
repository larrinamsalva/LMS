import { afterAll, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { GET, POST, PATCH } from "../../src/app/api/demo/logo/route";
import { POST as DOWNLOAD } from "../../src/app/api/demo/logo/download/route";
import { inspectLogoCompanion } from "../../src/core/logo-companion";
import {
  startDemo,
  runtime,
  previewBuildPlan,
  logoAccess,
} from "../../src/server/demo";
import { planForConfig, brandBuildPlan } from "../../src/core/buildplan";
import { defaultBranding } from "../../src/core/branding";
import { createBlueprintPackage } from "../../src/core/blueprint";
import { logoFixture } from "../helpers/logo-fixtures";
const base = "http://localhost:3000";
afterAll(async () => {
  const rt = await runtime();
  rt.logos.close();
  await rt.db.close();
  delete (globalThis as typeof globalThis & { lmsDemo?: unknown }).lmsDemo;
});
function request(
  token: string | undefined,
  org: string,
  method = "GET",
  body?: Uint8Array | object,
  query: Record<string, string> = {},
  override: Record<string, string> = {},
) {
  const headers: Record<string, string> = {
    origin: base,
    host: "localhost:3000",
    "sec-fetch-site": "same-origin",
    ...(token ? { cookie: `lms_demo=${token}` } : {}),
    ...override,
  };
  if (body)
    headers["content-type"] =
      override["content-type"] ??
      (body instanceof Uint8Array
        ? "application/octet-stream"
        : "application/json");
  return new NextRequest(
    `${base}/api/demo/logo?${new URLSearchParams({ organizationId: org, ...query })}`,
    {
      method,
      headers,
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
async function stage(
  token: string,
  org: string,
  bytes: Uint8Array,
  revision = 0,
  operationId = randomUUID(),
) {
  return POST(
    request(token, org, "POST", bytes, {
      revision: String(revision),
      operationId,
    }),
  );
}
function save(
  token: string | undefined,
  org: string,
  assetId: string,
  revision: number,
  format: "png" | "companion" = "companion",
  headers: Record<string, string> = {},
) {
  const original = request(
    token,
    org,
    "POST",
    { organizationId: org, assetId, revision, format },
    {},
    headers,
  );
  return DOWNLOAD(new NextRequest(`${base}/api/demo/logo/download`, original));
}
it("keeps real demo logo bytes private, scoped and absent from configuration, audit and v1/v2 ZIP exports", async () => {
  const { token, session } = await startDemo(),
    rt = await runtime(),
    [a, b] = session.organizations.map((o) => o.id),
    before = await rt.engine.snapshot(session.principal, a),
    other = await rt.engine.snapshot(session.principal, b),
    plan = planForConfig(before.config.document),
    plans = [plan, brandBuildPlan(plan, defaultBranding("property"))],
    details = {
      name: "Fictional portable choices",
      description: "No assets or operational rows.",
    },
    portableBefore = await Promise.all(
      plans.map((p) => createBlueprintPackage(p, details)),
    ),
    bytes = await logoFixture(),
    operationId = randomUUID(),
    response = await stage(token, a, bytes, 0, operationId);
  expect(response.status).toBe(200);
  const state = await response.json();
  expect((await stage(token, a, bytes, 0, operationId)).status).toBe(200);
  expect(
    (await stage(token, a, Buffer.from("different"), 0, operationId)).status,
  ).toBe(409);
  const image = await GET(
    request(token, a, "GET", undefined, { assetId: state.staged.id }),
  );
  expect(image.status).toBe(200);
  expect(image.headers.get("content-type")).toBe("image/png");
  expect(image.headers.get("cache-control")).toContain("no-store");
  expect(image.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  expect(image.headers.get("x-content-type-options")).toBe("nosniff");
  expect(
    (
      await GET(
        request(undefined, a, "GET", undefined, { assetId: state.staged.id }),
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await GET(
        request(token, b, "GET", undefined, { assetId: state.staged.id }),
      )
    ).status,
  ).toBe(404);
  const foreign = await startDemo();
  expect(
    (
      await GET(
        request(foreign.token, a, "GET", undefined, {
          assetId: state.staged.id,
        }),
      )
    ).status,
  ).toBe(403);
  const selected = await PATCH(
    request(token, a, "PATCH", {
      action: "select",
      assetId: state.staged.id,
      revision: state.revision,
      operationId: randomUUID(),
    }),
  );
  expect(selected.status).toBe(200);
  for (const [index, p] of plans.entries()) {
    const zip = await createBlueprintPackage(p, details);
    expect(zip).toEqual(portableBefore[index]);
    expect(JSON.stringify(p)).not.toContain(state.staged.id);
    expect(JSON.stringify(p)).not.toContain("image/png");
  }
  const preview = await previewBuildPlan(session, a, plan, randomUUID());
  expect(
    (
      await GET(
        request(token, preview.id, "GET", undefined, {
          assetId: state.staged.id,
        }),
      )
    ).status,
  ).toBe(404);
  expect((await GET(request(token, preview.id))).status).toBe(200);
  expect(
    (await (await GET(request(token, preview.id))).json()).selected,
  ).toBeNull();
  expect(await rt.engine.snapshot(session.principal, a)).toEqual(before);
  expect(await rt.engine.snapshot(session.principal, b)).toEqual(other);
});
it("rejects CSRF, MIME spoofed executable bytes, overflows, unknown commands and wrong asset identities without replacing a logo", async () => {
  const { token, session } = await startDemo(),
    org = session.organizations[0].id,
    bytes = await logoFixture(),
    state = await (await stage(token, org, bytes)).json();
  expect(
    (
      await POST(
        request(
          token,
          org,
          "POST",
          bytes,
          { revision: "1", operationId: randomUUID() },
          { origin: "https://untrusted.invalid" },
        ),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await POST(
        request(
          token,
          org,
          "POST",
          bytes,
          { revision: "1", operationId: randomUUID() },
          { "content-type": "image/png" },
        ),
      )
    ).status,
  ).toBe(415);
  expect(
    (
      await stage(
        token,
        org,
        Buffer.from("<svg><script>evil()</script></svg>"),
        1,
      )
    ).status,
  ).toBe(422);
  expect((await stage(token, org, Buffer.alloc(1048577), 1)).status).toBe(413);
  expect(
    (
      await PATCH(
        request(token, org, "PATCH", {
          action: "remove",
          assetId: randomUUID(),
          revision: 1,
          operationId: randomUUID(),
        }),
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await PATCH(
        request(token, org, "PATCH", {
          action: "install",
          assetId: state.staged.id,
          revision: 1,
          operationId: randomUUID(),
          url: "https://untrusted.invalid/a.svg",
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await GET(
        request(
          token,
          org,
          "GET",
          undefined,
          { assetId: state.staged.id },
          { "sec-fetch-site": "cross-site" },
        ),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await GET(
        request(token, org, "GET", undefined, { assetId: state.staged.id }),
      )
    ).status,
  ).toBe(200);
});
it("uses Engine roles for owners/admins versus staff/viewers and rechecks revoked authority after sanitization", async () => {
  const { token, session } = await startDemo(),
    rt = await runtime(),
    org = session.organizations[0].id,
    bytes = await logoFixture(),
    state = await (await stage(token, org, bytes)).json(),
    original = session.principal;
  const selected = await (
    await PATCH(
      request(token, org, "PATCH", {
        action: "select",
        assetId: state.staged.id,
        revision: 1,
        operationId: randomUUID(),
      }),
    )
  ).json();
  const staged = await (
    await stage(token, org, bytes, selected.revision)
  ).json();
  for (const role of ["staff", "viewer", "admin"]) {
    const id = randomUUID();
    await rt.db.query(
      "insert into lms.users values($1,'Fictional logo role test')",
      [id],
    );
    await rt.db.query("insert into lms.memberships values($1,$2,$3)", [
      org,
      id,
      role,
    ]);
    session.principal = { userId: id };
    const read = await GET(request(token, org));
    expect(read.status).toBe(200);
    const meta = await read.json();
    expect(meta.staged !== null).toBe(role === "admin");
    expect(
      (await save(token, org, selected.selected.id, staged.revision)).status,
    ).toBe(role === "admin" ? 200 : 403);
    expect(
      (
        await GET(
          request(token, org, "GET", undefined, {
            assetId: selected.selected.id,
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await GET(
          request(token, org, "GET", undefined, { assetId: staged.staged.id }),
        )
      ).status,
    ).toBe(role === "admin" ? 200 : 404);
    if (role !== "admin")
      expect((await stage(token, org, bytes, staged.revision)).status).toBe(
        403,
      );
    if (role !== "admin")
      expect(
        (
          await PATCH(
            request(token, org, "PATCH", {
              action: "remove",
              assetId: selected.selected.id,
              revision: staged.revision,
              operationId: randomUUID(),
            }),
          )
        ).status,
      ).toBe(403);
  }
  session.principal = original;
  const staff = randomUUID();
  await rt.db.query(
    "insert into lms.users values($1,'Fictional revoked logo authority')",
    [staff],
  );
  await rt.db.query("insert into lms.memberships values($1,$2,'staff')", [
    org,
    staff,
  ]);
  await expect(
    rt.logos.stage(
      session,
      org,
      bytes,
      staged.revision,
      randomUUID(),
      async () => {
        session.principal = { userId: staff };
        await logoAccess(session, org, true);
      },
    ),
  ).rejects.toMatchObject({ status: 403 });
  session.principal = original;
  expect(rt.logos.state(session, org).staged!.id).toBe(staged.staged.id);
});
it("refuses expired sessions and clears their private bytes while another demo stays available", async () => {
  const first = await startDemo(),
    second = await startDemo(),
    bytes = await logoFixture(),
    org = first.session.organizations[0].id,
    state = await (await stage(first.token, org, bytes)).json();
  first.session.expiresAt = Date.now() - 1;
  expect(
    (
      await GET(
        request(first.token, org, "GET", undefined, {
          assetId: state.staged.id,
        }),
      )
    ).status,
  ).toBe(401);
  expect((await stage(first.token, org, bytes, 1)).status).toBe(401);
  expect((await save(first.token, org, state.staged.id, 1)).status).toBe(401);
  expect(
    (await GET(request(second.token, second.session.organizations[0].id)))
      .status,
  ).toBe(200);
});

it("saves private selected bytes then reimports into a new demo only after separate review, stage and select, preserving source history and all legacy formats", async () => {
  const source = await startDemo(),
    target = await startDemo(),
    rt = await runtime(),
    a = source.session.organizations[0].id,
    b = target.session.organizations[0].id;
  const before = await rt.engine.snapshot(source.session.principal, a),
    targetBefore = await rt.engine.snapshot(target.session.principal, b);
  const plan = planForConfig(before.config.document),
    details = {
      name: "Fictional companion compatibility",
      description: "Private images remain separate.",
    };
  const plans = [plan, brandBuildPlan(plan, defaultBranding("property"))];
  const original = await Promise.all(
    plans.map((p) => createBlueprintPackage(p, details)),
  );
  const staged = await (
    await stage(source.token, a, await logoFixture())
  ).json();
  expect((await save(source.token, a, staged.staged.id, 1)).status).toBe(409);
  const selected = await (
    await PATCH(
      request(source.token, a, "PATCH", {
        action: "select",
        assetId: staged.staged.id,
        revision: 1,
        operationId: randomUUID(),
      }),
    )
  ).json();
  const stateBefore = rt.logos.state(source.session, a);
  const response = await save(source.token, a, selected.selected.id, 2);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/zip");
  expect(response.headers.get("content-disposition")).toBe(
    'attachment; filename="lms-logo-companion.zip"',
  );
  for (const key of [
    "cache-control",
    "x-content-type-options",
    "cross-origin-resource-policy",
    "vary",
  ])
    expect(response.headers.get(key)).toBeTruthy();
  const archive = new Uint8Array(await response.arrayBuffer()),
    inspected = await inspectLogoCompanion(archive);
  const png = await save(source.token, a, selected.selected.id, 2, "png");
  expect(png.headers.get("content-type")).toBe("image/png");
  expect(new Uint8Array(await png.arrayBuffer())).toEqual(inspected.image);
  expect(rt.logos.state(source.session, a)).toEqual(stateBefore);
  expect((await save(undefined, a, selected.selected.id, 2)).status).toBe(401);
  expect((await save(target.token, a, selected.selected.id, 2)).status).toBe(
    403,
  );
  expect(
    (
      await save(
        source.token,
        source.session.organizations[1].id,
        selected.selected.id,
        0,
      )
    ).status,
  ).toBe(409);
  expect((await save(source.token, a, selected.selected.id, 1)).status).toBe(
    409,
  );
  expect(
    (
      await save(source.token, a, selected.selected.id, 2, "png", {
        origin: "https://evil.invalid",
      })
    ).status,
  ).toBe(403);
  const id = randomUUID(),
    importRequest = () =>
      request(target.token, b, "POST", archive, {
        kind: "companion",
        revision: "0",
        operationId: id,
      });
  const imported = await (await POST(importRequest())).json();
  expect(imported.selected).toBeNull();
  expect(imported.staged.id).not.toBe(selected.selected.id);
  expect(imported.staged.companion.imageSha256).toBe(
    inspected.manifest.image.sha256,
  );
  expect(await (await POST(importRequest())).json()).toEqual(imported);
  expect(
    (
      await POST(
        request(target.token, b, "POST", archive, {
          kind: "companion",
          revision: "0",
          operationId: randomUUID(),
        }),
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await POST(
        request(
          target.token,
          b,
          "POST",
          archive,
          { kind: "companion", revision: "1", operationId: randomUUID() },
          { "content-type": "image/png" },
        ),
      )
    ).status,
  ).toBe(415);
  expect(
    (
      await GET(
        request(source.token, b, "GET", undefined, {
          assetId: imported.staged.id,
        }),
      )
    ).status,
  ).toBe(403);
  const chosen = await PATCH(
    request(target.token, b, "PATCH", {
      action: "select",
      assetId: imported.staged.id,
      revision: 1,
      operationId: randomUUID(),
    }),
  );
  expect(chosen.status).toBe(200);
  expect((await chosen.json()).selected.id).toBe(imported.staged.id);
  for (const [i, p] of plans.entries())
    expect(await createBlueprintPackage(p, details)).toEqual(original[i]);
  expect(await rt.engine.snapshot(source.session.principal, a)).toEqual(before);
  expect(await rt.engine.snapshot(target.session.principal, b)).toEqual(
    targetBefore,
  );
  expect(rt.logos.state(source.session, a)).toEqual(stateBefore);
});
it("counts failed companion attempts, rejects duplicate/unknown requests, and cannot select a corrupt import", async () => {
  const { token, session } = await startDemo(),
    org = session.organizations[0].id,
    rt = await runtime(),
    before = await rt.engine.snapshot(session.principal, org);
  const id = randomUUID(),
    bad = Buffer.from("<svg>not a companion</svg>");
  const send = () =>
    POST(
      request(token, org, "POST", bad, {
        kind: "companion",
        revision: "0",
        operationId: id,
      }),
    );
  expect((await send()).status).toBe(422);
  expect((await send()).status).toBe(409);
  expect(
    (
      await POST(
        request(token, org, "POST", bad, {
          kind: "other",
          revision: "0",
          operationId: randomUUID(),
        }),
      )
    ).status,
  ).toBe(400);
  const req = request(token, org, "POST", bad, {
    kind: "companion",
    revision: "0",
    operationId: randomUUID(),
  });
  req.nextUrl.searchParams.append("kind", "companion");
  expect((await POST(req)).status).toBe(400);
  expect(rt.logos.state(session, org)).toMatchObject({
    revision: 0,
    remainingUploads: 11,
    selected: null,
    staged: null,
  });
  expect(await rt.engine.snapshot(session.principal, org)).toEqual(before);
});
