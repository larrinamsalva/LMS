import { useEffect, useRef, useState } from "react";
import type { BuildPlan } from "../core/buildplan";
import type { WorkspaceSnapshot } from "../core/engine";
import { configurationImpact } from "../core/config";
import { blueprintJson } from "../core/blueprint";
import {
  latestTemplate,
  type TemplateSnapshot,
} from "../core/template-history";
import {
  reviewTemplateUpdate,
  proposeTemplateUpdate,
  useTemplateChanges,
  templateValue,
} from "../core/template-update";
const labels = {
  suggestion: "No conflict detected · optional suggestion",
  conflict: "Conflict · both versions changed",
  customized: "Your customization · keep unless deliberately replaced",
  informational: "Informational · starting point is unverified",
};
export interface TemplateUpdateSession {
  history: TemplateSnapshot[];
  baseline?: TemplateSnapshot;
  plan: BuildPlan;
  configRevision: number;
  preferredId?: string;
  hint?: { id: string; revision: number };
}
export function TemplateUpdates({
  session,
  workspace,
  onKeep,
  onUse,
  onPreview,
}: {
  session: TemplateUpdateSession;
  workspace: WorkspaceSnapshot;
  onKeep: () => void;
  onUse: (next: BuildPlan, captured: TemplateUpdateSession) => void;
  onPreview: (plan: BuildPlan) => Promise<string>;
}) {
  const [id, setId] = useState(
      session.baseline?.entry.metadata.id ??
        session.preferredId ??
        (session.history.some((h) => h.entry.metadata.id === session.hint?.id)
          ? session.hint!.id
          : undefined) ??
        session.history.find(
          (h) => h.entry.plan.template === session.plan.template,
        )!.entry.metadata.id,
    ),
    [reviewed, setReviewed] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [confirmed, setConfirmed] = useState(false),
    [allowVersion, setAllowVersion] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [reviewed]);
  const target = latestTemplate(session.history, id),
    baseline =
      session.baseline?.entry.metadata.id === id ? session.baseline : undefined;
  if (!target)
    return (
      <section className="panel">
        <h2>Template unavailable</h2>
        <p role="alert">
          This hint is not a supported local template. No update was applied.
        </p>
        <button type="button" onClick={onKeep}>
          Keep My Version
        </button>
      </section>
    );
  const review = reviewTemplateUpdate(
      session.plan,
      target,
      baseline,
      session.configRevision,
    ),
    incompatible =
      session.plan.template !== target.entry.plan.template ||
      session.plan.configuration.id !== target.entry.plan.configuration.id;
  let candidate: BuildPlan | undefined,
    blocked = "";
  try {
    candidate = proposeTemplateUpdate(review, selected);
  } catch (e) {
    blocked = e instanceof Error ? e.message : "Incompatible choices.";
  }
  const impact =
      candidate &&
      configurationImpact(
        workspace.config.document,
        candidate.configuration,
        workspace.populatedEntities,
      ),
    versionChange = candidate && candidate.version !== session.plan.version,
    disabledWithData =
      impact?.disabledModules.filter((module) =>
        workspace.config.document.entities.some(
          (e) =>
            e.module === module && workspace.populatedEntities.includes(e.id),
        ),
      ) ?? [];
  if (candidate && selected.length) {
    try {
      useTemplateChanges(review, selected, {
        current: session.plan,
        config: workspace.config.document,
        populated: workspace.populatedEntities,
        revision: workspace.config.revision,
        allowVersionChange: allowVersion,
      });
    } catch (e) {
      blocked = e instanceof Error ? e.message : "Review cannot be used.";
    }
  }
  const unchanged = !candidate || blueprintJson(candidate) === review.editor;
  async function prepare(plan: BuildPlan) {
    setPending(true);
    setError("");
    try {
      setPreview(await onPreview(plan));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview unavailable.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div
      className="stack studio template-update"
      aria-label="Template update review"
    >
      <section className="panel">
        <span className="eyebrow">
          Local reviewed source history · no automatic update
        </span>
        <h2 ref={heading} tabIndex={-1}>
          {reviewed ? "Review New Version" : "Check for Template Updates"}
        </h2>
        <p>
          Your current editor choices, saved drafts and business records are
          unchanged. Every suggested replacement starts unchecked.
        </p>
        <label htmlFor="template-update-id">Reviewed business starter</label>
        <select
          id="template-update-id"
          value={id}
          disabled={pending}
          onChange={(e) => {
            setId(e.target.value);
            setSelected([]);
            setConfirmed(false);
            setAllowVersion(false);
            setReviewed(false);
            setPreview("");
          }}
        >
          {[...new Set(session.history.map((h) => h.entry.metadata.id))].map(
            (key) => (
              <option key={key} value={key}>
                {latestTemplate(session.history, key)!.entry.metadata.name}
              </option>
            ),
          )}
        </select>
        <h3>
          {target.entry.metadata.name} · Reviewed revision{" "}
          {target.entry.metadata.revision}
        </h3>
        {baseline ? (
          <p className="template-baseline">
            <strong>Verified saved baseline:</strong> revision{" "}
            {baseline.entry.metadata.revision}. Your immutable saved revision
            one exactly matches this bundled snapshot. This establishes a
            comparison baseline, not author identity or imported-package
            provenance.
          </p>
        ) : (
          <p className="template-baseline">
            <strong>Starting point not verified.</strong> No complete saved
            history with an exact reviewed revision-one snapshot was found for
            this draft. This is an informational two-way comparison.
            Package/Gallery hints alone cannot establish ancestry.
          </p>
        )}
        {session.hint && !baseline && (
          <p className="muted">
            Unverified hint: {session.hint.id}, revision {session.hint.revision}
            . It does not authorize an update.
          </p>
        )}
        {baseline && (
          <p>
            {target.entry.metadata.revision > baseline.entry.metadata.revision
              ? "A newer locally reviewed version is available."
              : "No newer local revision exists for this saved baseline."}
          </p>
        )}
        <p>
          Current choices: BuildPlan {session.plan.version} / configuration{" "}
          {session.plan.configuration.schemaVersion}. New starter: BuildPlan{" "}
          {target.reader.buildPlan} / configuration{" "}
          {target.reader.configurationSchema}. Engine API{" "}
          {target.reader.engineApi} / template {target.reader.templateVersion}.
          Only supported module versions are accepted.
        </p>
        {incompatible && (
          <p className="error">
            Different industry/project identity. This starter cannot update
            these choices or replace the current business.
          </p>
        )}
        <div className="actions">
          <button
            type="button"
            className="secondary"
            disabled={pending}
            onClick={onKeep}
          >
            Keep My Version
          </button>
          {!reviewed && (
            <button
              type="button"
              disabled={pending}
              onClick={() => setReviewed(true)}
            >
              Review New Version
            </button>
          )}
        </div>
      </section>
      <section className="panel">
        <h3>What the reviewed starter changes</h3>
        <ul>
          {target.changes.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <details>
          <summary>Local template history and content digests</summary>
          <ul className="template-digests">
            {session.history
              .filter((h) => h.entry.metadata.id === id)
              .sort(
                (a, b) => a.entry.metadata.revision - b.entry.metadata.revision,
              )
              .map((h) => (
                <li key={h.entry.metadata.revision}>
                  Revision {h.entry.metadata.revision} · BuildPlan{" "}
                  {h.reader.buildPlan} · configuration{" "}
                  {h.reader.configurationSchema}
                  <br />
                  Content SHA-256: <code>{h.sha256}</code>
                  <br />
                  Plan SHA-256: <code>{h.planSha256}</code>
                  <br />
                  Modules:{" "}
                  {h.reader.modules
                    .map((m) => `${m.id}@${m.version}`)
                    .join(", ")}
                </li>
              ))}
          </ul>
          <p className="muted">
            Digests are pinned in the reviewed application source. They do not
            authenticate a ZIP author, resist compromise of that source, or act
            as credential-history witnesses.
          </p>
        </details>
      </section>
      {reviewed && (
        <>
          <section className="panel">
            <h3>Choose changes deliberately</h3>
            <p>
              Optional suggestions have no detected conflict with the saved
              baseline. Conflicts and your own customizations require human
              review. Nothing is merged automatically.
            </p>
            {!review.changes.length && (
              <p>No differences from your current choices.</p>
            )}
            <div className="studio-cards">
              {review.changes.map((change) => (
                <article
                  className="studio-card"
                  key={change.id}
                  aria-label={change.label}
                >
                  <span className="eyebrow">{change.category}</span>
                  <h4>{change.label}</h4>
                  <p>
                    <strong>{labels[change.classification]}</strong>
                  </p>
                  <dl className="template-values">
                    {baseline && (
                      <>
                        <dt>Old reviewed starter</dt>
                        <dd>{templateValue(change.before)}</dd>
                      </>
                    )}
                    <dt>My choices</dt>
                    <dd>{templateValue(change.current)}</dd>
                    <dt>New reviewed starter</dt>
                    <dd>{templateValue(change.next)}</dd>
                  </dl>
                  {change.reason && <p className="muted">{change.reason}</p>}
                  <label className="check-label">
                    <input
                      type="checkbox"
                      disabled={pending || incompatible || !change.supported}
                      checked={selected.includes(change.id)}
                      aria-label={`Use new ${change.label}`}
                      onChange={(e) => {
                        setSelected((ids) =>
                          e.target.checked
                            ? [...ids, change.id]
                            : ids.filter((s) => s !== change.id),
                        );
                        setConfirmed(false);
                        setPreview("");
                      }}
                    />{" "}
                    Use this replacement
                  </label>
                  {!change.supported && (
                    <p className="error">
                      This contract is locked or unsupported; it cannot be
                      selected.
                    </p>
                  )}
                </article>
              ))}
            </div>
          </section>
          <section className="panel">
            <h3>Effects on this fictional workspace</h3>
            <p>
              Reviewed against configuration revision {session.configRevision}.
              Save and publication will check current database revisions again.
            </p>
            {impact?.identityChanged && (
              <p className="error">
                The current workspace has a different project identity. These
                choices can be saved/previewed separately; publication here
                remains blocked.
              </p>
            )}
            {!!impact?.migrationEntities.length && (
              <p className="error">
                Database migration review required for populated entities:{" "}
                {impact.migrationEntities.join(", ")}. Deselect those field
                changes. No migration or record rewrite is performed.
              </p>
            )}
            {disabledWithData.length > 0 && (
              <p className="error">
                Selected module changes hide populated data:{" "}
                {disabledWithData.join(", ")}. All records/history are retained;
                disabling is applied only if you explicitly confirm these
                choices.
              </p>
            )}
            {versionChange && (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={allowVersion}
                  disabled={pending}
                  onChange={(e) => {
                    setAllowVersion(e.target.checked);
                    setConfirmed(false);
                  }}
                />{" "}
                I explicitly approve changing BuildPlan/package version{" "}
                {session.plan.version} to {candidate!.version}.
              </label>
            )}
            {selected.length > 0 && blocked && (
              <p className="error" role="alert">
                {blocked}
              </p>
            )}
            <label className="check-label">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={pending || !selected.length || !!blocked || unchanged}
                onChange={(e) => setConfirmed(e.target.checked)}
              />{" "}
              I reviewed these selected replacements, including conflicts and
              data effects. Use them only as unsaved choices.
            </label>
            <div className="actions">
              <button
                type="button"
                disabled={
                  pending ||
                  !confirmed ||
                  !!blocked ||
                  unchanged ||
                  !selected.length
                }
                onClick={() => {
                  try {
                    const next = useTemplateChanges(review, selected, {
                      current: session.plan,
                      config: workspace.config.document,
                      populated: workspace.populatedEntities,
                      revision: workspace.config.revision,
                      allowVersionChange: allowVersion,
                    });
                    onUse(next, session);
                  } catch (e) {
                    setError(
                      e instanceof Error ? e.message : "Update refused.",
                    );
                  }
                }}
              >
                Use Reviewed Changes
              </button>
              <button
                className="secondary"
                type="button"
                disabled={pending || !candidate || unchanged}
                onClick={() => candidate && void prepare(candidate)}
              >
                Preview selected choices
              </button>
              <button
                className="secondary"
                type="button"
                disabled={pending}
                onClick={() => void prepare(target.entry.plan)}
              >
                Preview full reviewed starter
              </button>
            </div>
            <p className="muted">
              Previews use fresh fictional Engine workspaces under the existing
              three-slot quota. Preparing a preview applies nothing to this
              business. Save the changed draft, then separately review and
              confirm publication.
            </p>
            {preview && (
              <a href={preview} target="_blank" rel="noopener noreferrer">
                Open template update preview (new tab)
              </a>
            )}
            <p role="status">
              {pending
                ? "Preparing preview…"
                : `${selected.length} replacement(s) selected; none saved or published.`}
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
