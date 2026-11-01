import { z } from "zod";
import registrySource from "../templates/publishers.json" with { type: "json" };
import {
  blueprintJson,
  importBlueprintPackage,
  sha256,
  type BlueprintPackage,
} from "./blueprint";
import {
  BLUEPRINT_PACKAGE_LIMIT,
  blueprintText,
  decodeBlueprintText,
} from "./blueprint-archive";
import { planDigest, reviewedTemplateHistory } from "./template-history";

export const ATTESTATION_LIMIT = 8192;
const hex = z.string().regex(/^[a-f0-9]{64}$/),
  keyId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  gallery = z
    .object({
      id: z.string().regex(/^[a-z][a-z0-9-]{0,49}$/),
      revision: z.number().int().min(1).max(999),
    })
    .strict();
export const publisherRegistrySchema = z
  .object({
    format: z.literal("lms-blueprint-publisher-registry"),
    version: z.literal(1),
    keys: z
      .array(
        z
          .object({
            id: keyId,
            name: z
              .string()
              .min(1)
              .max(80)
              .regex(/^[^\x00-\x1f\x7f<>]+$/),
            algorithm: z.literal("Ed25519"),
            publicKey: hex,
            status: z.enum(["active", "retired"]),
          })
          .strict(),
      )
      .max(40),
  })
  .strict();
export type PublisherRegistry = z.infer<typeof publisherRegistrySchema>;
export class ProvenanceError extends Error {}
export function validatePublisherRegistry(input: unknown): PublisherRegistry {
  const result = publisherRegistrySchema.safeParse(input);
  if (
    !result.success ||
    new Set(result.data.keys.map((k) => k.id)).size !==
      result.data.keys.length ||
    new Set(result.data.keys.map((k) => k.publicKey)).size !==
      result.data.keys.length
  )
    throw new ProvenanceError(
      "Publisher trust registry is invalid. Verification is unavailable.",
    );
  return result.data;
}
/** Trust comes only from this reviewed source, never a key supplied with an import. No publisher is enrolled yet. */
export const reviewedPublishers = (): PublisherRegistry =>
  validatePublisherRegistry(registrySource);
export const attestationPayloadSchema = z
  .object({
    format: z.literal("lms-blueprint-publisher-attestation"),
    version: z.literal(1),
    algorithm: z.literal("Ed25519"),
    keyId,
    packageSha256: hex,
    compatibility: z.discriminatedUnion("package", [
      z
        .object({
          package: z.literal(1),
          buildPlan: z.literal(1),
          configurationSchema: z.literal(1),
          engineApi: z.literal(1),
          template: z.literal(1),
        })
        .strict(),
      z
        .object({
          package: z.literal(2),
          buildPlan: z.literal(2),
          configurationSchema: z.literal(2),
          branding: z.literal(1),
          engineApi: z.literal(1),
          template: z.literal(1),
        })
        .strict(),
    ]),
    gallery: gallery.nullable(),
  })
  .strict();
export const publisherAttestationSchema = z
  .object({
    payload: attestationPayloadSchema,
    signature: z.string().regex(/^[a-f0-9]{128}$/),
  })
  .strict();
export type AttestationPayload = z.infer<typeof attestationPayloadSchema>;
export type PublisherAttestation = z.infer<typeof publisherAttestationSchema>;
/** Deliberately domain-separated from credential/checkpoint signatures. UTF-8, sorted keys, exactly one final LF. */
export const attestationMessage = (payload: AttestationPayload) =>
  blueprintText(
    "lms-blueprint-publisher-signature-v1\n" +
      blueprintJson(attestationPayloadSchema.parse(payload)),
  );
export function parsePublisherAttestation(
  bytes: Uint8Array,
): PublisherAttestation {
  if (!bytes.length || bytes.length > ATTESTATION_LIMIT)
    throw new ProvenanceError(
      "Publisher attestation must be nonempty and no larger than 8 KiB.",
    );
  try {
    const text = decodeBlueprintText(bytes),
      raw = JSON.parse(text, (key, value) => {
        if (["__proto__", "prototype", "constructor"].includes(key))
          throw new Error();
        return value;
      });
    if (raw?.payload?.algorithm !== "Ed25519")
      throw new ProvenanceError(
        "Unsupported publisher signature algorithm. Only Ed25519 is accepted.",
      );
    if (raw?.payload?.version !== 1)
      throw new ProvenanceError("Unsupported publisher attestation version.");
    const result = publisherAttestationSchema.parse(raw);
    if (text !== blueprintJson(result)) throw new Error();
    return result;
  } catch (error) {
    if (error instanceof ProvenanceError) throw error;
    throw new ProvenanceError(
      "Malformed publisher attestation: use the canonical, data-only v1 file without extra or duplicate fields.",
    );
  }
}
export function packageCompatibility(
  blueprint: BlueprintPackage,
): AttestationPayload["compatibility"] {
  return blueprint.manifest.version === 1
    ? {
        package: 1,
        buildPlan: 1,
        configurationSchema: 1,
        engineApi: 1,
        template: 1,
      }
    : {
        package: 2,
        buildPlan: 2,
        configurationSchema: 2,
        branding: 1,
        engineApi: 1,
        template: 1,
      };
}
export type PublisherVerification =
  | { status: "unsigned" }
  | {
      status: "verified";
      keyId: string;
      name: string;
      publicKeySha256: string;
      gallery: AttestationPayload["gallery"];
    };
export interface InspectedBlueprint {
  blueprint: BlueprintPackage;
  packageSha256: string;
  publisher: PublisherVerification;
  gallery: {
    status: "reviewed-content" | "hint-only" | "none";
    message: string;
  };
}
export const hexBytes = (text: string) =>
  Uint8Array.from(text.match(/../g) ?? [], (part) => parseInt(part, 16));

/** All results are ephemeral inspection facts, not authorization or persisted provenance. Test registries must be supplied explicitly. */
export async function inspectBlueprintPackage(
  input: Uint8Array,
  detached?: Uint8Array,
  registry: unknown = reviewedPublishers(),
): Promise<InspectedBlueprint> {
  if (input.length > BLUEPRINT_PACKAGE_LIMIT)
    throw new ProvenanceError(
      "Choose a blueprint package no larger than 96 KiB.",
    );
  if (detached && detached.length > ATTESTATION_LIMIT)
    throw new ProvenanceError(
      "Publisher attestation must be no larger than 8 KiB.",
    );
  // Snapshot everything before the first await. A claimed signature never falls back to unsigned on failure.
  const bytes = new Uint8Array(input),
    claim =
      detached === undefined
        ? undefined
        : parsePublisherAttestation(new Uint8Array(detached)),
    trusted = validatePublisherRegistry(registry);
  const blueprint = await importBlueprintPackage(bytes),
    packageSha256 = await sha256(bytes),
    history = await reviewedTemplateHistory();
  let publisher: PublisherVerification = { status: "unsigned" };
  if (claim) {
    const payload = claim.payload,
      key = trusted.keys.find((k) => k.id === payload.keyId);
    if (!key)
      throw new ProvenanceError(
        "Unknown publisher key. No reviewed trust has been established for this key.",
      );
    if (key.status === "retired")
      throw new ProvenanceError(
        "Retired publisher key. This release refuses its attestations, including older signatures.",
      );
    if (payload.packageSha256 !== packageSha256)
      throw new ProvenanceError(
        "Publisher package digest mismatch. The ZIP bytes changed or this attestation belongs to another package.",
      );
    if (
      blueprintJson(payload.compatibility) !==
      blueprintJson(packageCompatibility(blueprint))
    )
      throw new ProvenanceError(
        "Publisher compatibility claim does not match the validated package versions.",
      );
    if (
      payload.gallery &&
      (blueprintJson(payload.gallery) !==
        blueprintJson(blueprint.manifest.blueprint.gallery) ||
        !history.some(
          (h) =>
            h.entry.metadata.id === payload.gallery!.id &&
            h.entry.metadata.revision === payload.gallery!.revision &&
            h.entry.plan.template === blueprint.plan.template,
        ))
    )
      throw new ProvenanceError(
        "Publisher Gallery edition claim is unsupported or does not match this package. It cannot establish template ancestry.",
      );
    try {
      const publicKey = await crypto.subtle.importKey(
        "raw",
        hexBytes(key.publicKey),
        { name: "Ed25519" },
        false,
        ["verify"],
      );
      if (
        !(await crypto.subtle.verify(
          "Ed25519",
          publicKey,
          hexBytes(claim.signature),
          attestationMessage(payload),
        ))
      )
        throw new ProvenanceError(
          "Invalid publisher signature. The claimed authenticated package is rejected.",
        );
    } catch (error) {
      if (error instanceof ProvenanceError) throw error;
      throw new ProvenanceError(
        "Ed25519 verification is unavailable or failed. Use a supported browser on HTTPS or localhost; no authenticated import was accepted.",
      );
    }
    publisher = {
      status: "verified",
      keyId: key.id,
      name: key.name,
      publicKeySha256: await sha256(hexBytes(key.publicKey)),
      gallery: payload.gallery,
    };
  }
  const digest = await planDigest(blueprint.plan),
    exact = history.find((h) => h.planSha256 === digest),
    hint = blueprint.manifest.blueprint.gallery;
  return {
    blueprint,
    packageSha256,
    publisher,
    gallery: exact
      ? {
          status: "reviewed-content",
          message: `Configuration exactly matches locally reviewed ${exact.entry.metadata.name}, edition ${exact.entry.metadata.revision}. This content comparison does not verify a publisher signature.`,
        }
      : hint
        ? {
            status: "hint-only",
            message: `Gallery hint: ${hint.id}, edition ${hint.revision}. Customized or unavailable content; this claim does not establish reviewed ancestry or the latest edition.`,
          }
        : {
            status: "none",
            message:
              "No reviewed Gallery edition matches this configuration. A Gallery hint is optional and never establishes publisher identity.",
          },
  };
}
