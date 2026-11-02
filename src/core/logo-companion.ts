import { z } from "zod";
import { blueprintJson, sha256 } from "./blueprint";
import { logoDisplay, logoLimits } from "./private-logo";
import {
  blueprintText,
  decodeBlueprintText,
  readArchive,
  writeArchive,
} from "./stored-archive";

/** Independent data-only asset; never a BuildPlan, publisher attestation or installation authority. */
export const LOGO_COMPANION_LIMIT = logoLimits.outputBytes + 4096;
const paths = ["manifest.json", "logo.png"] as const;
export class LogoCompanionError extends Error {}
export const logoCompanionSchema = z
  .object({
    format: z.literal("lms-logo-companion"),
    version: z.literal(1),
    display: logoDisplay,
    image: z
      .object({
        path: z.literal("logo.png"),
        format: z.literal("png"),
        width: z.number().int().positive().max(512),
        height: z.number().int().positive().max(512),
        bytes: z.number().int().positive().max(logoLimits.outputBytes),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  })
  .strict();
export type LogoCompanionManifest = z.infer<typeof logoCompanionSchema>;

function pngDimensions(bytes: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || signature.some((n, i) => bytes[i] !== n))
    throw new LogoCompanionError(
      "The companion must contain actual PNG bytes, not a MIME or filename claim.",
    );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452)
    throw new LogoCompanionError("The companion PNG header is invalid.");
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
/** Structural integrity inspection only. The server must independently decode and sanitize before staging. */
export async function inspectLogoCompanion(input: Uint8Array) {
  if (!input.length || input.length > LOGO_COMPANION_LIMIT)
    throw new LogoCompanionError(
      "Choose a nonempty logo companion no larger than 260 KiB.",
    );
  const bytes = new Uint8Array(input); // Immutable snapshot across asynchronous digest work.
  try {
    const files = readArchive(bytes, {
      paths,
      limits: { "manifest.json": 2048, "logo.png": logoLimits.outputBytes },
      bytes: LOGO_COMPANION_LIMIT,
    });
    const text = decodeBlueprintText(files["manifest.json"]);
    const manifest = logoCompanionSchema.parse(JSON.parse(text));
    if (blueprintJson(manifest) !== text)
      throw new LogoCompanionError(
        "Use the unchanged canonical companion manifest; duplicate keys and alternate encodings are unsupported.",
      );
    const image = files["logo.png"],
      dimensions = pngDimensions(image);
    if (
      image.length !== manifest.image.bytes ||
      dimensions.width !== manifest.image.width ||
      dimensions.height !== manifest.image.height ||
      (await sha256(image)) !== manifest.image.sha256
    )
      throw new LogoCompanionError(
        "Logo companion integrity failed: image bytes, dimensions or SHA-256 do not match.",
      );
    return { manifest, image };
  } catch (error) {
    if (error instanceof LogoCompanionError) throw error;
    throw new LogoCompanionError(
      "Invalid logo companion. Use version 1 with exactly manifest.json and logo.png, unchanged checksums, no compression, extra files or paths.",
    );
  }
}
export async function createLogoCompanion(
  image: Uint8Array,
  metadata: { width: number; height: number; display: "square" | "rectangle" },
) {
  if (!image.length || image.length > logoLimits.outputBytes)
    throw new LogoCompanionError(
      "A companion contains one bounded sanitized PNG up to 256 KiB.",
    );
  const snapshot = new Uint8Array(image);
  const manifest = logoCompanionSchema.parse({
    format: "lms-logo-companion",
    version: 1,
    display: metadata.display,
    image: {
      path: "logo.png",
      format: "png",
      width: metadata.width,
      height: metadata.height,
      bytes: snapshot.length,
      sha256: await sha256(snapshot),
    },
  });
  const archive = writeArchive(
    [
      { path: "manifest.json", bytes: blueprintText(blueprintJson(manifest)) },
      { path: "logo.png", bytes: snapshot },
    ],
    LOGO_COMPANION_LIMIT,
  );
  await inspectLogoCompanion(archive);
  return archive;
}
