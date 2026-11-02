import { reservationFixture } from "../helpers/equipment-reservations";
import { afterAll, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../../src/app/api/demo/route";
import { runtime, startDemo, findSession } from "../../src/server/demo";
import { selectModules } from "../../src/core/buildplan";
import {
  equipmentFixture,
  releaseEquipment,
  checkoutEquipment,
} from "../helpers/equipment";
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
        action: "equipment",
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
it("keeps the real fictional HTTP workflow scoped, explicitly confirmed, revision-bound and idempotent", async () => {
  const a = await startDemo(),
    b = await startDemo(),
    rt = await runtime(),
    org = a.session.organizations[0].id,
    initial = await rt.engine.snapshot(a.session.principal, org);
  await rt.engine.publishConfig(
    a.session.principal,
    org,
    selectModules(initial.config.document, [
      ...initial.config.document.modules.map((m) => m.id),
      "equipment",
    ]),
    1,
  );
  const f = await equipmentFixture(rt.engine, a.session.principal, org),
    ready = await releaseEquipment(
      rt.engine,
      a.session.principal,
      org,
      f.equipment,
      f.employee,
    ),
    req = checkoutEquipment(ready, f.employee),
    op = randomUUID(),
    peer = await rt.engine.snapshot(
      b.session.principal,
      b.session.organizations[0].id,
    );
  expect((await request(undefined, org, req)).status).toBe(401);
  expect((await request(b.token, org, req)).status).toBe(403);
  expect(
    (await request(a.token, org, req, op, "https://untrusted.example.test"))
      .status,
  ).toBe(403);
  expect(
    (await request(a.token, org, { ...req, acknowledgement: "ASSIGN" })).status,
  ).toBe(400);
  expect((await request(a.token, org, req, op)).status).toBe(200);
  expect((await request(a.token, org, req, op)).status).toBe(200);
  expect(
    (
      await request(
        a.token,
        org,
        { ...req, notes: "Conflicting fictional request" },
        op,
      )
    ).status,
  ).toBe(409);
  expect(
    (await rt.engine.snapshot(a.session.principal, org)).equipmentCheckouts,
  ).toHaveLength(1);
  expect(
    await rt.engine.snapshot(
      b.session.principal,
      b.session.organizations[0].id,
    ),
  ).toEqual(peer);
  const admin = randomUUID();
  await rt.db.query(
    "insert into lms.users values($1,'Fictional equipment admin')",
    [admin],
  );
  await rt.db.query("insert into lms.memberships values($1,$2,'viewer')", [
    org,
    admin,
  ]);
  const original = a.session.principal;
  a.session.principal = { userId: admin };
  expect((await request(a.token, org, req, op)).status).toBe(403);
  a.session.principal = original;
});
it("expires access and cleans temporary logo custody without deleting protected equipment history to reset capacity", async () => {
  const a = await startDemo(),
    rt = await runtime(),
    org = a.session.organizations[0].id,
    s = await rt.engine.snapshot(a.session.principal, org);
  await rt.engine.publishConfig(
    a.session.principal,
    org,
    selectModules(s.config.document, [
      ...s.config.document.modules.map((m) => m.id),
      "equipment",
    ]),
    1,
  );
  const f = await equipmentFixture(rt.engine, a.session.principal, org),
    before = await rt.engine.exportWorkspace(a.session.principal, org),
    count = rt.sessions.size;
  a.session.expiresAt = Date.now() - 1;
  expect(
    (await request(a.token, org, checkoutEquipment(f.equipment, f.employee)))
      .status,
  ).toBe(401);
  await startDemo();
  expect(rt.sessions.size).toBe(count + 1);
  expect(rt.sessions.get(a.token)).toBe(a.session);
  await expect(findSession(a.token)).rejects.toMatchObject({ status: 401 });
  expect(await rt.engine.exportWorkspace(a.session.principal, org)).toEqual({
    ...before,
    exportedAt: expect.any(String),
  });
});

it("keeps the mapping HTTP action session-bound, owner-authorized and unavailable after expiry", async () => {
  const started = await startDemo(),
    peer = await startDemo(),
    rt = await runtime(),
    org = started.session.organizations[0].id;
  const f = await reservationFixture(rt.engine, started.session.principal, org);
  const req = { ...f.request, kind: "unmap", mappingRevision: 1 },
    op = randomUUID();
  const send = (
    token: string | undefined,
    organizationId = org,
    origin = base,
  ) =>
    POST(
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
          action: "equipment-mapping",
          organizationId,
          input: req,
          operationId: op,
        }),
      }),
    );
  expect((await send(undefined)).status).toBe(401);
  expect((await send(peer.token)).status).toBe(403);
  expect(
    (await send(started.token, org, "https://untrusted.example.test")).status,
  ).toBe(403);
  const first = await send(started.token);
  expect(first.status).toBe(200);
  expect((await first.json()).workspace.equipmentMappingHistory).toHaveLength(
    2,
  );
  expect((await send(started.token)).status).toBe(200);
  started.session.expiresAt = Date.now() - 1;
  expect((await send(started.token)).status).toBe(401);
  expect(
    (await rt.engine.snapshot(started.session.principal, org))
      .equipmentMappingHistory,
  ).toHaveLength(2);
});
it("commits coordinated resources only through the authorized temporary session and keeps expiry/replay scoped", async () => {
  const started = await startDemo(),
    peer = await startDemo(),
    rt = await runtime(),
    org = started.session.organizations[0].id;
  const { coordinatedFixture } = await import(
    "../helpers/coordinated-scheduling"
  );
  const f = await coordinatedFixture(rt.engine, started.session.principal, org),
    op = randomUUID();
  const send = (token: string | undefined, origin = base) =>
    POST(
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
          action: "save",
          organizationId: org,
          entity: "appointments",
          data: f.data,
          resources: f.resources,
          operationId: op,
        }),
      }),
    );
  expect((await send(undefined)).status).toBe(401);
  expect((await send(peer.token)).status).toBe(403);
  expect(
    (await send(started.token, "https://untrusted.example.test")).status,
  ).toBe(403);
  const saved = await send(started.token);
  expect(saved.status).toBe(200);
  const body = await saved.json();
  expect(
    body.workspace.appointmentAllocations.filter(
      (a: { slot: string; present: boolean }) =>
        a.slot === "Equipment" && a.present,
    ),
  ).toHaveLength(1);
  expect((await send(started.token)).status).toBe(200);
  expect(
    (
      await rt.engine.snapshot(started.session.principal, org)
    ).appointmentAllocationHistory.filter((a) => a.origin === "Reviewed"),
  ).toHaveLength(2);
  started.session.expiresAt = Date.now() - 1;
  expect((await send(started.token)).status).toBe(401);
});
