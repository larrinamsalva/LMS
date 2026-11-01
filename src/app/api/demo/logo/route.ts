import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { EngineError } from "../../../../core/engine";
import { logoCommandSchema, logoLimits } from "../../../../core/private-logo";
import { cookieName, findSession, logoAccess } from "../../../../server/demo";
import {
  BodyError,
  readBytes,
  readJson,
} from "../../../../server/request-body";
import { sameOrigin } from "../../../../server/request-origin";
export const runtime = "nodejs";
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  Vary: "Cookie",
};
function parameters(request: NextRequest, upload = false) {
  const pairs = [...request.nextUrl.searchParams.entries()];
  if (new Set(pairs.map((p) => p[0])).size !== pairs.length)
    throw new EngineError("Use one exact private-logo request.", 400);
  const schema = upload
    ? z
        .object({
          organizationId: z.uuid(),
          revision: z.string().regex(/^\d{1,3}$/),
          operationId: z.uuid(),
        })
        .strict()
    : z
        .object({ organizationId: z.uuid(), assetId: z.uuid().optional() })
        .strict();
  return schema.parse(Object.fromEntries(pairs));
}
function failure(error: unknown) {
  const known = error instanceof EngineError || error instanceof BodyError;
  return NextResponse.json(
    {
      error: known
        ? error.message
        : "Private logo request refused. Check the image, current revision and fictional session.",
    },
    {
      status: known
        ? error.status
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 503,
      headers,
    },
  );
}
async function access(
  request: NextRequest,
  organizationId: string,
  manage = false,
) {
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new EngineError("Use this application's own private logo view.", 403);
  const session = await findSession(request.cookies.get(cookieName)?.value);
  return { session, ...(await logoAccess(session, organizationId, manage)) };
}
export async function GET(request: NextRequest) {
  try {
    const p = parameters(request) as {
        organizationId: string;
        assetId?: string;
      },
      { session, logos, canManage } = await access(request, p.organizationId);
    if (p.assetId)
      return new NextResponse(
        new Uint8Array(
          logos.image(session, p.organizationId, p.assetId, canManage),
        ),
        {
          headers: {
            ...headers,
            "Content-Type": "image/png",
            "Content-Disposition": 'inline; filename="session-logo.png"',
          },
        },
      );
    const state = logos.state(session, p.organizationId);
    return NextResponse.json(
      canManage ? state : { ...state, staged: null, remainingUploads: 0 },
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
        "Use this application's own page to stage a logo.",
        403,
      );
    const p = parameters(request, true) as {
        organizationId: string;
        revision: string;
        operationId: string;
      },
      { session, logos } = await access(request, p.organizationId, true);
    if (request.headers.get("content-type") !== "application/octet-stream")
      throw new BodyError(
        "Send a bounded raw image, not multipart, URLs or executable content.",
        415,
      );
    const bytes = await readBytes(request, logoLimits.inputBytes);
    return NextResponse.json(
      await logos.stage(
        session,
        p.organizationId,
        bytes,
        Number(p.revision),
        p.operationId,
        async () => {
          await logoAccess(session, p.organizationId, true);
        },
      ),
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function PATCH(request: NextRequest) {
  try {
    if (!sameOrigin(request, process.env.LMS_APP_ORIGIN))
      throw new EngineError(
        "Use this application's own page to change a private logo.",
        403,
      );
    const p = parameters(request) as {
      organizationId: string;
      assetId?: string;
    };
    if (p.assetId)
      throw new EngineError("Use the reviewed logo action body.", 400);
    const { session, logos } = await access(request, p.organizationId, true),
      command = logoCommandSchema.parse(await readJson(request, 4096));
    return NextResponse.json(
      logos.command(session, p.organizationId, command),
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}
