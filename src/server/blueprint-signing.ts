/** Offline maintainer tool only. Never import this module into an app route or client component. */
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { z } from "zod";
import { blueprintJson } from "../core/blueprint";
import { BLUEPRINT_PACKAGE_LIMIT } from "../core/blueprint-archive";
import {
  attestationMessage,
  inspectBlueprintPackage,
  packageCompatibility,
  reviewedPublishers,
  validatePublisherRegistry,
  type AttestationPayload,
  type PublisherAttestation,
} from "../core/blueprint-provenance";
import { readPrivateText } from "./recovery/private-file";
import { newFile, privateDirectory, syncDirectory } from "./publication/files";

export const signingConfirmation = "SIGN REVIEWED FICTIONAL BLUEPRINT";
export const signingRequestSchema = z
  .object({
    packagePath: z.string().min(1).max(4096),
    privateKeyPath: z.string().min(1).max(4096),
    outputPath: z.string().min(1).max(4096),
    keyId: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    expectedPackageSha256: z.string().regex(/^[a-f0-9]{64}$/),
    confirmation: z.literal(signingConfirmation),
  })
  .strict();
export async function readBlueprintFile(
  file: string,
  limit = BLUEPRINT_PACKAGE_LIMIT,
) {
  const h = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await h.stat();
    if (!stat.isFile() || stat.size > limit || !stat.size)
      throw new Error("Use a bounded, nonempty regular blueprint file.");
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await h.read(bytes, length, bytes.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length > limit)
      throw new Error("Blueprint file exceeds its size limit.");
    return new Uint8Array(bytes.subarray(0, length));
  } finally {
    await h.close();
  }
}
/** Caller must have independently reviewed this exact digest and established signing authority. No key enrollment here. */
export async function signBlueprint(
  bytes: Uint8Array,
  pem: string,
  request: Pick<
    z.infer<typeof signingRequestSchema>,
    "keyId" | "expectedPackageSha256" | "confirmation"
  >,
  registry: unknown = reviewedPublishers(),
) {
  const inspected = await inspectBlueprintPackage(bytes),
    trusted = validatePublisherRegistry(registry),
    key = trusted.keys.find(
      (k) => k.id === request.keyId && k.status === "active",
    );
  if (
    request.confirmation !== signingConfirmation ||
    request.expectedPackageSha256 !== inspected.packageSha256 ||
    !key
  )
    throw new Error(
      "Signing refused: review the exact package digest and an active, separately enrolled publisher key.",
    );
  const privateKey = createPrivateKey(pem);
  if (privateKey.asymmetricKeyType !== "ed25519")
    throw new Error("Signing requires an Ed25519 private key.");
  const publicKey = createPublicKey(privateKey).export({ format: "jwk" });
  if (
    Buffer.from(publicKey.x ?? "", "base64url").toString("hex") !==
    key.publicKey
  )
    throw new Error(
      "Private key does not match the reviewed publisher registry.",
    );
  const payload: AttestationPayload = {
      format: "lms-blueprint-publisher-attestation",
      version: 1,
      algorithm: "Ed25519",
      keyId: key.id,
      packageSha256: inspected.packageSha256,
      compatibility: packageCompatibility(inspected.blueprint),
      gallery: inspected.blueprint.manifest.blueprint.gallery ?? null,
    },
    attestation: PublisherAttestation = {
      payload,
      signature: sign(null, attestationMessage(payload), privateKey).toString(
        "hex",
      ),
    },
    text = blueprintJson(attestation);
  // Self-verify with the same client-compatible protocol and strict package reader before writing anything.
  await inspectBlueprintPackage(bytes, new TextEncoder().encode(text), trusted);
  return text;
}
export async function signBlueprintFile(
  input: unknown,
  registry: unknown = reviewedPublishers(),
) {
  const request = signingRequestSchema.parse(input),
    root = path.resolve(fileURLToPath(new URL("../../", import.meta.url))),
    keyPath = await realpath(request.privateKeyPath);
  if (
    !path.isAbsolute(request.privateKeyPath) ||
    keyPath === root ||
    keyPath.startsWith(root + path.sep)
  )
    throw new Error(
      "Keep private signing keys outside the checkout, backups and demo host.",
    );
  await privateDirectory(path.dirname(request.outputPath));
  await privateDirectory(path.dirname(request.privateKeyPath));
  const bytes = await readBlueprintFile(request.packagePath),
    pem = await readPrivateText(request.privateKeyPath, 8192),
    text = await signBlueprint(bytes, pem, request, registry);
  await newFile(request.outputPath, text);
  await syncDirectory(path.dirname(request.outputPath));
  return {
    status: "signed",
    packageSha256: request.expectedPackageSha256,
    keyId: request.keyId,
    attestationVersion: 1,
  };
}
