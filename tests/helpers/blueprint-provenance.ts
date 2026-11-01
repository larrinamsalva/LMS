import { generateKeyPairSync, sign } from "node:crypto";
import {
  blueprintJson,
  importBlueprintPackage,
  sha256,
} from "../../src/core/blueprint";
import {
  packageCompatibility,
  type AttestationPayload,
  type PublisherRegistry,
} from "../../src/core/blueprint-provenance";
/** Ephemeral keys only. No private test key or production publisher identity is checked in. */
export function testPublisher() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const registry: PublisherRegistry = {
    format: "lms-blueprint-publisher-registry",
    version: 1,
    keys: [
      {
        id: "ephemeral-test-publisher",
        name: "Fictional test publisher",
        algorithm: "Ed25519",
        publicKey: Buffer.from(
          publicKey.export({ format: "jwk" }).x!,
          "base64url",
        ).toString("hex"),
        status: "active",
      },
    ],
  };
  return {
    privateKey,
    registry,
    pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}
export async function testAttestation(
  bytes: Uint8Array,
  publisher: ReturnType<typeof testPublisher>,
  change?: (payload: AttestationPayload) => void,
) {
  const blueprint = await importBlueprintPackage(bytes),
    payload: AttestationPayload = {
      format: "lms-blueprint-publisher-attestation",
      version: 1,
      algorithm: "Ed25519",
      keyId: publisher.registry.keys[0].id,
      packageSha256: await sha256(bytes),
      compatibility: packageCompatibility(blueprint),
      gallery: blueprint.manifest.blueprint.gallery ?? null,
    };
  change?.(payload);
  return rawTestAttestation(payload, publisher);
}
export function rawTestAttestation(
  payload: unknown,
  publisher: ReturnType<typeof testPublisher>,
) {
  const signature = sign(
    null,
    Buffer.from(
      "lms-blueprint-publisher-signature-v1\n" + blueprintJson(payload),
    ),
    publisher.privateKey,
  ).toString("hex");
  return new TextEncoder().encode(blueprintJson({ payload, signature }));
}
