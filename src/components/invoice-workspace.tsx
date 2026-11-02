import { useEffect, useId, useRef, useState } from "react";
import type { WorkspaceRecord } from "../core/engine";
import {
  correctInvoicePricing,
  invoiceLabel,
  type InvoiceCommand,
  type InvoiceVersion,
} from "../core/invoices";
import {
  decimalToMinor,
  minorToDecimal,
  money,
  type EstimatePricing,
} from "../core/pricing";
import { EstimatePreview } from "./pricing-workspace";
export function InvoiceAction({
  record,
  kind,
  configRevision,
  busy,
  onClose,
  onSave,
}: {
  record: WorkspaceRecord;
  kind: InvoiceCommand["kind"];
  configRevision: number;
  busy: boolean;
  onClose: () => void;
  onSave: (input: InvoiceCommand, operationId: string) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    title = useId(),
    command = useRef<{ text: string; id: string } | null>(null);
  const original = record.data.pricing as EstimatePricing;
  const [quantities, setQuantities] = useState(
    original.lines.map((l) => l.quantity),
  );
  const [lineNotes, setLineNotes] = useState(original.lines.map((l) => l.note));
  const [notes, setNotes] = useState(String(record.data.notes ?? "")),
    [reason, setReason] = useState("");
  const [discountKind, setDiscountKind] = useState(original.discount.kind),
    [discount, setDiscount] = useState(minorToDecimal(original.discount.value));
  const [taxMode, setTaxMode] = useState(original.tax.mode),
    [taxRate, setTaxRate] = useState(minorToDecimal(original.tax.basisPoints)),
    [taxLabel, setTaxLabel] = useState(original.tax.label);
  const [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  let pricing = original,
    calculationError = "";
  if (kind === "correct")
    try {
      pricing = correctInvoicePricing(original, {
        ...original,
        lines: original.lines.map((l, i) => ({
          ...l,
          quantity: quantities[i],
          note: lineNotes[i],
        })),
        discount: {
          kind: discountKind,
          value: discountKind === "None" ? "0" : decimalToMinor(discount),
        },
        tax: {
          mode: taxMode,
          basisPoints: taxMode === "None" ? "0" : decimalToMinor(taxRate),
          label: taxMode === "None" ? "" : taxLabel,
        },
      });
    } catch (e) {
      calculationError = e instanceof Error ? e.message : "Check the amounts";
    }
  return (
    <dialog
      ref={ref}
      className="invoice-dialog"
      aria-labelledby={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!confirmed || calculationError || busy) return;
          const common = {
            configRevision,
            acknowledgement: invoiceLabel,
          } as const;
          const input: InvoiceCommand =
            kind === "convert"
              ? {
                  ...common,
                  kind,
                  estimateId: record.id,
                  estimateRevision: record.revision,
                }
              : kind === "void"
                ? {
                    ...common,
                    kind,
                    invoiceId: record.id,
                    revision: record.revision,
                    reason,
                  }
                : {
                    ...common,
                    kind,
                    invoiceId: record.id,
                    revision: record.revision,
                    reason,
                    notes,
                    pricing,
                  };
          const text = JSON.stringify(input);
          if (command.current?.text !== text)
            command.current = { text, id: crypto.randomUUID() };
          setError("");
          try {
            await onSave(input, command.current.id);
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "Request failed; retry the exact reviewed request.",
            );
          }
        }}
      >
        <h2 id={title}>
          {kind === "convert"
            ? "Review estimate conversion"
            : kind === "correct"
              ? "Correct invoice draft"
              : "Void invoice draft"}
        </h2>
        <strong>{invoiceLabel}</strong>
        <p>
          {String(record.data.title)} · source revision {record.revision}
        </p>
        <p>
          {original.customerName}
          {original.workTitle ? " · " + original.workTitle : ""}
        </p>
        <p>
          Saved prices stay fixed. No invoice is issued, sent or charged. This
          is not a legally compliant invoice or receipt.
        </p>
        {kind === "correct" ? (
          <>
            {original.lines.map((l, i) => (
              <fieldset key={l.id}>
                <legend>
                  {l.snapshot.name} · {money(l.snapshot.amountMinor)} /{" "}
                  {l.snapshot.unit}
                </legend>
                <label>
                  Line {i + 1} quantity
                  <input
                    required
                    inputMode="decimal"
                    value={quantities[i]}
                    onChange={(e) =>
                      setQuantities((v) =>
                        v.map((q, n) => (n === i ? e.target.value : q)),
                      )
                    }
                  />
                </label>
                <label>
                  Line {i + 1} internal note
                  <input
                    maxLength={500}
                    value={lineNotes[i]}
                    onChange={(e) =>
                      setLineNotes((v) =>
                        v.map((q, n) => (n === i ? e.target.value : q)),
                      )
                    }
                  />
                </label>
              </fieldset>
            ))}
            <div className="field-grid">
              <label>
                Discount type
                <select
                  value={discountKind}
                  onChange={(e) =>
                    setDiscountKind(e.target.value as typeof discountKind)
                  }
                >
                  <option>None</option>
                  <option>Amount</option>
                  <option>Percent</option>
                </select>
              </label>
              {discountKind !== "None" && (
                <label>
                  {discountKind === "Amount"
                    ? "Discount (USD)"
                    : "Discount percent"}
                  <input
                    inputMode="decimal"
                    required
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                  />
                </label>
              )}
              <label>
                Tax handling
                <select
                  value={taxMode}
                  onChange={(e) => setTaxMode(e.target.value as typeof taxMode)}
                >
                  <option>None</option>
                  <option>Manual</option>
                </select>
              </label>
              {taxMode === "Manual" && (
                <>
                  <label>
                    Manual tax percent
                    <input
                      required
                      inputMode="decimal"
                      value={taxRate}
                      onChange={(e) => setTaxRate(e.target.value)}
                    />
                  </label>
                  <label>
                    Manual tax label
                    <input
                      required
                      maxLength={80}
                      value={taxLabel}
                      onChange={(e) => setTaxLabel(e.target.value)}
                    />
                  </label>
                </>
              )}
            </div>
            <label>
              Internal notes
              <textarea
                maxLength={4000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </>
        ) : (
          <ol>
            {original.lines.map((l) => (
              <li key={l.id}>
                {l.snapshot.name}: {l.quantity} ×{" "}
                {money(l.snapshot.amountMinor)} = {money(l.amountMinor)}
              </li>
            ))}
          </ol>
        )}
        <div
          className="subdued"
          aria-label="Invoice calculation"
          aria-live="polite"
        >
          Subtotal {money(pricing.subtotalMinor)} · Discount{" "}
          {money(pricing.discountMinor)} · Manual tax {money(pricing.taxMinor)}
          <p>
            <strong>Total {money(pricing.totalMinor)}</strong>
          </p>
        </div>
        {kind !== "convert" && (
          <label>
            Reason for {kind === "void" ? "void" : "correction"}
            <textarea
              required
              minLength={8}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        )}
        <label className="check-label">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I reviewed this exact revision and confirm this fictional, unissued
          draft action.
        </label>
        {(error || calculationError) && (
          <p role="alert">{error || calculationError}</p>
        )}
        <div className="actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel review
          </button>
          <button disabled={busy || !confirmed || !!calculationError}>
            {busy
              ? "Saving…"
              : kind === "convert"
                ? "Confirm create invoice draft"
                : kind === "void"
                  ? "Confirm void draft"
                  : "Save correction revision"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
export function InvoiceDrafts({
  records,
  versions,
  businessName,
  theme,
  canManage,
  busy,
  onAction,
}: {
  records: WorkspaceRecord[];
  versions: InvoiceVersion[];
  businessName: string;
  theme: "light" | "dark";
  canManage: boolean;
  busy: boolean;
  onAction: (record: WorkspaceRecord, kind: "correct" | "void") => void;
}) {
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("All"),
    [preview, setPreview] = useState<{
      record: WorkspaceRecord;
      version?: InvoiceVersion;
    } | null>(null);
  const rows = records.filter(
    (r) =>
      r.entity === "invoice-drafts" &&
      (status === "All" || r.data.status === status) &&
      [
        r.data.title,
        (r.data.pricing as EstimatePricing).customerName,
        (r.data.pricing as EstimatePricing).workTitle,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section className="panel stack" aria-labelledby="invoice-heading">
      <h2 id="invoice-heading">Invoice Drafts</h2>
      <strong>{invoiceLabel}</strong>
      <p>
        Convert a reviewed estimate from Estimates. Saved prices and every
        correction remain in history. These drafts do not issue invoices, accept
        payments or contact customers. No accounting or tax compliance is
        certified.
      </p>
      <div className="field-grid">
        <label>
          Search invoice drafts
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          Invoice status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option>All</option>
            <option>Draft</option>
            <option>Void</option>
          </select>
        </label>
      </div>
      <div className="workforce-grid">
        {rows.map((r) => {
          const p = r.data.pricing as EstimatePricing;
          return (
            <article
              key={r.id}
              className="workforce-card"
              aria-label={`Invoice draft ${r.data.title}`}
            >
              <strong>{invoiceLabel}</strong>
              <h3>{String(r.data.title)}</h3>
              <span className="badge">
                {String(r.data.status)} · v{r.revision}
              </span>
              <p>
                {p.customerName} · {p.workTitle || "No linked work"}
              </p>
              <p>
                Created {new Date(r.created_at).toISOString().slice(0, 10)} ·{" "}
                {money(p.totalMinor)}
              </p>
              <p>Estimate revision {String(r.data.estimate_revision)}</p>
              <div className="actions">
                <button
                  className="secondary"
                  onClick={() => setPreview({ record: r })}
                >
                  Open / print draft
                </button>
                {r.data.status === "Draft" && (
                  <>
                    <button
                      disabled={!canManage || busy}
                      className="secondary"
                      onClick={() => onAction(r, "correct")}
                    >
                      Correct draft
                    </button>
                    <button
                      disabled={!canManage || busy}
                      className="quiet"
                      onClick={() => onAction(r, "void")}
                    >
                      Void draft
                    </button>
                  </>
                )}
              </div>
              <details>
                <summary>Financial revision history</summary>
                {versions
                  .filter((v) => v.record_id === r.id)
                  .map((v) => (
                    <div key={v.revision} className="subdued">
                      <p>
                        v{v.revision} · {String(v.data.status)} ·{" "}
                        {money((v.data.pricing as EstimatePricing).totalMinor)}
                      </p>
                      <p>{String(v.data.reason)}</p>
                      <p>
                        Authorized operator {v.actor_id} ·{" "}
                        {new Date(v.occurred_at).toISOString()}
                      </p>
                      <button
                        className="quiet"
                        onClick={() => setPreview({ record: r, version: v })}
                      >
                        Open invoice revision {v.revision}
                      </button>
                    </div>
                  ))}
              </details>
            </article>
          );
        })}
      </div>
      {!rows.length && (
        <p className="empty-state">
          No matching invoice drafts. Review an estimate, then explicitly
          confirm conversion.
        </p>
      )}
      {preview && (
        <EstimatePreview
          {...preview}
          invoice
          businessName={businessName}
          theme={theme}
          onClose={() => setPreview(null)}
        />
      )}
    </section>
  );
}
