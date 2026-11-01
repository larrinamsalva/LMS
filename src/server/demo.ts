import { randomBytes, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { Engine, EngineError, type Principal } from "../core/engine";
import { seedInventory } from "../presets/inventory-samples";
import { seedPricing } from "../presets/pricing-samples";
import { seedSchedule } from "../presets/schedule-samples";
import { presets, sampleRecords } from "../presets";
import { blueprintJson } from "../core/blueprint";
import {
  rehearsalInput,
  type RehearsalResult,
  type RehearsalInput,
} from "../core/rehearsal";
import { runFictionalChecks } from "./rehearsal";
import { validateBuildPlan, type BuildPlan } from "../core/buildplan";
import { createDatabase, sqlDatabase } from "./database";
import { LogoVault } from "./logo-vault";
export interface DemoOrganization {
  id: string;
  industry: "property" | "cleaning" | "custom";
  name?: string;
  preview?: boolean;
  rehearsal?: boolean;
}
interface RetainedRehearsal {
  result: RehearsalResult;
  workspaceState?: { stateDigest: string; proposalDigest: string };
}
export interface DemoSession {
  principal: Principal;
  organizations: DemoOrganization[];
  previews: Map<string, { request: string; result: Promise<DemoOrganization> }>;
  rehearsals: Map<
    string,
    {
      request: string;
      result: Promise<{
        result: RehearsalResult;
        workspaceState?: { stateDigest: string; proposalDigest: string };
      }>;
    }
  >;
  rehearsalOrganizations: Set<string>;
  expiresAt: number;
}
type Runtime = {
  db: PGlite;
  engine: Engine;
  sessions: Map<string, DemoSession>;
  creating: number;
  logos: LogoVault;
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
    logos: new LogoVault(),
  }));
  return host.lmsDemo;
}
async function removeExpired(rt: Runtime) {
  for (const [token, session] of rt.sessions)
    if (session.expiresAt < Date.now()) {
      await rt.db.transaction(async (tx) => {
        for (const id of new Set([
          ...session.organizations.map((o) => o.id),
          ...session.rehearsalOrganizations,
        ]))
          await tx.query("delete from lms.organizations where id=$1", [id]);
        await tx.query("delete from lms.users where id=$1", [
          session.principal.userId,
        ]);
      });
      rt.sessions.delete(token);
      rt.logos.drop(session);
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
      rehearsals: new Map(),
      rehearsalOrganizations: new Set<string>(),
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
  rt.logos.sweep();
  const session = token ? rt.sessions.get(token) : undefined;
  if (!session || session.expiresAt < Date.now())
    throw new EngineError(
      "Your fictional demo session ended. Start a new demo to continue.",
      401,
    );
  return session;
}
/** Reuses the actual demo session and Engine's organization membership/role observation. Never connects to persistent PostgreSQL. */
export async function logoAccess(
  session: DemoSession,
  organizationId: string,
  manage = false,
) {
  const rt = await runtime();
  if (
    session.expiresAt <= Date.now() ||
    ![...rt.sessions.values()].includes(session)
  )
    throw new EngineError("The fictional logo session ended.", 401);
  requireDemoOrg(session, organizationId);
  const snapshot = await rt.engine.snapshot(session.principal, organizationId),
    canManage = ["owner", "admin"].includes(snapshot.role);
  if (manage && !canManage)
    throw new EngineError(
      "Only owners/admins can manage private session logos.",
      403,
    );
  return { logos: rt.logos, canManage };
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
  if (session.previews.size + session.rehearsals.size >= 3)
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
    const org = await createPreviewOrganization(session, plan);
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

async function createPreviewOrganization(
  session: DemoSession,
  plan: BuildPlan,
  rehearsal = false,
) {
  const rt = await runtime();
  const org: DemoOrganization = {
    id: randomUUID(),
    industry: plan.template,
    name: plan.configuration.name,
    preview: true,
    ...(rehearsal ? { rehearsal: true } : {}),
  };
  if (rehearsal) session.rehearsalOrganizations.add(org.id);
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

  return org;
}

/** No persistent adapter or caller-supplied target is accepted. Cases and slots are private to this temporary session. */
export async function rehearseBuildPlan(
  session: DemoSession,
  sourceOrganization: string,
  input: unknown,
): Promise<RehearsalResult> {
  requireDemoOrg(session, sourceOrganization);
  if (session.expiresAt < Date.now())
    throw new EngineError("The fictional demo session ended.", 401);
  if (session.organizations.find((o) => o.id === sourceOrganization)?.preview)
    throw new EngineError(
      "Return to the original business workspace to start a rehearsal.",
      409,
    );
  const request = rehearsalInput.parse(input),
    rt = await runtime();
  const checked = await rt.engine.reviewBuildPlanImpact(
    session.principal,
    sourceOrganization,
    requestForReview(request),
  );
  if (checked.overall === "blocked")
    throw new EngineError(
      "This proposal has a blocked project identity. Revise it before rehearsal.",
      409,
    );
  const key = blueprintJson({ sourceOrganization, ...request });
  let entry = session.rehearsals.get(request.operationId);
  if (entry && entry.request !== key)
    throw new EngineError(
      "This rehearsal operation belongs to different choices or versions. Refresh and start a new rehearsal.",
      409,
    );
  if (!entry) {
    if (session.previews.size + session.rehearsals.size >= 3)
      throw new EngineError(
        "This temporary session supports three fresh previews or rehearsals in total. Reuse a retained result or export your choices before expiry.",
        409,
      );
    const result = (async (): Promise<RetainedRehearsal> => {
      let org: DemoOrganization | undefined;
      const failed: RehearsalResult = {
        version: 1,
        status: "failed",
        outcomes: [
          { id: "configuration", status: "failed" },
          { id: "fields", status: "not-run" },
          { id: "relationships", status: "not-run" },
          { id: "scheduling", status: "not-run" },
          { id: "inventory", status: "not-run" },
          { id: "estimates", status: "not-run" },
        ],
      };
      async function discard() {
        if (!org) return;
        await rt.db.query("delete from lms.organizations where id=$1", [
          org.id,
        ]);
        session.rehearsalOrganizations.delete(org.id);
      }
      try {
        org = await createPreviewOrganization(session, checked.proposed, true);
        const outcomes = await runFictionalChecks(
          rt.engine,
          session.principal,
          org.id,
          checked.proposed,
        );
        if (outcomes.status === "failed") {
          await discard();
          return { result: { version: 1, ...outcomes } };
        }
        await rt.engine.reviewBuildPlanImpact(
          session.principal,
          sourceOrganization,
          requestForReview(request),
        );
        const workspace = await rt.engine.reviewBuildPlanImpact(
          session.principal,
          org.id,
          { document: checked.proposed },
        );
        session.organizations.push(org);
        return {
          result: {
            version: 1,
            ...outcomes,
            workspace: { organizationId: org.id },
          },
          workspaceState: workspace.state,
        };
      } catch {
        try {
          await discard();
        } catch {
          throw new EngineError(
            "The isolated fictional rehearsal could not be retired. It remains private and reserved for expiry cleanup; no source data was changed.",
            503,
          );
        }
        return { result: failed };
      }
    })();
    entry = { request: key, result };
    session.rehearsals.set(request.operationId, entry);
  }
  const retained = await entry.result;
  await rt.engine.reviewBuildPlanImpact(
    session.principal,
    sourceOrganization,
    requestForReview(request),
  );
  if (retained.result.workspace && retained.workspaceState) {
    requireDemoOrg(session, retained.result.workspace.organizationId);
    try {
      await rt.engine.reviewBuildPlanImpact(
        session.principal,
        retained.result.workspace.organizationId,
        { document: checked.proposed, expected: retained.workspaceState },
      );
    } catch {
      throw new EngineError(
        "The fictional rehearsal workspace changed after its checks. Those outcomes are historical; start a new rehearsal explicitly before downloading a current report.",
        409,
      );
    }
  }
  return structuredClone(retained.result);
}
function requestForReview(request: RehearsalInput) {
  return {
    document: request.document,
    draft: request.draft,
    expected: request.expected,
  };
}
