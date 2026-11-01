import { useEffect, useRef, useState } from "react";
import {
  impactLabels,
  migrationReport,
  type MigrationReview,
  type ImpactReviewInput,
} from "../core/migration-review";
import type { BuildPlan } from "../core/buildplan";
import { downloadJson } from "./project-panel";
import {
  RehearsalReview,
  type Rehearse,
  type RehearsalMemory,
} from "./rehearsal";
export type ReviewImpact = (
  input: ImpactReviewInput,
) => Promise<MigrationReview>;
export function DataImpactReview({
  initial,
  onReview,
  onBack,
  onPreview,
  onRehearse,
}: {
  initial: MigrationReview;
  onReview: ReviewImpact;
  onBack: () => void;
  onPreview: (plan: BuildPlan) => Promise<string>;
  onRehearse: Rehearse;
}) {
  const [report, setReport] = useState(initial),
    [pending, setPending] = useState(false),
    [stale, setStale] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [preview, setPreview] = useState("");
  const [rehearsing, setRehearsing] = useState(false);
  const rehearsalMemory = useRef<RehearsalMemory>({});
  const heading = useRef<HTMLHeadingElement>(null),
    sequence = useRef(0);
  useEffect(() => {
    heading.current?.focus();
  }, [rehearsing]);
  // A report is never a lease. Recheck periodically, on returning to the tab, and before each output.
  useEffect(() => {
    let live = true,
      checking = false;
    const check = async () => {
      if (
        document.visibilityState === "hidden" ||
        checking ||
        pending ||
        stale ||
        rehearsing
      )
        return;
      checking = true;
      const token = ++sequence.current;
      try {
        await onReview({
          document: report.proposed,
          draft: report.draft,
          expected: report.state,
        });
      } catch (e) {
        if (live && token === sequence.current) {
          setStale(true);
          setPreview("");
          setError(
            e instanceof Error
              ? e.message
              : "Freshness could not be verified. Refresh the review.",
          );
        }
      } finally {
        checking = false;
      }
    };
    const timer = setInterval(() => void check(), 15000);
    window.addEventListener("focus", check);
    return () => {
      live = false;
      sequence.current++;
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [onReview, report, pending, stale, rehearsing]);
  async function action(kind: "refresh" | "export" | "preview" | "verify") {
    sequence.current++;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const checked = await onReview({
        document: report.proposed,
        draft: report.draft,
        ...(kind !== "refresh" ? { expected: report.state } : {}),
      });
      setReport(checked);
      setStale(false);
      if (kind === "export") {
        downloadJson("lms-migration-impact.json", migrationReport(checked));
        setNotice(
          "Data-only planning report exported. Inspect configuration labels before sharing.",
        );
      } else if (kind === "preview") {
        setPreview(await onPreview(checked.proposed));
        setNotice(
          "Separate fictional preview prepared. Existing records and saved plans are unchanged.",
        );
      } else {
        setPreview("");
        setNotice(
          kind === "refresh"
            ? "Review refreshed from current authorized database metadata. No configuration was applied."
            : "Review matches the current database observation. It is still not publication approval.",
        );
      }
    } catch (e) {
      setStale(true);
      setPreview("");
      setError(
        e instanceof Error
          ? e.message
          : "Freshness could not be verified. Refresh the review.",
      );
    } finally {
      setPending(false);
    }
  }
  if (rehearsing)
    return (
      <RehearsalReview
        review={report}
        onReview={onReview}
        onRun={onRehearse}
        memory={rehearsalMemory.current}
        onBack={() => setRehearsing(false)}
      />
    );
  return (
    <div className="stack studio impact-review" aria-label="Data impact review">
      <section className="panel">
        <span className="eyebrow">
          Plan business changes · read-only and fictional
        </span>
        <h2 tabIndex={-1} ref={heading}>
          Review Data Impact
        </h2>
        <p>
          Compare your unsaved choices with published configuration revision{" "}
          {report.configurationRevision}. Your editor, drafts, records and
          history remain unchanged.
        </p>
        <h3>{impactLabels[report.overall]}</h3>
        <p>
          BuildPlan {report.proposed.version} / configuration{" "}
          {report.proposed.configuration.schemaVersion}. Compatible means the
          existing checks accept this observed proposal; it never means
          automatically safe or already approved.
        </p>
        {stale && (
          <p className="error" role="alert">
            This review is stale or freshness is unverified. Preview and export
            are disabled. Refresh, or reopen the latest saved draft if it
            changed.
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="actions">
          <button
            type="button"
            disabled={pending || stale || report.overall === "blocked"}
            onClick={() => setRehearsing(true)}
          >
            Rehearse Business Changes
          </button>
          <button
            type="button"
            className="secondary"
            disabled={pending}
            onClick={onBack}
          >
            Keep editing my plan
          </button>
          <button
            type="button"
            className="secondary"
            disabled={pending}
            onClick={() => void action("refresh")}
          >
            Refresh Data Impact
          </button>
          <button
            type="button"
            className="secondary"
            disabled={pending || stale}
            onClick={() => void action("verify")}
          >
            Verify Review Is Current
          </button>
        </div>
        <p role="status">
          {pending
            ? "Checking current authorized metadata…"
            : notice ||
              "Nothing has been saved, published or migrated by this review."}
        </p>
      </section>
      <section className="panel">
        <h3>Records affected by these configuration choices</h3>
        <p>
          Counts include retained active and archived records, even when a
          module is disabled. No customer names, record values or linked-record
          IDs are read into this planner.
        </p>
        <div className="studio-cards">
          {report.entities
            .filter(
              (e) =>
                e.enabled !== e.proposedEnabled ||
                report.changes.some((c) => c.entity === e.entity),
            )
            .map((e) => (
              <article
                className="studio-card"
                key={e.entity}
                aria-label={e.entity + " record presence"}
              >
                <h4>{e.label}</h4>
                <p>{e.entity}</p>
                <dl className="template-values">
                  <dt>Active records</dt>
                  <dd>{e.active}</dd>
                  <dt>Archived records</dt>
                  <dd>{e.archived}</dd>
                  <dt>Current module</dt>
                  <dd>
                    {e.enabled ? "Enabled" : "Disabled · records retained"}
                  </dd>
                  <dt>Proposed module</dt>
                  <dd>
                    {e.proposedEnabled
                      ? "Enabled"
                      : "Disabled · records retained"}
                  </dd>
                </dl>
              </article>
            ))}
        </div>
        {!report.entities.some(
          (e) =>
            e.enabled !== e.proposedEnabled ||
            report.changes.some((c) => c.entity === e.entity),
        ) && <p>No entity schema or module visibility changes are proposed.</p>}
      </section>
      <section className="panel">
        <h3>Proposed changes and recommended next steps</h3>
        {!report.changes.length && (
          <p>No configuration differences were found.</p>
        )}
        <div className="studio-cards">
          {report.changes.map((c, i) => (
            <article
              className="studio-card"
              key={i}
              aria-label={c.entity + ": " + c.change}
            >
              <span className="eyebrow">{impactLabels[c.category]}</span>
              <h4>{c.change}</h4>
              <p>Affected entity: {c.entity}</p>
              <dl className="template-values">
                <dt>Published configuration</dt>
                <dd>
                  <code>{c.before}</code>
                </dd>
                <dt>Proposed configuration</dt>
                <dd>
                  <code>{c.after}</code>
                </dd>
              </dl>
              <p>{c.reason}</p>
              <p>
                <strong>Next step:</strong> {c.nextStep}
              </p>
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <h3>Existing relationships and protected history</h3>
        <ul>
          {report.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
        <details>
          <summary>Reviewed reference contracts</summary>
          <ul>
            {report.current.entities.flatMap((e) =>
              e.fields
                .filter((f) => f.type === "reference")
                .map((f) => (
                  <li key={e.id + f.key}>
                    {e.id}.{f.key} → {f.target} (
                    {f.required ? "required" : "optional"}); existing
                    organization and archive protections remain.
                  </li>
                )),
            )}
          </ul>
        </details>
        <p>
          Exports include validated configuration labels and warnings. Record
          counts, IDs, values, contact details, actors and freshness
          fingerprints are omitted. User-entered configuration text may be
          private; inspect the downloaded file before sharing.
        </p>
        <div className="actions">
          <button
            type="button"
            disabled={pending || stale || report.overall === "blocked"}
            onClick={() => void action("preview")}
          >
            Preview Changes Without Applying
          </button>
          <button
            type="button"
            className="secondary"
            disabled={pending || stale}
            onClick={() => void action("export")}
          >
            Export Migration Planning Report
          </button>
        </div>
        {preview && (
          <a href={preview} target="_blank" rel="noopener noreferrer">
            Open data impact preview (new tab)
          </a>
        )}
        <p>
          Preview uses the existing three-slot session quota and starts empty. A
          report requiring migration review can be previewed separately, but
          cannot publish a populated-schema change. Return to Studio for
          existing save, impact, permission and explicit publication controls.
        </p>
      </section>
    </div>
  );
}
