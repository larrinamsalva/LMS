import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ConfigurationError } from "../../../core/config";
import { TimeError } from "../../../core/time";
import { EngineError } from "../../../core/engine";
import { sameOrigin } from "../../../server/request-origin";
import { BodyError, readJson } from "../../../server/request-body";
import {
  cookieName,
  findSession,
  requireDemoOrg,
  runtime as demoRuntime,
  startDemo,
  previewBuildPlan,
} from "../../../server/demo";
export const runtime = "nodejs";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
const org = z.uuid();
const rev = z.number().int().min(1);
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }).strict(),
  z
    .object({
      action: z.literal("save-plan"),
      organizationId: org,
      document: z.unknown(),
      id: org,
      revision: z.number().int().min(0).max(19),
      baseRevision: rev,
    })
    .strict(),
  z
    .object({
      action: z.literal("publish-plan"),
      organizationId: org,
      input: z.unknown(),
    })
    .strict(),
  z
    .object({
      action: z.literal("preview-plan"),
      organizationId: org,
      document: z.unknown(),
      operationId: org,
    })
    .strict(),
  z
    .object({
      action: z.literal("save"),
      organizationId: org,
      entity: z.string().max(40),
      data: z.unknown(),
      operationId: org.optional(),
      existing: z.object({ id: org, revision: rev }).strict().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("archive"),
      organizationId: org,
      recordId: org,
      revision: rev,
      archived: z.boolean(),
      operationId: org.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("configure"),
      organizationId: org,
      document: z.unknown(),
      revision: rev,
      restoredFrom: rev.optional(),
    })
    .strict(),
]);
function failure(error: unknown) {
  if (error instanceof EngineError || error instanceof BodyError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status, headers },
    );
  if (error instanceof ConfigurationError || error instanceof TimeError)
    return NextResponse.json(
      { error: error.message },
      { status: 400, headers },
    );
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return NextResponse.json(
      { error: "Check the fields, dates and allowed values." },
      { status: 400, headers },
    );
  return NextResponse.json(
    { error: "The demo is unavailable. Retry or restart the local server." },
    { status: 503, headers },
  );
}
export async function GET(request: NextRequest) {
  try {
    const session = await findSession(request.cookies.get(cookieName)?.value);
    const organizationId = org.parse(
      request.nextUrl.searchParams.get("organizationId") ??
        session.organizations[0].id,
    );
    requireDemoOrg(session, organizationId);
    const { engine } = await demoRuntime();
    if (request.nextUrl.searchParams.get("export") === "1") {
      return NextResponse.json(
        await engine.exportWorkspace(session.principal, organizationId),
        {
          headers: {
            ...headers,
            "Content-Disposition":
              'attachment; filename="lms-demo-workspace.json"',
          },
        },
      );
    }
    return NextResponse.json(
      {
        session: {
          organizations: session.organizations,
          expiresAt: session.expiresAt,
        },
        workspace: await engine.snapshot(session.principal, organizationId),
      },
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request, process.env.LMS_APP_ORIGIN))
      throw new EngineError(
        "Use this application’s own page to make changes.",
        403,
      );
    const input = command.parse(await readJson(request, 65536));
    let session;
    let token: string | undefined;
    if (input.action === "start") {
      try {
        session = await findSession(request.cookies.get(cookieName)?.value);
      } catch (error) {
        if (!(error instanceof EngineError) || error.status !== 401)
          throw error;
      }
      if (!session) {
        const created = await startDemo();
        session = created.session;
        token = created.token;
      }
    } else session = await findSession(request.cookies.get(cookieName)?.value);
    const organizationId =
      input.action === "start"
        ? session.organizations[0].id
        : input.organizationId;
    requireDemoOrg(session, organizationId);
    const { engine } = await demoRuntime();
    let previewOrganizationId: string | undefined;
    if (input.action === "save-plan")
      await engine.saveBuildPlan(
        session.principal,
        organizationId,
        input.document,
        input.id,
        input.revision,
        input.baseRevision,
      );
    if (input.action === "publish-plan")
      await engine.publishBuildPlan(
        session.principal,
        organizationId,
        input.input,
      );
    if (input.action === "preview-plan")
      previewOrganizationId = (
        await previewBuildPlan(
          session,
          organizationId,
          input.document,
          input.operationId,
        )
      ).id;
    if (input.action === "save")
      await engine.saveRecord(
        session.principal,
        organizationId,
        input.entity,
        input.data,
        input.existing,
        input.operationId,
      );
    if (input.action === "archive")
      await engine.archiveRecord(
        session.principal,
        organizationId,
        input.recordId,
        input.revision,
        input.archived,
        input.operationId,
      );
    if (input.action === "configure")
      await engine.publishConfig(
        session.principal,
        organizationId,
        input.document,
        input.revision,
        input.restoredFrom,
      );
    const response = NextResponse.json(
      {
        ...(previewOrganizationId ? { previewOrganizationId } : {}),
        session: {
          organizations: session.organizations,
          expiresAt: session.expiresAt,
        },
        workspace: await engine.snapshot(session.principal, organizationId),
      },
      { headers },
    );
    if (token)
      response.cookies.set(cookieName, token, {
        httpOnly: true,
        sameSite: "strict",
        secure: new URL(request.url).protocol === "https:",
        path: "/",
        maxAge: 7200,
      });
    return response;
  } catch (error) {
    return failure(error);
  }
}
