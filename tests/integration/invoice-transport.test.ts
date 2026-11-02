import { afterAll, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../../src/app/api/demo/route";
import { runtime, startDemo } from "../../src/server/demo";
import { selectModules } from "../../src/core/buildplan";
import { reviewedEstimate, conversion } from "../helpers/invoices";
import { randomUUID } from "node:crypto";
const base = "http://localhost:3000";
function request(
  token: string | undefined,
  organizationId: string,
  input: unknown,
  operationId = randomUUID(),
  origin = base,
) {
  return POST(
    new NextRequest(base + "/api/demo", {
      method: "POST",
      headers: {
        origin,
        host: "localhost:3000",
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        ...(token ? { cookie: "lms_demo=" + token } : {}),
      },
      body: JSON.stringify({
        action: "invoice-draft",
        organizationId,
        input,
        operationId,
      }),
    }),
  );
}
afterAll(async () => {
  const rt = await runtime();
  rt.logos.close();
  await rt.db.close();
  delete (globalThis as typeof globalThis & { lmsDemo?: unknown }).lmsDemo;
});
it("keeps invoice actions inside the bounded fictional session, current role and explicit opt-in without altering another organization", async () => {
  const a = await startDemo(),
    b = await startDemo(),
    rt = await runtime(),
    org = a.session.organizations[0].id;
  const old = await rt.engine.snapshot(a.session.principal, org);
  const config = selectModules(old.config.document, [
    ...old.config.document.modules.map((m) => m.id),
    "invoice-drafts",
  ]);
  await rt.engine.publishConfig(
    a.session.principal,
    org,
    config,
    old.config.revision,
  );
  const c = await reviewedEstimate(rt.engine, a.session.principal, org),
    req = conversion(c.estimate, 2),
    op = randomUUID();
  const other = await rt.engine.snapshot(
    b.session.principal,
    b.session.organizations[0].id,
  );
  expect((await request(undefined, org, req)).status).toBe(401);
  expect((await request(b.token, org, req)).status).toBe(403);
  expect(
    (
      await request(
        a.token,
        org,
        req,
        randomUUID(),
        "https://untrusted.example.test",
      )
    ).status,
  ).toBe(403);
  expect(
    (await request(a.token, org, { ...req, acknowledgement: "SEND" })).status,
  ).toBe(400);
  const created = await request(a.token, org, req, op);
  expect(created.status).toBe(200);
  expect((await request(a.token, org, req, op)).status).toBe(200);
  const current = await rt.engine.snapshot(a.session.principal, org);
  expect(current.invoiceVersions).toHaveLength(1);
  expect(current.config.document).toEqual(config);
  expect(
    await rt.engine.snapshot(
      b.session.principal,
      b.session.organizations[0].id,
    ),
  ).toEqual(other);
  a.session.expiresAt = Date.now() - 1;
  expect((await request(a.token, org, req, op)).status).toBe(401);
});
