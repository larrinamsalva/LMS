import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { EngineError } from "../core/engine";
import { cookieName, findSession, logoAccess } from "./demo";
import { BodyError } from "./request-body";
export const logoHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  Vary: "Cookie",
};
export function logoFailure(error: unknown) {
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
      headers: logoHeaders,
    },
  );
}
export async function logoRequestAccess(
  request: NextRequest,
  organizationId: string,
  manage = false,
) {
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new EngineError("Use this application's own private logo view.", 403);
  const session = await findSession(request.cookies.get(cookieName)?.value);
  return { session, ...(await logoAccess(session, organizationId, manage)) };
}
