import { sign } from "node:crypto";
import { blueprintJson, sha256 } from "../../src/core/blueprint";
import { inspectBrandedBlueprintBundle } from "../../src/core/branded-bundle";
import {
  bundleAttestationPayload,
  type BundleAttestationPayload,
} from "../../src/core/branded-bundle-provenance";
import { testPublisher } from "./blueprint-provenance";
/** Ephemeral test key only; no private bytes enter fixtures, browser bundles or artifacts. */
export async function testBundleAttestation(
  bytes: Uint8Array,
  publisher: ReturnType<typeof testPublisher>,
  change?: (payload: BundleAttestationPayload) => void,
) {
  const bundle = await inspectBrandedBlueprintBundle(bytes);
  try {
    const payload = bundleAttestationPayload(
      bundle,
      await sha256(bytes),
      publisher.registry.keys[0].id,
    );
    change?.(payload);
    return rawTestBundleAttestation(payload, publisher);
  } finally {
    bundle.blueprintBytes.fill(0);
    bundle.logoBytes?.fill(0);
  }
}
export function rawTestBundleAttestation(
  payload: unknown,
  publisher: ReturnType<typeof testPublisher>,
) {
  const signature = sign(
    null,
    Buffer.from(
      "lms-branded-bundle-publisher-signature-v1\n" + blueprintJson(payload),
    ),
    publisher.privateKey,
  ).toString("hex");
  return new TextEncoder().encode(blueprintJson({ payload, signature }));
}
