import { useEffect, useRef, useState } from "react";
import {
  buildRehearsalPlan,
  readiness,
  rehearsalChecks,
  rehearsalReport,
  rehearsalResultSchema,
  type RehearsalInput,
  type RehearsalResult,
} from "../core/rehearsal";
import type { MigrationReview } from "../core/migration-review";
import type { ReviewImpact } from "./migration-review";
import { downloadJson } from "./project-panel";
import { blueprintJson } from "../core/blueprint";
export interface RehearsalMemory {
  key?: string;
  operationId?: string;
  result?: RehearsalResult;
}
export type Rehearse = (input: RehearsalInput) => Promise<RehearsalResult>;
export function RehearsalReview({
  review,
  onReview,
  onRun,
  onBack,
  memory,
}: {
  review: MigrationReview;
  onReview: ReviewImpact;
  onRun: Rehearse;
  onBack: () => void;
  memory: RehearsalMemory;
}) {
  const key = blueprintJson({
    proposed: review.proposed,
    state: review.state,
    draft: review.draft,
  });
  const [result, setResult] = useState<RehearsalResult | undefined>(() =>
      memory.key === key ? memory.result : undefined,
    ),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [stale, setStale] = useState(false),
    [notice, setNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null),
    operation = useRef<string | null>(
      memory.key === key ? (memory.operationId ?? null) : null,
    ),
    plan = buildRehearsalPlan(review);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  function request(): RehearsalInput {
    return {
      document: review.proposed,
      draft: review.draft,
      expected: review.state,
      operationId: operation.current!,
    };
  }
  async function run(kind: "run" | "export" | "again") {
    setPending(true);
    setError("");
    setNotice("");
    try {
      await onReview({
        document: review.proposed,
        draft: review.draft,
        expected: review.state,
      });
      if (!operation.current || kind === "again")
        operation.current = crypto.randomUUID();
      memory.key = key;
      memory.operationId = operation.current;
      const current = rehearsalResultSchema.parse(await onRun(request()));
      setResult(current);
      memory.result = current;
      setStale(false);
      if (kind === "export") {
        downloadJson(
          "lms-fictional-rehearsal.json",
          rehearsalReport(review, current),
        );
        setNotice(
          "Rehearsal report downloaded. It contains no operational records or migration commands.",
        );
      } else
        setNotice(
          current.status === "completed"
            ? "Fictional checks completed. Existing data compatibility, backup evidence, authorization and production acceptance remain separate."
            : "The rehearsal failed. No source configuration or records were changed. Failed cases are retained for exact retry and use one sandbox slot.",
        );
    } catch (e) {
      setStale(true);
      setError(
        e instanceof Error
          ? e.message
          : "Rehearsal is unavailable. Return and explicitly refresh the data-impact review.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div
      className="stack studio impact-review"
      aria-label="Fictional rehearsal review"
    >
      <section className="panel">
        <span className="eyebrow">
          Separate fictional fixture checks · no migration executor
        </span>
        <h2 ref={heading} tabIndex={-1}>
          Rehearse Business Changes
        </h2>
        <p>
          Configuration preview starts empty. Fictional rehearsal creates only
          generated test records in another temporary workspace. Real migration
          execution would transform existing business data and is unavailable.
        </p>
        <p>
          Current business: {review.current.name}, configuration{" "}
          {review.configurationRevision}. Proposed:{" "}
          {review.proposed.configuration.name}, BuildPlan{" "}
          {review.proposed.version} / schema{" "}
          {review.proposed.configuration.schemaVersion}.
        </p>
        {review.overall !== "compatible" && (
          <p className="error">
            The existing populated-schema or identity blocker remains. A
            fictional rehearsal never authorizes publication to this business.
          </p>
        )}
        <div className="actions">
          <button
            type="button"
            className="secondary"
            disabled={pending}
            onClick={onBack}
          >
            Return to Data Impact
          </button>
          <button
            type="button"
            disabled={
              pending || stale || !!result || review.overall === "blocked"
            }
            onClick={() => void run("run")}
          >
            Run Fictional Rehearsal
          </button>
          {operation.current && (
            <button
              type="button"
              className="secondary"
              disabled={pending}
              onClick={() => void run("run")}
            >
              Recheck Retained Rehearsal
            </button>
          )}
          {operation.current && (
            <button
              type="button"
              className="secondary"
              disabled={pending || review.overall === "blocked"}
              onClick={() => void run("again")}
            >
              Start New Fictional Rehearsal
            </button>
          )}
          <button
            type="button"
            className="secondary"
            disabled={pending || stale || !result}
            onClick={() => void run("export")}
          >
            Download Rehearsal Report
          </button>
        </div>
        <p role="status">
          {pending
            ? "Checking versions and running generated fictional fixtures…"
            : notice || "Nothing has been rehearsed or applied."}
        </p>
        {error && (
          <p role="alert" className="error">
            {error} Return to Data Impact for an explicit refresh if the source
            changed. A new rehearsal consumes another shared sandbox slot.
          </p>
        )}
        {result?.workspace && !stale && (
          <a
            href={`/?organizationId=${encodeURIComponent(result.workspace.organizationId)}&preview=1`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open generated fictional rehearsal workspace (new tab)
          </a>
        )}
        <p>
          Previews and rehearsals share the existing limit of three fresh
          sandboxes. Exact retries reuse one case. Download before editing
          generated records: manual changes invalidate the retained rehearsal
          observation.
        </p>
      </section>
      <section className="panel">
        <h3>Upgrade Readiness Checklist</h3>
        <div className="studio-cards">
          {readiness(review, result).map((row) => (
            <article
              className="studio-card"
              key={row.item}
              aria-label={row.item}
            >
              <h4>{row.item}</h4>
              <p>
                <strong>{row.status}</strong>
              </p>
              <p>{row.detail}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <h3>Supported fictional checks</h3>
        <div className="studio-cards">
          {plan.scenarios.map((s) => (
            <article className="studio-card" key={s.id} aria-label={s.label}>
              <h4>{s.label}</h4>
              <p>
                <strong>
                  {result?.outcomes.find((c) => c.id === s.id)?.status ??
                    "not-run"}
                </strong>
              </p>
              <p>Expected check: {s.detail}</p>
              <p className="muted">
                A disabled module is not-applicable, not a passed scenario.
              </p>
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <h3>Structured rehearsal plan</h3>
        <details>
          <summary>Proposed changes and affected definitions</summary>
          <ul>
            {plan.changes.map((c, i) => (
              <li key={i}>
                {c.entity}: {c.change} · {c.category}. {c.reason}
              </li>
            ))}
          </ul>
          <ul>
            {plan.modules.map((m) => (
              <li key={m.id}>
                {m.id}@{m.version}; dependencies:{" "}
                {m.dependencies.join(", ") || "none"}
              </li>
            ))}
          </ul>
          <p>
            Current and proposed configurations and entity definitions are
            included in the data-only report. No source rows are read or copied
            into fixtures.
          </p>
        </details>
        <details>
          <summary>Relationship and data protection requirements</summary>
          <ul>
            {plan.relationships.map((r) => (
              <li key={r.entity + r.field}>
                {r.entity}.{r.field} → {r.target};{" "}
                {r.required ? "required" : "optional"}. Existing organization
                and archive constraints remain.
              </li>
            ))}
          </ul>
          <ul>
            {plan.protections.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </details>
        <details>
          <summary>Required backup and restore checks</summary>
          <ul>
            {plan.backupRestoreRequirements.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </details>
        <details>
          <summary>Expected validation and remaining blockers</summary>
          <ul>
            {[...plan.postChangeChecks, ...plan.blockers].map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </details>
        <p>
          Reports contain configuration labels, static scenario descriptions and
          outcomes, not source or generated operational rows, credentials, raw
          errors or executable commands. Inspect user-entered labels before
          sharing.
        </p>
      </section>
    </div>
  );
}
