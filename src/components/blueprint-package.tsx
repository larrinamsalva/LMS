import { useEffect, useRef, useState } from "react";
import type { WorkspaceSnapshot } from "../core/engine";
import { configurationImpact } from "../core/config";
import type { BuildPlan } from "../core/buildplan";
import { manifests } from "../modules/registry";
import {
  blueprintModules,
  compareBlueprints,
  reviewGalleryCompatibility,
  type BlueprintPackage,
  type BlueprintDetails,
  type BlueprintDifference,
} from "../core/blueprint";
export function BlueprintPackageTools({
  details,
  busy,
  valid,
  onDetails,
  onDownload,
  onImport,
}: {
  details: BlueprintDetails;
  busy: boolean;
  valid: boolean;
  onDetails: (d: BlueprintDetails) => void;
  onDownload: () => void;
  onImport: (file: File) => void;
}) {
  return (
    <section className="panel" aria-labelledby="blueprint-tools-heading">
      <h2 id="blueprint-tools-heading">Keep and reuse your blueprint</h2>
      <p>
        Download a small ZIP containing your validated choices, a feature
        summary and compatibility checks. It contains no workspace records or
        account credentials. Nothing is saved or published by downloading.
      </p>
      <p className="muted">
        Use fictional text only; do not put private information or secrets in
        names, descriptions or labels. This is configuration packaging, not an
        installable application or database backup.
      </p>
      <div className="form-grid">
        <div>
          <label htmlFor="blueprint-name">Blueprint name</label>
          <input
            id="blueprint-name"
            value={details.name}
            placeholder="Uses the business name if left blank"
            maxLength={80}
            disabled={busy}
            onChange={(e) => onDetails({ ...details, name: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="blueprint-description">Blueprint description</label>
          <input
            id="blueprint-description"
            value={details.description}
            maxLength={600}
            disabled={busy}
            onChange={(e) =>
              onDetails({ ...details, description: e.target.value })
            }
          />
        </div>
      </div>
      <button
        className="secondary"
        type="button"
        disabled={busy || !valid || !details.description.trim()}
        onClick={onDownload}
      >
        Download Blueprint Package
      </button>
      <p>
        <label htmlFor="blueprint-import">Import Blueprint Package</label>
        <input
          id="blueprint-import"
          type="file"
          accept=".zip,application/zip"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onImport(file);
          }}
        />
      </p>
      <p className="muted">
        Up to 96 KiB. Only the unchanged LMS stored-ZIP profile is supported.
        Every file, checksum, version and dependency is checked before review.
        Checksums are not author signatures. BuildPlan v1 JSON import/export
        remains available below.
      </p>
      <p className="muted">
        The blueprint name, description and Gallery hint travel in the ZIP only.
        Temporary saved drafts retain BuildPlan choices; reimport the ZIP to
        reopen its package details.
      </p>
    </section>
  );
}
function Differences({
  rows,
  current = "Current",
  incoming = "Blueprint",
}: {
  rows: BlueprintDifference[];
  current?: string;
  incoming?: string;
}) {
  return rows.length ? (
    <div className="blueprint-differences">
      {rows.map((row) => (
        <div className="studio-review" key={row.label}>
          <h4>{row.label}</h4>
          <dl>
            <dt>{current}</dt>
            <dd>{row.before}</dd>
            <dt>{incoming}</dt>
            <dd>{row.after}</dd>
          </dl>
        </div>
      ))}
    </div>
  ) : (
    <p>No configuration differences.</p>
  );
}
export function BlueprintReview({
  blueprint,
  workspace,
  choices,
  onCancel,
  onUse,
  onPreview,
}: {
  blueprint: BlueprintPackage;
  workspace: WorkspaceSnapshot;
  choices: BuildPlan;
  onCancel: () => void;
  onUse: () => void;
  onPreview: (plan: BuildPlan) => Promise<string>;
}) {
  const heading = useRef<HTMLHeadingElement>(null),
    [pending, setPending] = useState(false),
    [url, setUrl] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const { plan, manifest } = blueprint,
    impact = configurationImpact(
      workspace.config.document,
      plan.configuration,
      workspace.populatedEntities,
    ),
    gallery = reviewGalleryCompatibility(plan, manifest.blueprint.gallery),
    workspaceDifferences = compareBlueprints(
      workspace.config.document,
      plan.configuration,
    );
  return (
    <div className="stack studio" aria-label="Blueprint compatibility review">
      <section className="panel">
        <span className="eyebrow">
          Validated configuration package · no automatic updates
        </span>
        <h2 ref={heading} tabIndex={-1}>
          Review Blueprint
        </h2>
        <h3>{manifest.blueprint.name}</h3>
        <p>{manifest.blueprint.description}</p>
        <p>
          Business type:{" "}
          {
            {
              property: "Property Management",
              cleaning: "Cleaning Business",
              custom: "Custom Business",
            }[plan.template]
          }
          . BuildPlan {plan.version} · Engine API 1 · Template 1 · Configuration
          schema {plan.configuration.schemaVersion}.
        </p>
        <p>
          Your editor choices, saved drafts, records and published configuration
          have not changed. Using this package replaces only unsaved editor
          choices. Cancel returns to those choices.
        </p>
        <p className="muted">
          File integrity and supported configuration have been checked. Package
          text and Gallery references are untrusted input; no author identity or
          endorsement is verified.
        </p>
        <div className="actions">
          <button type="button" disabled={pending} onClick={onUse}>
            Use as unsaved Studio choices
          </button>
          <button
            className="secondary"
            type="button"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel blueprint import
          </button>
          <a href="#blueprint-preview">Jump to workspace preview</a>
        </div>
      </section>
      <section className="panel">
        <h3>Included features and required dependencies</h3>
        <ul>
          {blueprintModules(plan).map((m) => (
            <li key={m.id}>
              <strong>{manifests.find((n) => n.id === m.id)?.name}</strong> ·{" "}
              {m.version}. {manifests.find((n) => n.id === m.id)?.description}{" "}
              Requires:{" "}
              {m.dependencies
                .map((id) => manifests.find((n) => n.id === id)?.name ?? id)
                .join(", ") || "no additional modules"}
              .
            </li>
          ))}
        </ul>
        <p className="muted">
          Unsupported versions, modules and missing dependencies are rejected
          before this screen. Hosting, executable app export, image-logo
          uploads, AI generation, production authentication, payments and
          messaging remain unavailable.
        </p>
      </section>
      <section className="panel" aria-labelledby="blueprint-workspace-impact">
        <h3 id="blueprint-workspace-impact">
          Differences from the current workspace
        </h3>
        {impact.identityChanged && (
          <p className="error">
            Different project identity: this blueprint cannot replace this
            workspace. Use its separate preview.
          </p>
        )}
        {impact.migrationEntities.length > 0 && (
          <p className="error">
            Database migration review required for populated records:{" "}
            {impact.migrationEntities.join(", ")}. Publication will refuse these
            schema changes.
          </p>
        )}
        {impact.disabledModules.length > 0 && (
          <p>
            Disabled modules retain records and history:{" "}
            {impact.disabledModules.join(", ")}.
          </p>
        )}
        <p>
          Importing is safe to inspect. Publishing still requires an unchanged
          saved draft, current revision, explicit confirmation and the final
          Engine migration-impact check.
        </p>
        <details>
          <summary>
            Inspect {workspaceDifferences.length} configuration differences
          </summary>
          <Differences rows={workspaceDifferences} />
        </details>
        <details>
          <summary>Compare with my unsaved Studio choices</summary>
          <Differences
            rows={compareBlueprints(choices.configuration, plan.configuration)}
          />
        </details>
      </section>
      <section className="panel">
        <h3>Reviewed Gallery comparison</h3>
        <p>{gallery.message}</p>
        <p className="muted">
          A Gallery reference is an unverified hint supplied by the package.
          This compares your customized choices with the currently bundled,
          reviewed starter; it is not a three-way merge or a recommended
          upgrade. No choice is replaced automatically.
        </p>
        {manifest.blueprint.gallery && (
          <details>
            <summary>Compare my blueprint with the bundled starter</summary>
            <Differences
              rows={gallery.differences}
              current="My blueprint"
              incoming="Bundled starter"
            />
          </details>
        )}
      </section>
      <section className="panel">
        <h3 id="blueprint-preview" tabIndex={-1}>
          Try this exact configuration
        </h3>
        <p>
          The actual shared Engine creates an empty, isolated fictional
          workspace. The existing three-preview session quota applies.
        </p>
        <button
          className="secondary"
          type="button"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError("");
            try {
              setUrl(await onPreview(plan));
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "Could not prepare the preview.",
              );
            } finally {
              setPending(false);
            }
          }}
        >
          Prepare blueprint preview
        </button>
        <p role="status">
          {pending
            ? "Preparing fictional preview…"
            : url
              ? "Preview ready; your Studio choices have not changed."
              : ""}
        </p>
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer">
            Open blueprint workspace preview (new tab)
          </a>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <details>
          <summary>Human-readable setup and feature summary</summary>
          <pre className="blueprint-summary">{blueprint.summary}</pre>
        </details>
      </section>
    </div>
  );
}
