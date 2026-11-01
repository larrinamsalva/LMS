import { randomBytes, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { Engine, EngineError, type Principal } from "../core/engine";
import { seedInventory } from "../presets/inventory-samples";
import { seedPricing } from "../presets/pricing-samples";
import { seedSchedule } from "../presets/schedule-samples";
import { presets, sampleRecords } from "../presets";
import { validateBuildPlan } from "../core/buildplan";
import { createDatabase, sqlDatabase } from "./database";
export interface DemoOrganization {
  id: string;
  industry: "property" | "cleaning" | "custom";
  name?: string;
  preview?: boolean;
}
export interface DemoSession {
  principal: Principal;
  organizations: DemoOrganization[];
  previews: Map<string, { request: string; result: Promise<DemoOrganization> }>;
  expiresAt: number;
}
type Runtime = {
  db: PGlite;
  engine: Engine;
  sessions: Map<string, DemoSession>;
  creating: number;
};
const host = globalThis as typeof globalThis & { lmsDemo?: Promise<Runtime> };
const lifetime = 2 * 60 * 60 * 1000;
export const cookieName = "lms_demo";
export async function runtime() {
  host.lmsDemo ??= createDatabase().then((db) => ({
    db,
    engine: new Engine(sqlDatabase(db)),
    sessions: new Map(),
    creating: 0,
  }));
  return host.lmsDemo;
}
async function removeExpired(rt: Runtime) {
  for (const [token, session] of rt.sessions)
    if (session.expiresAt < Date.now()) {
      rt.sessions.delete(token);
      await rt.db.transaction(async (tx) => {
        for (const org of session.organizations)
          await tx.query("delete from lms.organizations where id=$1", [org.id]);
        await tx.query("delete from lms.users where id=$1", [
          session.principal.userId,
        ]);
      });
    }
}
export async function startDemo() {
  const rt = await runtime();
  await removeExpired(rt);
  // Reserve synchronously before any awaits; bounded global demo memory, no permanent sign-ups.
  if (rt.sessions.size + rt.creating >= 24)
    throw new EngineError(
      "Demo capacity reached. Try again after an existing session expires.",
      503,
    );
  rt.creating++;
  try {
    const principal = { userId: randomUUID() };
    const organizations = (["property", "cleaning"] as const).map(
      (industry) => ({ id: randomUUID(), industry }),
    );
    await rt.db.transaction(async (tx) => {
      await tx.query("select set_config('lms.user_id',$1,true)", [
        principal.userId,
      ]);
      await tx.query(
        "insert into lms.users values($1,'Fictional demo owner')",
        [principal.userId],
      );
      for (const org of organizations) {
        await tx.query("insert into lms.organizations values($1,$2)", [
          org.id,
          presets[org.industry].name,
        ]);
        await tx.query("insert into lms.memberships values($1,$2,'owner')", [
          org.id,
          principal.userId,
        ]);
        await tx.query(
          "insert into lms.config_revisions(organization_id,revision,document,created_by) values($1,1,$2,$3)",
          [org.id, presets[org.industry], principal.userId],
        );
      }
    });
    try {
      for (const org of organizations) {
        for (const record of sampleRecords[org.industry])
          await rt.engine.saveRecord(
            principal,
            org.id,
            record.entity,
            record.data,
          );
        await seedSchedule(rt.engine, principal, org.id);
        await seedPricing(rt.engine, principal, org.id);
        await seedInventory(rt.engine, principal, org.id);
      }
    } catch (error) {
      for (const org of organizations)
        await rt.db.query("delete from lms.organizations where id=$1", [
          org.id,
        ]);
      await rt.db.query("delete from lms.users where id=$1", [
        principal.userId,
      ]);
      throw error;
    }
    const token = randomBytes(32).toString("hex");
    const session = {
      principal,
      organizations,
      previews: new Map(),
      expiresAt: Date.now() + lifetime,
    };
    rt.sessions.set(token, session);
    return { token, session };
  } finally {
    rt.creating--;
  }
}
export async function findSession(token: string | undefined) {
  const rt = await runtime();
  const session = token ? rt.sessions.get(token) : undefined;
  if (!session || session.expiresAt < Date.now())
    throw new EngineError(
      "Your fictional demo session ended. Start a new demo to continue.",
      401,
    );
  return session;
}
export function requireDemoOrg(session: DemoSession, org: string) {
  if (!session.organizations.some((o) => o.id === org))
    throw new EngineError("Demo workspace unavailable.", 403);
}

/** Demo-only provisioning. It always uses the private, in-memory runtime, never a configured PostgreSQL URL. */
export async function previewBuildPlan(
  session: DemoSession,
  sourceOrganization: string,
  input: unknown,
  operationId: string,
) {
  requireDemoOrg(session, sourceOrganization);
  const plan = validateBuildPlan(input),
    request = JSON.stringify({ sourceOrganization, plan });
  const previous = session.previews.get(operationId);
  if (previous) {
    if (previous.request !== request)
      throw new EngineError(
        "This preview operation belongs to different choices.",
        409,
      );
    return previous.result;
  }
  if (session.previews.size >= 3)
    throw new EngineError(
      "This temporary session supports three fresh previews. Reopen an existing preview or start again after the session ends.",
      409,
    );
  const result = (async () => {
    const rt = await runtime();
    const source = await rt.engine.snapshot(
      session.principal,
      sourceOrganization,
    );
    if (!["owner", "admin"].includes(source.role))
      throw new EngineError("Only owners/admins can create previews.", 403);
    const org: DemoOrganization = {
      id: randomUUID(),
      industry: plan.template,
      name: plan.configuration.name,
      preview: true,
    };
    await rt.db.transaction(async (tx) => {
      await tx.query("select set_config('lms.user_id',$1,true)", [
        session.principal.userId,
      ]);
      await tx.query("insert into lms.organizations values($1,$2)", [
        org.id,
        plan.configuration.name,
      ]);
      await tx.query("insert into lms.memberships values($1,$2,'owner')", [
        org.id,
        session.principal.userId,
      ]);
      await tx.query(
        "insert into lms.config_revisions(organization_id,revision,document,created_by)values($1,1,$2,$3)",
        [org.id, plan.configuration, session.principal.userId],
      );
    });
    session.organizations.push(org);
    return org;
  })();
  session.previews.set(operationId, { request, result });
  try {
    return await result;
  } catch (error) {
    session.previews.delete(operationId);
    throw error;
  }
}
