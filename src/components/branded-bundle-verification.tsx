import type { InspectedBrandedBundle } from "../core/branded-bundle-provenance";
/** Presentation only. Status comes from the strict verifier, never imported metadata/status labels. */
export function BrandedBundleVerification({
  inspection,
}: {
  inspection: InspectedBrandedBundle;
}) {
  const { bundle, publisher, blueprintVerification, bundleSha256 } = inspection,
    nested = blueprintVerification.publisher;
  return (
    <section className="panel" aria-labelledby="complete-bundle-verification">
      <h3 id="complete-bundle-verification">Verify complete branded bundle</h3>
      <dl className="studio-review">
        <dt>Bundle structural integrity</dt>
        <dd>
          Passed · fixed archive, canonical manifest and exact component bytes
          checked.
        </dd>
        <dt>Nested Blueprint integrity</dt>
        <dd>
          Passed · exact ZIP, validated configuration, modules and dependencies.
        </dd>
        <dt>Logo Companion integrity</dt>
        <dd>
          {bundle.logo
            ? "Passed · exact companion bytes, manifest and layout checked."
            : "Not included · built-in business mark."}
        </dd>
        <dt>Image-content integrity</dt>
        <dd>
          {bundle.logo
            ? "Passed · original PNG bytes match the component digest. Server sanitization is still required."
            : "Not included · no image claim."}
        </dd>
        <dt>Complete-bundle publisher signature</dt>
        <dd>
          {publisher.status === "verified"
            ? `Verified complete-bundle signature · ${publisher.name}`
            : "Unverified · no signature covers this complete bundle or image."}
        </dd>
        <dt>Separate nested Blueprint signature</dt>
        <dd>
          {nested.status === "verified"
            ? `Verified nested Blueprint only · ${nested.name}`
            : "No separate nested Blueprint attestation supplied."}
        </dd>
        <dt>Authenticated coverage</dt>
        <dd>
          {publisher.status === "verified"
            ? `Exact outer bundle and Blueprint ZIP${bundle.logo ? ", Logo Companion and original PNG" : "; explicitly no image"}. Ed25519 · active key ${publisher.keyId}.`
            : nested.status === "verified"
              ? "Verified nested Blueprint only. Its separate signature does not authenticate the logo or complete bundle."
              : "Unsigned / publisher unverified. Integrity checks do not establish a publisher."}
        </dd>
        <dt>Version and feature compatibility</dt>
        <dd>
          Passed · Bundle 1 / Blueprint{" "}
          {bundle.manifest.compatibility.blueprintPackage} / BuildPlan{" "}
          {bundle.manifest.compatibility.buildPlan} / configuration{" "}
          {bundle.manifest.compatibility.configurationSchema}
          {bundle.logo ? " / Logo Companion 1" : " / no companion"}. No format
          conversion.
        </dd>
      </dl>
      <details>
        <summary>Inspect complete-bundle and signing-key fingerprints</summary>
        <p className="provenance-digest">
          Complete bundle SHA-256: <code>{bundleSha256}</code>
        </p>
        {publisher.status === "verified" && (
          <p className="provenance-digest">
            Public key SHA-256: <code>{publisher.publicKeySha256}</code>
          </p>
        )}
      </details>
      <p className="muted">
        {publisher.status === "verified"
          ? "The exact original contents were signed by the private key for a separately trusted active public key. Destination re-encoding may change image bytes; the signature does not authenticate a different sanitized output."
          : "No complete-bundle publisher claim is established. The real application registry contains no enrolled publisher keys. Locally reviewed Gallery content is a separate fact."}
      </p>
      <p>
        A signature proves signing-key possession for these exact bytes, not the
        latest release, safe image decoding, ownership or production readiness.
        Review, sanitization, quotas, destination permissions, migration
        blockers and explicit publication remain required.
      </p>
    </section>
  );
}
