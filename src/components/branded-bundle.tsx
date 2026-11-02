import { useEffect, useRef, useState } from "react";
import type { WorkspaceSnapshot } from "../core/engine";
import type { BuildPlan } from "../core/buildplan";
import { configurationImpact } from "../core/config";
import { defaultBranding, brandingVariables, palettes } from "../core/branding";
import { blueprintModules } from "../core/blueprint";
import {
  BRANDED_BUNDLE_LIMIT,
  type BrandedBundle,
} from "../core/branded-bundle";
import type { InspectedBlueprint } from "../core/blueprint-provenance";
import { manifests } from "../modules/registry";
import { BusinessIdentity } from "./business-brand";
import { BlueprintVerification } from "./blueprint-verification";
import type { LogoController } from "./private-logo";

export interface BundleInspection {
  bundle: BrandedBundle;
  blueprintVerification: InspectedBlueprint;
  configurationRevision: number;
  editorFingerprint: string;
}
export function BrandedBundleTools({
  busy,
  valid,
  canManage,
  hasSelected,
  onExport,
  onImport,
}: {
  busy: boolean;
  valid: boolean;
  canManage: boolean;
  hasSelected: boolean;
  onExport: (includeLogo: boolean) => void;
  onImport: (file: File, attestation?: File) => void;
}) {
  const [include, setInclude] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [claim, setClaim] = useState<File | null>(null);
  return (
    <section className="panel" aria-labelledby="branded-bundle-tools">
      <h2 id="branded-bundle-tools">Portable branded blueprint bundle</h2>
      <p>
        Keep your validated Blueprint Package and an optional approved logo
        together in a new bundle. Existing Blueprint ZIPs, BuildPlans and logo
        companions keep their original formats. Downloads do not save or publish
        anything.
      </p>
      <label className="check-label">
        <input
          type="checkbox"
          checked={include && hasSelected}
          disabled={busy || !canManage || !hasSelected}
          onChange={(e) => setInclude(e.target.checked)}
        />
        Include my selected temporary logo
      </label>
      <p className="muted">
        Only a currently selected, server-sanitized session logo can be included
        by an owner/admin. Unselected or durable PostgreSQL images are not
        exported here. Without an image, the bundle uses a built-in mark.
      </p>
      <button
        type="button"
        className="secondary"
        disabled={busy || !valid}
        onClick={() => onExport(include && hasSelected)}
      >
        Download Branded Blueprint Bundle
      </button>
      <label htmlFor="branded-bundle-file">
        Import Branded Blueprint Bundle
      </label>
      <input
        id="branded-bundle-file"
        type="file"
        accept=".zip,application/zip"
        disabled={busy}
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
        }}
      />
      <p className="muted">
        Up to {BRANDED_BUNDLE_LIMIT / 1024} KiB. Fixed files, exact hashes,
        canonical metadata and both nested archive formats are checked. This is
        data, not an application installer, migration or database backup.
      </p>
      <label htmlFor="bundle-blueprint-attestation">
        Nested Blueprint attestation only (optional)
      </label>
      <input
        id="bundle-blueprint-attestation"
        type="file"
        accept=".json,application/json"
        disabled={busy}
        onChange={(e) => setClaim(e.target.files?.[0] ?? null)}
      />
      <p className="muted">
        An existing detached signature can cover only the exact nested Blueprint
        ZIP. It does not authenticate the logo or this whole bundle. Unknown or
        invalid claimed signatures refuse; unsigned bundles remain reviewable.
      </p>
      <button
        type="button"
        className="secondary"
        disabled={busy || !file}
        onClick={() => {
          if (file) onImport(file, claim ?? undefined);
        }}
      >
        Review branded bundle
      </button>
    </section>
  );
}
export function BrandedBundleReview({
  inspection,
  workspace,
  controller,
  onAccept,
  onClose,
  onPreview,
}: {
  inspection: BundleInspection;
  workspace: WorkspaceSnapshot;
  controller: LogoController;
  onAccept: () => void;
  onClose: () => void;
  onPreview: (plan: BuildPlan) => Promise<string>;
}) {
  const { bundle, blueprintVerification } = inspection,
    { plan, manifest } = bundle.blueprint,
    logo = bundle.logo;
  const brand =
      plan.configuration.branding ??
      defaultBranding(plan.configuration.industry),
    heading = useRef<HTMLHeadingElement>(null);
  const [accepted, setAccepted] = useState(false),
    [stageRevision, setStageRevision] = useState<number | null>(null),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [preview, setPreview] = useState(""),
    [pending, setPending] = useState(false);
  const current = controller.state,
    canManage = ["owner", "admin"].includes(workspace.role),
    stale =
      workspace.config.revision !== inspection.configurationRevision ||
      controller.scope !== workspace.organizationId;
  const staged =
    current?.revision === stageRevision &&
    current.staged?.companion?.imageSha256 === logo?.image.sha256 &&
    current.staged?.display === logo?.display
      ? current.staged
      : null;
  const selected =
      current?.selected?.id === selectedId ? current.selected : null,
    candidate = staged ?? selected,
    busy = pending || controller.busy;
  const impact = configurationImpact(
    workspace.config.document,
    plan.configuration,
    workspace.populatedEntities,
  );
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <div
      className="stack studio"
      role="region"
      aria-label="Branded bundle review"
    >
      <section className="panel">
        <h2 ref={heading} tabIndex={-1}>
          Review Branded Blueprint Bundle
        </h2>
        <h3>{manifest.blueprint.name}</h3>
        <p>{manifest.blueprint.description}</p>
        <dl className="studio-review">
          <dt>Business</dt>
          <dd>{plan.configuration.name}</dd>
          <dt>Business type</dt>
          <dd>{plan.template}</dd>
          <dt>Compatibility</dt>
          <dd>
            Bundle 1 · Blueprint {manifest.version} · BuildPlan {plan.version} ·
            Configuration {plan.configuration.schemaVersion} · Engine API 1 /
            Template 1. No version conversion.
          </dd>
          <dt>Brand palette and appearance</dt>
          <dd>
            {palettes[brand.palette].name} · {brand.appearance}
            {!plan.configuration.branding
              ? " (legacy plan uses an industry default)"
              : ""}
          </dd>
          <dt>Bundle publisher authenticity</dt>
          <dd>
            Unverified · no signature covers this complete bundle or image.
          </dd>
        </dl>
        <p>
          Bundle integrity passed: exact components and nested formats
          validated. Your saved drafts, records, published configuration and
          durable logo associations have not changed. The imported image is not
          displayed before server sanitization.
        </p>
        <details>
          <summary>Inspect exact bundle component fingerprints</summary>
          <p className="provenance-digest">
            Blueprint ZIP SHA-256:{" "}
            <code>{bundle.manifest.blueprint.sha256}</code>
          </p>
          {bundle.manifest.logo && (
            <p className="provenance-digest">
              Logo Companion ZIP SHA-256:{" "}
              <code>{bundle.manifest.logo.sha256}</code>
            </p>
          )}
          {logo && (
            <p className="provenance-digest">
              Included PNG SHA-256: <code>{logo.image.sha256}</code>
            </p>
          )}
        </details>
        {stale && (
          <p className="error" role="alert">
            The workspace revision or organization changed. Close and inspect
            the file again before accepting or staging.
          </p>
        )}
        <div className="actions">
          <button
            type="button"
            disabled={busy || accepted || stale}
            onClick={() => {
              try {
                onAccept();
                setAccepted(true);
                setNotice(
                  "BuildPlan accepted as unsaved Studio choices. No logo was staged or selected; nothing was saved or published.",
                );
                setError("");
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "The review is stale. Inspect again.",
                );
              }
            }}
          >
            Accept bundle BuildPlan as unsaved choices
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            {accepted
              ? "Return to Studio choices"
              : "Cancel branded bundle review"}
          </button>
        </div>
      </section>
      <section className="panel" aria-labelledby="bundle-features">
        <h3 id="bundle-features">
          Included features and required dependencies
        </h3>
        <ul>
          {blueprintModules(plan).map((m) => (
            <li key={m.id}>
              <strong>
                {manifests.find((n) => n.id === m.id)?.name ?? m.id}
              </strong>{" "}
              · {m.version}. Requires: {m.dependencies.join(", ") || "none"}.
            </li>
          ))}
        </ul>
        <p className="muted">
          Unsupported modules, dependencies and versions refuse before review.
          Production hosting, financial operations, automatic migration and
          image publication remain unavailable.
        </p>
        {impact.identityChanged && (
          <p className="error">
            Different project identity. Use the independent configuration
            preview; this cannot replace the current business.
          </p>
        )}
        {impact.migrationEntities.length > 0 && (
          <p className="error">
            Populated entity changes require separate migration review:{" "}
            {impact.migrationEntities.join(", ")}. A bundle never bypasses this
            blocker.
          </p>
        )}
        {impact.disabledModules.length > 0 && (
          <p>
            Disabled modules retain existing records and history:{" "}
            {impact.disabledModules.join(", ")}.
          </p>
        )}
        <p>
          Saving remains explicit. Publication still requires a current saved
          revision, permissions, impact review and confirmation.
        </p>
      </section>
      <section
        className="panel"
        aria-labelledby="nested-blueprint-verification"
      >
        <h3 id="nested-blueprint-verification">
          Nested Blueprint verification only
        </h3>
        <p>
          Any verified publisher result below applies only to the nested
          Blueprint ZIP. The complete bundle and logo remain
          publisher-unverified.
        </p>
        <BlueprintVerification inspection={blueprintVerification} />
      </section>
      <section className="panel" aria-labelledby="bundle-logo-review">
        <h3 id="bundle-logo-review">Independent logo review and approval</h3>
        {logo ? (
          <>
            <p>
              <strong>Image integrity verified.</strong> PNG ·{" "}
              {logo.image.width} × {logo.image.height} · {logo.image.bytes}{" "}
              bytes · contained {logo.display}. Publisher authenticity not
              established. Integrity is not image safety.
            </p>
            <p>
              Accept the BuildPlan first, then independently approve the
              original server sanitizer, quotas and temporary custody. Staging
              does not select the image. No private image is copied into a
              separate preview organization or durable store.
            </p>
            <button
              type="button"
              disabled={
                busy ||
                !accepted ||
                !canManage ||
                !current ||
                stale ||
                !bundle.logoBytes
              }
              onClick={async () => {
                const expected = current!.revision + 1;
                setError("");
                setNotice("");
                const ok = await controller.stageCompanion(bundle.logoBytes!);
                if (ok) {
                  setStageRevision(expected);
                  setSelectedId(null);
                  setNotice(
                    "Bundle logo sanitized and staged. Inspect both themes, then explicitly select it for this session.",
                  );
                } else {
                  setStageRevision(null);
                  setError(
                    "Logo staging was refused. Refresh private logos and approve again; the current selected image is unchanged.",
                  );
                }
              }}
            >
              Sanitize and stage bundle logo
            </button>
            {!canManage && (
              <p>
                Only current owners/admins can stage or select a private session
                logo.
              </p>
            )}
            <div className="actions">
              <button
                type="button"
                disabled={busy || !staged || !canManage || stale}
                onClick={async () => {
                  const a = staged!;
                  setError("");
                  if (await controller.command("select", a)) {
                    setSelectedId(a.id);
                    setNotice(
                      "Temporary private bundle logo selected. No published configuration or durable association changed.",
                    );
                  }
                }}
              >
                Select staged bundle logo for this session
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void controller.refresh()}
              >
                Refresh private logos for bundle review
              </button>
            </div>
            {accepted && !candidate && stageRevision !== null && (
              <p>
                The staged revision changed or expired. Refresh and explicitly
                sanitize/stage again; another image will not be selected.
              </p>
            )}
          </>
        ) : (
          <p>
            No logo companion is included. Keep the built-in mark; no image
            processing or transfer is needed.
          </p>
        )}
        <div className="branding-examples">
          {(["light", "dark"] as const).map((mode) => (
            <div
              key={mode}
              className="brand-example"
              data-theme={mode}
              style={brandingVariables(brand, mode)}
              aria-label={`${mode} bundle logo sample`}
            >
              <h4>{mode === "light" ? "Light" : "Dark"} contained preview</h4>
              <BusinessIdentity
                name={plan.configuration.name}
                branding={brand}
                logo={
                  candidate
                    ? {
                        organizationId: workspace.organizationId,
                        asset: candidate,
                      }
                    : undefined
                }
              />
              <p>
                {candidate
                  ? "Server-sanitized private session image"
                  : "Built-in fallback · image not staged for this review"}
              </p>
            </div>
          ))}
        </div>
        <p className="muted">
          These samples use this session's authorized sanitized asset and the
          imported palette. They are separate from portable configuration
          publication. Temporary custody expires; durable PostgreSQL
          associations are not created.
        </p>
      </section>
      <section className="panel">
        <h3>Isolated fictional configuration preview</h3>
        <p>
          The real Engine creates an independent empty workspace under the
          existing three-preview quota. It keeps the built-in mark. No image,
          customer, crew, inventory or other operational record is copied.
        </p>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={async () => {
            setPending(true);
            setError("");
            try {
              setPreview(await onPreview(plan));
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Could not prepare preview.",
              );
            } finally {
              setPending(false);
            }
          }}
        >
          Prepare bundle configuration preview
        </button>
        {preview && (
          <p>
            <a href={preview} target="_blank" rel="noopener noreferrer">
              Open bundle configuration preview (new tab)
            </a>
          </p>
        )}
        <details>
          <summary>Compatibility and setup summary</summary>
          <pre className="blueprint-summary">{bundle.summary}</pre>
        </details>
      </section>
      {controller.error && (
        <p className="error" role="alert">
          {controller.error}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p role="status">{busy ? "Checking private review state…" : notice}</p>
    </div>
  );
}
