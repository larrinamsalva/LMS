/** Isolated browser test entry only. No route, registry override or private key is installed in the app. */
import { createRoot } from "react-dom/client";
import { inspectAuthenticatedBrandedBundle } from "../../src/core/branded-bundle-provenance";
import { BrandedBundleVerification } from "../../src/components/branded-bundle-verification";
const root = createRoot(document.getElementById("result")!);
export async function inspect(
  bytes: number[],
  claim: number[] | null,
  nested: number[] | null,
  registry?: unknown,
) {
  try {
    const result = await inspectAuthenticatedBrandedBundle(
      new Uint8Array(bytes),
      {
        attestation: claim === null ? undefined : new Uint8Array(claim),
        blueprintAttestation:
          nested === null ? undefined : new Uint8Array(nested),
      },
      registry,
    );
    root.render(<BrandedBundleVerification inspection={result} />);
    const facts = {
      publisher: result.publisher,
      nested: result.blueprintVerification.publisher,
      bundleSha256: result.bundleSha256,
      imageSha256: result.bundle.logo?.image.sha256 ?? null,
    };
    result.bundle.blueprintBytes.fill(0);
    result.bundle.logoBytes?.fill(0);
    return facts;
  } catch (error) {
    root.render(
      <p className="error" role="alert">
        Invalid or unsupported signature:{" "}
        {error instanceof Error ? error.message : "Verification refused"}. No
        import was accepted.
      </p>,
    );
    throw error;
  }
}
