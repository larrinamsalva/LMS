import { z } from "zod";
import { blueprintJson, sha256 } from "./blueprint";
import { blueprintText, decodeBlueprintText } from "./stored-archive";
import {
  BRANDED_BUNDLE_LIMIT,
  brandedBundleManifest,
  inspectBrandedBlueprintBundle,
  type BrandedBundle,
} from "./branded-bundle";
import {
  ATTESTATION_LIMIT,
  activePublisherKey,
  ProvenanceError,
  hexBytes,
  inspectBlueprintPackage,
  reviewedPublishers,
  validatePublisherRegistry,
  verifyPublisherSignature,
  type InspectedBlueprint,
} from "./blueprint-provenance";

export const BUNDLE_ATTESTATION_LIMIT = 8192;
const hex = z.string().regex(/^[a-f0-9]{64}$/);
export const bundleAttestationPayloadSchema = z
  .object({
    format: z.literal("lms-branded-bundle-publisher-attestation"),
    version: z.literal(1),
    algorithm: z.literal("Ed25519"),
    keyId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    bundleSha256: hex,
    blueprintSha256: hex,
    imageIncluded: z.boolean(),
    logoCompanionSha256: hex.nullable(),
    imageSha256: hex.nullable(),
    compatibility: brandedBundleManifest.shape.compatibility
      .extend({ bundle: z.literal(1) })
      .strict(),
  })
  .strict()
  .refine(
    (p) =>
      p.imageIncluded
        ? p.logoCompanionSha256 !== null &&
          p.imageSha256 !== null &&
          p.compatibility.logoCompanion === 1
        : p.logoCompanionSha256 === null &&
          p.imageSha256 === null &&
          p.compatibility.logoCompanion === null,
    "Image presence, companion version and both image commitments must agree.",
  );
export const bundlePublisherAttestationSchema = z
  .object({
    payload: bundleAttestationPayloadSchema,
    signature: z.string().regex(/^[a-f0-9]{128}$/),
  })
  .strict();
export type BundleAttestationPayload = z.infer<
  typeof bundleAttestationPayloadSchema
>;
export type BundlePublisherAttestation = z.infer<
  typeof bundlePublisherAttestationSchema
>;
/** Separate domain and complete canonical payload. No algorithm or signing-format negotiation. */
export const bundleAttestationMessage = (payload: BundleAttestationPayload) =>
  blueprintText(
    "lms-branded-bundle-publisher-signature-v1\n" +
      blueprintJson(bundleAttestationPayloadSchema.parse(payload)),
  );
export function parseBundlePublisherAttestation(
  bytes: Uint8Array,
): BundlePublisherAttestation {
  if (!bytes.length || bytes.length > BUNDLE_ATTESTATION_LIMIT)
    throw new ProvenanceError(
      "Complete-bundle attestation must be nonempty and no larger than 8 KiB.",
    );
  try {
    const text = decodeBlueprintText(bytes),
      raw = JSON.parse(text, (key, value) => {
        if (["__proto__", "prototype", "constructor"].includes(key))
          throw new Error();
        return value;
      });
    if (raw?.payload?.format !== "lms-branded-bundle-publisher-attestation")
      throw new ProvenanceError(
        "Unsupported complete-bundle attestation format. A nested Blueprint signature is a separate protocol.",
      );
    if (raw?.payload?.algorithm !== "Ed25519")
      throw new ProvenanceError(
        "Unsupported complete-bundle signature algorithm. Only Ed25519 is accepted.",
      );
    if (raw?.payload?.version !== 1)
      throw new ProvenanceError(
        "Unsupported complete-bundle attestation version.",
      );
    const result = bundlePublisherAttestationSchema.parse(raw);
    if (text !== blueprintJson(result)) throw new Error();
    return result;
  } catch (error) {
    if (error instanceof ProvenanceError) throw error;
    throw new ProvenanceError(
      "Malformed complete-bundle attestation. Use exact canonical data-only v1 JSON, no extra or duplicate fields, and consistent image-presence claims.",
    );
  }
}
export function bundleAttestationPayload(
  bundle: BrandedBundle,
  bundleSha256: string,
  keyId: string,
): BundleAttestationPayload {
  return bundleAttestationPayloadSchema.parse({
    format: "lms-branded-bundle-publisher-attestation",
    version: 1,
    algorithm: "Ed25519",
    keyId,
    bundleSha256,
    blueprintSha256: bundle.manifest.blueprint.sha256,
    imageIncluded: bundle.logo !== null,
    logoCompanionSha256: bundle.manifest.logo?.sha256 ?? null,
    imageSha256: bundle.logo?.image.sha256 ?? null,
    compatibility: { bundle: 1, ...bundle.manifest.compatibility },
  });
}
export type BundlePublisherVerification =
  | { status: "unsigned" }
  | {
      status: "verified";
      keyId: string;
      name: string;
      publicKeySha256: string;
    };
export interface InspectedBrandedBundle {
  bundle: BrandedBundle;
  bundleSha256: string;
  publisher: BundlePublisherVerification;
  blueprintVerification: InspectedBlueprint;
}
/** File integrity/compatibility/authentication ONLY. Never decodes pixels, stages assets or grants destination authority. */
export async function inspectAuthenticatedBrandedBundle(
  input: Uint8Array,
  options: { attestation?: Uint8Array; blueprintAttestation?: Uint8Array } = {},
  registry: unknown = reviewedPublishers(),
): Promise<InspectedBrandedBundle> {
  if (!input.length || input.length > BRANDED_BUNDLE_LIMIT)
    throw new ProvenanceError(
      "Choose a nonempty branded bundle no larger than 384 KiB.",
    );
  for (const claim of [options.attestation, options.blueprintAttestation])
    if (
      claim !== undefined &&
      (!claim.length || claim.length > ATTESTATION_LIMIT)
    )
      throw new ProvenanceError(
        "Detached attestations must be nonempty and no larger than 8 KiB.",
      );
  // Snapshot file, both independently scoped claims and public trust BEFORE any asynchronous operation.
  const bytes = new Uint8Array(input),
    whole =
      options.attestation === undefined
        ? undefined
        : new Uint8Array(options.attestation),
    nested =
      options.blueprintAttestation === undefined
        ? undefined
        : new Uint8Array(options.blueprintAttestation),
    trusted = validatePublisherRegistry(registry);
  let bundle: BrandedBundle | undefined,
    success = false;
  try {
    const claim =
      whole === undefined ? undefined : parseBundlePublisherAttestation(whole);
    bundle = await inspectBrandedBlueprintBundle(bytes);
    const bundleSha256 = await sha256(bytes),
      blueprintVerification = await inspectBlueprintPackage(
        bundle.blueprintBytes,
        nested,
        trusted,
      );
    let publisher: BundlePublisherVerification = { status: "unsigned" };
    if (claim) {
      const p = claim.payload,
        key = activePublisherKey(trusted, p.keyId);
      if (p.bundleSha256 !== bundleSha256)
        throw new ProvenanceError(
          "Complete-bundle digest mismatch. Exact outer bytes changed or this signature belongs to another bundle.",
        );
      const expected = bundleAttestationPayload(bundle, bundleSha256, key.id);
      if (blueprintJson(p) !== blueprintJson(expected))
        throw new ProvenanceError(
          "Complete-bundle component, image-presence or compatibility commitments do not match the validated contents.",
        );
      await verifyPublisherSignature(
        key,
        claim.signature,
        bundleAttestationMessage(p),
      );
      publisher = {
        status: "verified",
        keyId: key.id,
        name: key.name,
        publicKeySha256: await sha256(hexBytes(key.publicKey)),
      };
    }
    success = true;
    return { bundle, bundleSha256, publisher, blueprintVerification };
  } finally {
    bytes.fill(0);
    whole?.fill(0);
    nested?.fill(0);
    if (!success) {
      bundle?.blueprintBytes.fill(0);
      bundle?.logoBytes?.fill(0);
    }
  }
}
