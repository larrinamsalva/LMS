import { createHash } from "node:crypto";
import { EngineError } from "../core/engine";
import { durableLogoMetadata } from "../core/logo-assets";
import { reserveLogoProcessing } from "./logo-processing";
import { sanitizeLogo } from "./logo-sanitizer";

/** The same pinned decoder and resource gate for stored and associated private PNGs. */
export async function readVerifiedStoredLogo(
  fetch: () => Promise<{ image: Buffer; metadata: unknown }>,
  organizationId: string,
  expected: { id: string; revision?: number; sha256?: string },
) {
  const hash = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
  const release = reserveLogoProcessing();
  let image: Buffer | undefined;
  let clean: Awaited<ReturnType<typeof sanitizeLogo>> | undefined;
  try {
    const row = await fetch();
    image = row.image;
    const metadata = durableLogoMetadata.parse(row.metadata);
    if (
      metadata.organizationId !== organizationId ||
      metadata.id !== expected.id ||
      (expected.revision !== undefined &&
        metadata.revision !== expected.revision) ||
      (expected.sha256 !== undefined && metadata.sha256 !== expected.sha256) ||
      image.length !== metadata.bytes ||
      hash(image) !== metadata.sha256
    )
      throw new EngineError(
        "Stored private logo integrity failed; keep it unavailable for inspection.",
        409,
      );
    clean = await sanitizeLogo(image);
    if (
      clean.width !== metadata.width ||
      clean.height !== metadata.height ||
      clean.bytes.length !== metadata.bytes ||
      hash(clean.bytes) !== metadata.sha256
    )
      throw new EngineError(
        "Stored private logo no longer matches its reviewed sanitizer profile.",
        409,
      );
    // Authorization, lifecycle and configuration may change while native decoding runs.
    const again = await fetch();
    try {
      if (
        JSON.stringify(durableLogoMetadata.parse(again.metadata)) !==
          JSON.stringify(metadata) ||
        again.image.length !== metadata.bytes ||
        hash(again.image) !== metadata.sha256
      )
        throw new EngineError(
          "Private logo changed during inspection; refresh and use the built-in fallback.",
          409,
        );
    } finally {
      again.image.fill(0);
    }
    return { metadata, bytes: new Uint8Array(image) };
  } catch (error) {
    if (error instanceof EngineError && error.status === 422)
      throw new EngineError(
        "Stored private logo cannot be safely decoded; keep it unavailable for inspection.",
        409,
      );
    throw error;
  } finally {
    image?.fill(0);
    clean?.bytes.fill(0);
    release();
  }
}
