/** Trusted OFFLINE signer only. No application/client route imports this module. */
import { sign } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { blueprintJson } from "../core/blueprint";
import { BRANDED_BUNDLE_LIMIT } from "../core/branded-bundle";
import {
  activePublisherKey,
  reviewedPublishers,
  validatePublisherRegistry,
} from "../core/blueprint-provenance";
import {
  BUNDLE_ATTESTATION_LIMIT,
  bundleAttestationMessage,
  bundleAttestationPayload,
  inspectAuthenticatedBrandedBundle,
  type BundlePublisherAttestation,
} from "../core/branded-bundle-provenance";
import {
  checkedPublisherPrivateKey,
  readBlueprintFile,
  readPublisherPrivateKey,
} from "./blueprint-signing";
import { newFile, syncDirectory } from "./publication/files";

export const bundleSigningConfirmation =
  "SIGN REVIEWED FICTIONAL BRANDED BUNDLE";
const approvalSchema = z
  .object({
    keyId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    expectedBundleSha256: z.string().regex(/^[a-f0-9]{64}$/),
    confirmation: z.literal(bundleSigningConfirmation),
  })
  .strict();
export const bundleSigningRequestSchema = approvalSchema
  .extend({
    bundlePath: z.string().min(1).max(4096),
    privateKeyPath: z.string().min(1).max(4096),
    outputPath: z.string().min(1).max(4096),
  })
  .strict();
export async function signBrandedBundle(
  input: Uint8Array,
  pem: string,
  inputApproval: z.infer<typeof approvalSchema>,
  registry: unknown = reviewedPublishers(),
) {
  if (!input.length || input.length > BRANDED_BUNDLE_LIMIT)
    throw new Error("Use a bounded nonempty branded bundle.");
  const approval = approvalSchema.parse(inputApproval),
    trusted = validatePublisherRegistry(registry),
    bytes = new Uint8Array(input);
  let inspected:
    | Awaited<ReturnType<typeof inspectAuthenticatedBrandedBundle>>
    | undefined;
  try {
    inspected = await inspectAuthenticatedBrandedBundle(bytes, {}, trusted);
    if (approval.expectedBundleSha256 !== inspected.bundleSha256)
      throw new Error(
        "Signing refused: independently inspect and confirm the exact complete-bundle digest.",
      );
    const key = activePublisherKey(trusted, approval.keyId),
      privateKey = checkedPublisherPrivateKey(pem, key.publicKey);
    const payload = bundleAttestationPayload(
        inspected.bundle,
        inspected.bundleSha256,
        key.id,
      ),
      attestation: BundlePublisherAttestation = {
        payload,
        signature: sign(
          null,
          bundleAttestationMessage(payload),
          privateKey,
        ).toString("hex"),
      },
      text = blueprintJson(attestation);
    const checked = await inspectAuthenticatedBrandedBundle(
      bytes,
      { attestation: new TextEncoder().encode(text) },
      trusted,
    );
    checked.bundle.blueprintBytes.fill(0);
    checked.bundle.logoBytes?.fill(0);
    return text;
  } finally {
    bytes.fill(0);
    inspected?.bundle.blueprintBytes.fill(0);
    inspected?.bundle.logoBytes?.fill(0);
  }
}
export async function signBrandedBundleFile(
  input: unknown,
  registry: unknown = reviewedPublishers(),
) {
  const request = bundleSigningRequestSchema.parse(input),
    trusted = validatePublisherRegistry(registry),
    pem = await readPublisherPrivateKey(
      request.privateKeyPath,
      request.outputPath,
    ),
    bytes = await readBlueprintFile(request.bundlePath, BRANDED_BUNDLE_LIMIT);
  try {
    const text = await signBrandedBundle(
      bytes,
      pem,
      {
        keyId: request.keyId,
        expectedBundleSha256: request.expectedBundleSha256,
        confirmation: request.confirmation,
      },
      trusted,
    );
    await newFile(request.outputPath, text); // O_EXCL + O_NOFOLLOW + 0600 + fsync, never repair/overwrite.
    const persisted = await readBlueprintFile(
      request.outputPath,
      BUNDLE_ATTESTATION_LIMIT,
    );
    if (!Buffer.from(persisted).equals(Buffer.from(text)))
      throw new Error(
        "Incomplete or changed attestation output; retain for inspection.",
      );
    const checked = await inspectAuthenticatedBrandedBundle(
      bytes,
      { attestation: persisted },
      trusted,
    );
    checked.bundle.blueprintBytes.fill(0);
    checked.bundle.logoBytes?.fill(0);
    await syncDirectory(path.dirname(request.outputPath));
    return {
      status: "signed" as const,
      bundleSha256: request.expectedBundleSha256,
      keyId: request.keyId,
      attestationVersion: 1 as const,
    };
  } finally {
    bytes.fill(0);
  }
}
