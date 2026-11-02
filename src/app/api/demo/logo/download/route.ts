import { NextRequest, NextResponse } from "next/server";
import { EngineError } from "../../../../../core/engine";
import { logoDownloadSchema } from "../../../../../core/private-logo";
import { logoAccess } from "../../../../../server/demo";
import {
  logoHeaders,
  logoFailure,
  logoRequestAccess,
} from "../../../../../server/logo-request";
import { readJson } from "../../../../../server/request-body";
import { sameOrigin } from "../../../../../server/request-origin";
export const runtime = "nodejs";
/** No GET download, public assets, user filenames, configurable paths or persistent-business attachment. */
export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request, process.env.LMS_APP_ORIGIN))
      throw new EngineError(
        "Use this application's own page to save a private logo.",
        403,
      );
    if ([...request.nextUrl.searchParams].length)
      throw new EngineError("Use the exact reviewed logo download body.", 400);
    const p = logoDownloadSchema.parse(await readJson(request, 4096));
    const { session, logos } = await logoRequestAccess(
      request,
      p.organizationId,
      true,
    );
    const bytes = await logos.saveSelected(
      session,
      p.organizationId,
      p.assetId,
      p.revision,
      p.format,
      async () => {
        await logoAccess(session, p.organizationId, true);
      },
    );
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        ...logoHeaders,
        "Content-Type": p.format === "png" ? "image/png" : "application/zip",
        "Content-Disposition":
          p.format === "png"
            ? 'attachment; filename="lms-sanitized-logo.png"'
            : 'attachment; filename="lms-logo-companion.zip"',
      },
    });
  } catch (error) {
    return logoFailure(error);
  }
}
