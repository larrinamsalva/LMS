import type { InspectedBlueprint } from "../core/blueprint-provenance";
/** Presentation only; the import handler supplies the inspection, never imported status text. */
export function BlueprintVerification({
  inspection,
}: {
  inspection: InspectedBlueprint;
}) {
  const { blueprint, publisher, gallery, packageSha256 } = inspection;
  return (
    <section className="panel" aria-labelledby="blueprint-verification-heading">
      <h3 id="blueprint-verification-heading">Verify Blueprint</h3>
      <dl className="studio-review">
        <dt>Package integrity</dt>
        <dd>Passed · exact ZIP profile, files and hashes checked.</dd>
        <dt>Publisher verification</dt>
        <dd>
          {publisher.status === "verified"
            ? `Verified publisher signature · ${publisher.name}`
            : "Unverified publisher · unsigned package"}
        </dd>
        <dt>Signature status</dt>
        <dd>
          {publisher.status === "verified"
            ? `Ed25519 · recognized active key ${publisher.keyId}`
            : "No detached attestation supplied. Checksums and author names are not signatures."}
        </dd>
        <dt>Compatibility</dt>
        <dd>
          Passed · Package {blueprint.manifest.version} / BuildPlan{" "}
          {blueprint.plan.version} / Configuration{" "}
          {blueprint.plan.configuration.schemaVersion}. Enabled modules and
          dependencies validated.
        </dd>
        <dt>Supported template edition</dt>
        <dd>
          {publisher.status === "verified" && publisher.gallery
            ? `Publisher attests ${publisher.gallery.id}, edition ${publisher.gallery.revision}. `
            : "No authenticated Gallery edition claim. "}
          {gallery.message}
        </dd>
      </dl>
      <details>
        <summary>
          Inspect exact package and verification key fingerprints
        </summary>
        <p className="provenance-digest">
          Package SHA-256: <code>{packageSha256}</code>
        </p>
        {publisher.status === "verified" && (
          <p className="provenance-digest">
            Public key SHA-256: <code>{publisher.publicKeySha256}</code>
          </p>
        )}
      </details>
      <p className="muted">
        {publisher.status === "verified"
          ? "A valid signature establishes possession of a recognized signing key. It does not prove this is the newest edition, reviewed ancestry or production safety."
          : "Unsigned imports remain usable after review. Locally reviewed Gallery content is separate from publisher identity. No real publisher key is enrolled in this release."}
      </p>
      <p>
        No signature authorizes installation, database execution, migration,
        activation or publication. Existing review, permissions, saved revision
        checks and migration blockers still apply.
      </p>
    </section>
  );
}
