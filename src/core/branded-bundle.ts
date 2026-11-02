import { z } from "zod";
import {
  blueprintJson,
  importBlueprintPackage,
  sha256,
  type BlueprintPackage,
} from "./blueprint";
import { BLUEPRINT_PACKAGE_LIMIT } from "./blueprint-archive";
import {
  inspectLogoCompanion,
  LOGO_COMPANION_LIMIT,
  type LogoCompanionManifest,
} from "./logo-companion";
import { logoDisplay } from "./private-logo";
import {
  blueprintText,
  decodeBlueprintText,
  readArchive,
  writeArchive,
} from "./stored-archive";

/** New outer envelope ONLY. Nested legacy protocols and exact component bytes never change. */
export const BRANDED_BUNDLE_LIMIT = 384 * 1024;
const basePaths = ["manifest.json", "blueprint.zip", "README.txt"] as const;
const logoPaths = [...basePaths, "logo-companion.zip"] as const;
const limits = {
  "manifest.json": 4096,
  "blueprint.zip": BLUEPRINT_PACKAGE_LIMIT,
  "README.txt": 8192,
  "logo-companion.zip": LOGO_COMPANION_LIMIT,
};
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const file = <P extends string>(path: P, max: number) =>
  z
    .object({
      path: z.literal(path),
      bytes: z.number().int().min(1).max(max),
      sha256: digest,
    })
    .strict();
export const brandedBundleManifest = z
  .object({
    format: z.literal("lms-branded-blueprint-bundle"),
    version: z.literal(1),
    compatibility: z
      .object({
        engineApi: z.literal(1),
        template: z.literal(1),
        blueprintPackage: z.union([z.literal(1), z.literal(2)]),
        buildPlan: z.union([z.literal(1), z.literal(2)]),
        configurationSchema: z.union([z.literal(1), z.literal(2)]),
        logoCompanion: z.literal(1).nullable(),
      })
      .strict(),
    blueprint: file("blueprint.zip", BLUEPRINT_PACKAGE_LIMIT),
    logo: file("logo-companion.zip", LOGO_COMPANION_LIMIT)
      .extend({ display: logoDisplay })
      .strict()
      .nullable(),
    summary: file("README.txt", 8192),
  })
  .strict();
export type BrandedBundleManifest = z.infer<typeof brandedBundleManifest>;
export class BrandedBundleError extends Error {}
export interface BrandedBundle {
  manifest: BrandedBundleManifest;
  blueprint: BlueprintPackage;
  blueprintBytes: Uint8Array<ArrayBuffer>;
  logo: LogoCompanionManifest | null;
  logoBytes: Uint8Array<ArrayBuffer> | null;
  summary: string;
}
function compatibility(
  blueprint: BlueprintPackage,
  logo: LogoCompanionManifest | null,
) {
  return {
    engineApi: 1 as const,
    template: 1 as const,
    blueprintPackage: blueprint.manifest.version,
    buildPlan: blueprint.plan.version,
    configurationSchema: blueprint.plan.configuration.schemaVersion,
    logoCompanion: logo ? (1 as const) : null,
  };
}
export function brandedBundleSummary(
  blueprint: BlueprintPackage,
  logo: LogoCompanionManifest | null,
) {
  const p = blueprint.plan,
    c = p.configuration;
  return [
    "LMS BRANDED BLUEPRINT BUNDLE 1 - FICTIONAL CONFIGURATION AND OPTIONAL IMAGE",
    `Blueprint: ${blueprint.manifest.blueprint.name}`,
    `Business: ${c.name}`,
    `Business type: ${p.template}`,
    `Blueprint Package ${blueprint.manifest.version} / BuildPlan ${p.version} / Configuration schema ${c.schemaVersion} / Engine API 1 / Template 1`,
    `Modules: ${c.modules.map((m) => `${m.id}@${m.version}`).join(", ")}`,
    `Palette: ${c.branding?.palette ?? "industry default (legacy unbranded plan)"}`,
    `Appearance: ${c.branding?.appearance ?? "LMS default"}`,
    logo
      ? `Optional Logo Companion 1: PNG ${logo.image.width} x ${logo.image.height}, ${logo.image.bytes} bytes, contained ${logo.display}`
      : "No image companion included; use the built-in mark.",
    "",
    "REVIEW AND SAFE REUSE",
    "1. Import Branded Blueprint Bundle in BuildPlan Studio; inspect exact component integrity, versions, modules and dependencies.",
    "2. Accept the BuildPlan only as unsaved Studio choices. Saving and publication remain separate existing reviewed operations.",
    "3. Independently approve sanitizing/staging the companion through the original private demo image pipeline; inspect sanitized light/dark samples.",
    "4. Explicitly select the staged logo for this authorized temporary session. Nothing is automatically selected, published or durably associated.",
    "5. Actual Engine previews are isolated organizations with built-in identity; no private image is implicitly copied into them.",
    "",
    "TRUST AND COMPATIBILITY",
    "SHA-256/ZIP integrity is not publisher authenticity or image safety. Bundle and image publisher authenticity are UNVERIFIED.",
    "A separately verified detached attestation 1 can authenticate ONLY the exact nested Blueprint ZIP, not the logo or complete bundle.",
    "Blueprint ZIP 1/2 and Logo Companion 1 bytes are unchanged. No configuration upgrade or downgrade is performed.",
    "No records, credentials, installation-local asset references, executable code, SQL, remote resources, transfer authorization or recovery activation are included.",
    "Use fictional text and images only. Keep this device file private; demo custody expires independently.",
    "Durable destination mappings, image-bearing signatures, trusted publisher enrollment and portable image publication require separate review.",
    "MIT licensing and ForgeOS attribution remain in the LMS repository.",
    "",
  ].join("\n");
}
function unpack(bytes: Uint8Array) {
  // Choose one of TWO closed profiles from the bounded end record; never trust manifest paths.
  if (bytes.length < 22)
    throw new BrandedBundleError("Invalid branded bundle archive.");
  const count = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint16(bytes.length - 12, true);
  if (count !== 3 && count !== 4)
    throw new BrandedBundleError(
      "A branded bundle contains exactly three files, or four with its optional logo companion.",
    );
  return readArchive(bytes, {
    paths: count === 4 ? logoPaths : basePaths,
    limits,
    bytes: BRANDED_BUNDLE_LIMIT,
  });
}
/** Integrity/compatibility inspection only. NO raw image preview, sanitization, stage, selection or authorization. */
export async function inspectBrandedBlueprintBundle(
  input: Uint8Array,
): Promise<BrandedBundle> {
  if (!input.length || input.length > BRANDED_BUNDLE_LIMIT)
    throw new BrandedBundleError(
      "Choose a nonempty branded bundle no larger than 384 KiB.",
    );
  const bytes = new Uint8Array(input);
  try {
    const files = unpack(bytes),
      text = decodeBlueprintText(files["manifest.json"]),
      manifest = brandedBundleManifest.parse(JSON.parse(text));
    if (blueprintJson(manifest) !== text)
      throw new BrandedBundleError(
        "Bundle manifest must use exact canonical JSON, without duplicate keys or alternate encodings.",
      );
    if (Boolean(manifest.logo) !== Object.hasOwn(files, "logo-companion.zip"))
      throw new BrandedBundleError(
        "Bundle image declaration does not match its exact files.",
      );
    for (const f of [
      manifest.blueprint,
      manifest.summary,
      ...(manifest.logo ? [manifest.logo] : []),
    ]) {
      if (
        files[f.path].length !== f.bytes ||
        (await sha256(files[f.path])) !== f.sha256
      )
        throw new BrandedBundleError(
          `Bundle integrity failed for ${f.path}; exact component bytes do not match.`,
        );
    }
    const blueprint = await importBlueprintPackage(files["blueprint.zip"]);
    let logo: LogoCompanionManifest | null = null;
    if (manifest.logo) {
      const inspected = await inspectLogoCompanion(files["logo-companion.zip"]);
      logo = inspected.manifest;
      inspected.image.fill(0);
    }
    if (
      blueprintJson(manifest.compatibility) !==
        blueprintJson(compatibility(blueprint, logo)) ||
      manifest.logo?.display !== logo?.display
    )
      throw new BrandedBundleError(
        "Bundle versions or reviewed layout do not match their validated components.",
      );
    const summary = decodeBlueprintText(files["README.txt"]);
    if (summary !== brandedBundleSummary(blueprint, logo))
      throw new BrandedBundleError(
        "Bundle compatibility summary does not match its validated components.",
      );
    return {
      manifest,
      blueprint,
      blueprintBytes: new Uint8Array(files["blueprint.zip"]),
      logo,
      logoBytes: manifest.logo
        ? new Uint8Array(files["logo-companion.zip"])
        : null,
      summary,
    };
  } catch (error) {
    if (error instanceof BrandedBundleError) throw error;
    throw new BrandedBundleError(
      `Branded bundle rejected. Use bundle 1, an unchanged Blueprint ZIP 1/2 and optional Logo Companion 1, fixed files, no compression or extra paths. ${error instanceof Error && error.name !== "ZodError" ? error.message : "Unsupported manifest or compatibility version."}`,
    );
  } finally {
    bytes.fill(0);
  }
}
/** Components are snapped before awaiting. This wraps exact validated bytes; it does not certify an image as safe. */
export async function createBrandedBlueprintBundle(
  input: Uint8Array,
  companion?: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  if (
    !input.length ||
    input.length > BLUEPRINT_PACKAGE_LIMIT ||
    (companion !== undefined &&
      (!companion.length || companion.length > LOGO_COMPANION_LIMIT))
  )
    throw new BrandedBundleError(
      "Bundle components exceed the reviewed Blueprint (96 KiB) or companion (260 KiB) limits.",
    );
  const zip = new Uint8Array(input),
    logoBytes = companion === undefined ? null : new Uint8Array(companion);
  try {
    const blueprint = await importBlueprintPackage(zip);
    let logo: LogoCompanionManifest | null = null;
    if (logoBytes) {
      const inspected = await inspectLogoCompanion(logoBytes);
      logo = inspected.manifest;
      inspected.image.fill(0);
    }
    const summary = blueprintText(brandedBundleSummary(blueprint, logo));
    const manifest = brandedBundleManifest.parse({
      format: "lms-branded-blueprint-bundle",
      version: 1,
      compatibility: compatibility(blueprint, logo),
      blueprint: {
        path: "blueprint.zip",
        bytes: zip.length,
        sha256: await sha256(zip),
      },
      logo: logoBytes
        ? {
            path: "logo-companion.zip",
            bytes: logoBytes.length,
            sha256: await sha256(logoBytes),
            display: logo!.display,
          }
        : null,
      summary: {
        path: "README.txt",
        bytes: summary.length,
        sha256: await sha256(summary),
      },
    });
    const result = writeArchive(
      [
        {
          path: "manifest.json",
          bytes: blueprintText(blueprintJson(manifest)),
        },
        { path: "blueprint.zip", bytes: zip },
        { path: "README.txt", bytes: summary },
        ...(logoBytes
          ? [{ path: "logo-companion.zip", bytes: logoBytes }]
          : []),
      ],
      BRANDED_BUNDLE_LIMIT,
    );
    const checked = await inspectBrandedBlueprintBundle(result);
    checked.blueprintBytes.fill(0);
    checked.logoBytes?.fill(0);
    return result;
  } finally {
    zip.fill(0);
    logoBytes?.fill(0);
  }
}
