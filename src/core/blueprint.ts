import { z } from "zod";
import {
  validateBuildPlan,
  parseBuildPlanText,
  moduleRequirements,
  type BuildPlan,
  unbrandBuildPlan,
} from "./buildplan";
import { type BusinessConfig } from "./config";
import { reviewedGallery, validateGallery, type GalleryEntry } from "./gallery";
import { moduleById } from "../modules/registry";
import {
  BlueprintError,
  blueprintText,
  decodeBlueprintText,
  readBlueprintArchive,
  writeStoredZip,
} from "./blueprint-archive";
export { BlueprintError, BLUEPRINT_PACKAGE_LIMIT } from "./blueprint-archive";
const singleLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\u0000-\u001f\u007f]*$/);
const galleryReference = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,49}$/),
    revision: z.number().int().min(1).max(999),
  })
  .strict();
const detailsSchema = z
  .object({
    name: singleLine(80),
    description: singleLine(600),
    gallery: galleryReference.optional(),
  })
  .strict();
export type BlueprintDetails = z.infer<typeof detailsSchema>;
const dependencySchema = z
  .object({
    id: z.string().max(40),
    version: z.literal("1.0.0"),
    dependencies: z.array(z.string().max(40)).max(12),
  })
  .strict();
const fileSchema = (path: "buildplan.json" | "README.txt", max: number) =>
  z
    .object({
      path: z.literal(path),
      bytes: z.number().int().min(1).max(max),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict();
const legacyManifestSchema = z
  .object({
    format: z.literal("lms-blueprint-package"),
    version: z.literal(1),
    blueprint: detailsSchema,
    compatibility: z
      .object({
        buildPlan: z.literal(1),
        engineApi: z.literal(1),
        template: z.literal(1),
        configurationSchema: z.literal(1),
        modules: z.array(dependencySchema).min(1).max(12),
      })
      .strict(),
    files: z.tuple([
      fileSchema("buildplan.json", 49152),
      fileSchema("README.txt", 16384),
    ]),
  })
  .strict();
const brandedManifestSchema = legacyManifestSchema
  .extend({
    version: z.literal(2),
    compatibility: z
      .object({
        buildPlan: z.literal(2),
        engineApi: z.literal(1),
        template: z.literal(1),
        configurationSchema: z.literal(2),
        branding: z.literal(1),
        modules: z.array(dependencySchema).min(1).max(12),
      })
      .strict(),
  })
  .strict();
const manifestSchema = z.discriminatedUnion("version", [
  legacyManifestSchema,
  brandedManifestSchema,
]);
export interface BlueprintPackage {
  manifest: z.infer<typeof manifestSchema>;
  plan: BuildPlan;
  summary: string;
}
/** Canonical JSON is UTF-8, lexically sorted object keys, compact arrays/objects, one final LF. */
export function blueprintJson(value: unknown): string {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sorted)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, n]) => [k, sorted(n)]),
          )
        : v;
  return JSON.stringify(sorted(value)) + "\n";
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new BlueprintError(
      "Blueprint integrity checks require HTTPS or localhost in a supported browser.",
    );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer,
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function blueprintModules(plan: BuildPlan) {
  return plan.configuration.modules.map((m) => ({
    ...m,
    dependencies: moduleRequirements(plan.configuration, m.id).sort(),
  }));
}
function legacyBlueprintSummary(
  plan: BuildPlan,
  details: BlueprintDetails,
): string {
  const config = plan.configuration;
  return [
    "LMS BLUEPRINT - FICTIONAL CONFIGURATION ONLY",
    details.name,
    details.description,
    "",
    `Business: ${config.name}`,
    `Business type: ${plan.template}`,
    `Time zone: ${config.timeZone ?? "UTC"}`,
    "BuildPlan 1 / Engine API 1 / Template 1 / Configuration schema 1",
    "",
    "INCLUDED FEATURES AND REQUIRED DEPENDENCIES",
    // v1 protocol text: derive labels from the saved plan, never mutable Gallery/registry copy.
    ...blueprintModules(plan).map(
      (m) =>
        `${m.id}@${m.version}: ${config.entities
          .filter((e) => e.module === m.id)
          .map((e) => e.plural)
          .join(", ")}\nRequires: ${m.dependencies.join(", ") || "none"}`,
    ),
    "",
    "NAVIGATION",
    ...config.navigation.map((id) => {
      const e = config.entities.find((e) => e.id === id)!;
      return `${id}: ${e.navigationLabel ?? e.plural}`;
    }),
    "",
    "SETUP AND SAFE REUSE",
    "1. Run the MIT-licensed LMS using https://github.com/larrinamsalva/LMS and its README setup instructions.",
    "2. Open BuildPlan Studio, choose Import Blueprint Package, then inspect Review Blueprint.",
    "3. Compare features, dependencies, workspace impact and any Gallery revision hint. No update is automatic.",
    "4. Choose Use as unsaved Studio choices, then prepare the actual Engine-powered fictional preview.",
    "5. Save a new draft explicitly. Publishing separately requires the existing impact review and confirmation.",
    "",
    "LIMITS AND TRUST",
    "This package contains configuration only. It does not include records, accounts, credentials, databases or executable application code.",
    "Names, descriptions and labels are user-supplied text. Never enter private data or secrets in them.",
    "Checksums detect corruption, not a trusted author. Gallery references are unverified hints, not signatures or upgrade approval.",
    "No hosting, deployment, production authentication, recovery activation, live payments or messaging is enabled.",
    "Populated field-schema changes require separate migration review; this package cannot perform a migration.",
    "Preview and demo drafts are temporary. Keep this downloaded package to retain your choices.",
    "MIT licensing and ForgeOS attribution remain in the LMS repository.",
    "",
  ].join("\n");
}
export function blueprintSummary(
  plan: BuildPlan,
  details: BlueprintDetails,
): string {
  if (plan.version === 1) return legacyBlueprintSummary(plan, details);
  const brand = plan.configuration.branding!;
  return legacyBlueprintSummary(unbrandBuildPlan(plan), details)
    .replace(
      "BuildPlan 1 / Engine API 1 / Template 1 / Configuration schema 1",
      "BuildPlan 2 / Engine API 1 / Template 1 / Configuration schema 2 / Branding 1",
    )
    .replace(
      "SETUP AND SAFE REUSE",
      [
        "BRANDING",
        `Mark: ${brand.mark}`,
        `Monogram: ${brand.monogram}`,
        `Tagline: ${brand.tagline ?? ""}`,
        `Palette: ${brand.palette}`,
        `Default appearance: ${brand.appearance}`,
        "",
        "SETUP AND SAFE REUSE",
      ].join("\n"),
    );
}
export async function createBlueprintPackage(
  input: unknown,
  metadata: BlueprintDetails,
): Promise<Uint8Array<ArrayBuffer>> {
  const plan = validateBuildPlan(input),
    parsed = detailsSchema.safeParse(metadata);
  if (!parsed.success)
    throw new BlueprintError(
      "Use a single-line blueprint name (1–80 characters) and description (1–600 characters), without control characters or unsupported metadata.",
    );
  const details = parsed.data,
    document = blueprintText(blueprintJson(plan)),
    summary = blueprintText(blueprintSummary(plan, details));
  const manifest = manifestSchema.parse({
    format: "lms-blueprint-package",
    version: plan.version,
    blueprint: details,
    compatibility: {
      buildPlan: plan.version,
      engineApi: 1,
      template: 1,
      configurationSchema: plan.configuration.schemaVersion,
      ...(plan.version === 2 ? { branding: 1 } : {}),
      modules: blueprintModules(plan),
    },
    files: [
      {
        path: "buildplan.json",
        bytes: document.length,
        sha256: await sha256(document),
      },
      {
        path: "README.txt",
        bytes: summary.length,
        sha256: await sha256(summary),
      },
    ],
  });
  const result = writeStoredZip([
    { path: "manifest.json", bytes: blueprintText(blueprintJson(manifest)) },
    { path: "buildplan.json", bytes: document },
    { path: "README.txt", bytes: summary },
  ]);
  // An exporter must never emit a package its strict importer would refuse.
  await importBlueprintPackage(result);
  return result;
}
export async function importBlueprintPackage(
  input: Uint8Array,
): Promise<BlueprintPackage> {
  // Snapshot before the first await, so callers cannot change the bytes during verification.
  const files = readBlueprintArchive(new Uint8Array(input));
  try {
    const manifestText = decodeBlueprintText(files["manifest.json"]),
      manifest = manifestSchema.parse(
        JSON.parse(manifestText, (key, value) => {
          if (["__proto__", "prototype", "constructor"].includes(key))
            throw new BlueprintError("Unsafe JSON keys are not allowed.");
          return value;
        }),
      );
    if (blueprintJson(manifest) !== manifestText)
      throw new BlueprintError(
        "Manifest must use the documented canonical JSON format, without duplicate keys.",
      );
    for (const file of manifest.files)
      if (
        files[file.path].length !== file.bytes ||
        (await sha256(files[file.path])) !== file.sha256
      )
        throw new BlueprintError(
          `Integrity check failed for ${file.path}. Download an unchanged package again.`,
        );
    const planText = decodeBlueprintText(files["buildplan.json"]),
      plan = parseBuildPlanText(planText),
      summary = decodeBlueprintText(files["README.txt"]);
    if (manifest.version !== plan.version)
      throw new BlueprintError(
        "Package and BuildPlan versions do not match. Branded plans require package 2.",
      );
    if (blueprintJson(plan) !== planText)
      throw new BlueprintError(
        "BuildPlan must use canonical JSON without duplicate keys.",
      );
    if (
      blueprintJson(manifest.compatibility.modules) !==
      blueprintJson(blueprintModules(plan))
    )
      throw new BlueprintError(
        "Package modules or dependencies do not match its validated BuildPlan.",
      );
    if (summary !== blueprintSummary(plan, manifest.blueprint))
      throw new BlueprintError(
        "The setup summary does not match the blueprint features.",
      );
    return { manifest, plan, summary };
  } catch (e) {
    if (e instanceof BlueprintError) throw e;
    throw new BlueprintError(
      "Unsupported or malformed blueprint. Check package, BuildPlan, engine and template versions, reviewed modules and their dependencies.",
    );
  }
}
export interface BlueprintDifference {
  label: string;
  before: string;
  after: string;
}
/** Readable comparison of configuration choices only; it never merges or publishes anything. */
export function compareBlueprints(
  before: BusinessConfig,
  after: BusinessConfig,
): BlueprintDifference[] {
  const rows: BlueprintDifference[] = [],
    add = (label: string, a: string, b: string) => {
      if (a !== b)
        rows.push({ label, before: a || "None", after: b || "None" });
    };
  add("Business name", before.name, after.name);
  add("Business type", before.industry, after.industry);
  add("Project identity", before.id, after.id);
  add("Time zone", before.timeZone ?? "UTC", after.timeZone ?? "UTC");
  for (const key of [
    "version",
    "tagline",
    "monogram",
    "mark",
    "palette",
    "appearance",
  ] as const)
    add(
      `Branding: ${key}`,
      String(before.branding?.[key] ?? "LMS default"),
      String(after.branding?.[key] ?? "LMS default"),
    );
  for (const id of new Set(
    [...before.modules, ...after.modules].map((m) => m.id),
  ))
    add(
      moduleById.get(id)?.name ?? id,
      before.modules.find((m) => m.id === id)?.version ?? "Disabled",
      after.modules.find((m) => m.id === id)?.version ?? "Disabled",
    );
  add(
    "Navigation order",
    before.navigation.join(" → "),
    after.navigation.join(" → "),
  );
  for (const id of new Set(
    [...before.entities, ...after.entities].map((e) => e.id),
  )) {
    const a = before.entities.find((e) => e.id === id),
      b = after.entities.find((e) => e.id === id);
    add(
      `${id}: terminology`,
      a ? `${a.singular} / ${a.plural}` : "",
      b ? `${b.singular} / ${b.plural}` : "",
    );
    add(
      `${id}: navigation label`,
      a?.navigationLabel ?? a?.plural ?? "",
      b?.navigationLabel ?? b?.plural ?? "",
    );
    for (const key of new Set(
      [...(a?.fields ?? []), ...(b?.fields ?? [])].map((f) => f.key),
    )) {
      const old = a?.fields.find((f) => f.key === key),
        next = b?.fields.find((f) => f.key === key);
      if (blueprintJson(old) !== blueprintJson(next))
        add(
          `${id}: field ${key}`,
          old
            ? `${old.label} (${old.type}${old.required ? ", required" : ", optional"}${old.target ? ", target " + old.target : ""}${old.options ? ", options " + old.options.join(" / ") : ""})`
            : "",
          next
            ? `${next.label} (${next.type}${next.required ? ", required" : ", optional"}${next.target ? ", target " + next.target : ""}${next.options ? ", options " + next.options.join(" / ") : ""})`
            : "",
        );
    }
  }
  return rows;
}
export function reviewGalleryCompatibility(
  plan: BuildPlan,
  reference?: BlueprintDetails["gallery"],
  catalog: GalleryEntry[] = reviewedGallery(),
) {
  const entries = validateGallery(catalog),
    entry = reference && entries.find((e) => e.metadata.id === reference.id);
  if (!reference)
    return {
      message:
        "No Gallery reference is included. Your customized configuration is independently reusable.",
      differences: [],
    };
  if (!entry)
    return {
      message:
        "This Gallery reference is unavailable in this LMS release. It is an unverified hint; your validated choices can still be used.",
      differences: [],
    };
  if (entry.plan.template !== plan.template)
    return {
      message:
        "The Gallery hint names a different business type. It cannot establish a compatible update.",
      differences: [],
    };
  const revision = entry.metadata.revision;
  return {
    message:
      revision > reference.revision
        ? `A newer reviewed Gallery starter exists: ${entry.metadata.name}, revision ${revision} (package claims revision ${reference.revision}).`
        : revision < reference.revision
          ? `This LMS release contains ${entry.metadata.name}, revision ${revision}; the package claims a newer revision ${reference.revision} that cannot be verified here.`
          : `${entry.metadata.name}, revision ${revision}, is the currently bundled reviewed starter.`,
    differences: compareBlueprints(
      plan.configuration,
      entry.plan.configuration,
    ),
  };
}
