import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { WorkspaceRecord } from "../core/engine";
import {
  minorToDecimal,
  money,
  type EstimatePricing,
  type EstimateVersion,
} from "../core/pricing";
import { invoiceLabel } from "../core/invoices";
import type { RecordData } from "../core/config";
import { relatedLabel } from "./schedule";
import { serviceRateCardCsv, serviceRateCardRows, rateCoversDate, rateMatchesArea } from "../core/service-rate-card-csv";
import { rateCoverageAudit } from "../core/service-rate-coverage";
interface Actions {
  canManage: boolean;
  busy: boolean;
  onAdd: (entity: string) => void;
  onEdit: (record: WorkspaceRecord) => void;
  onArchive: (record: WorkspaceRecord) => void;
}
export function Catalog({
  records,
  canManage,
  busy,
  onAdd,
  onEdit,
  onArchive,
  organizationId,
}: Actions & { records: WorkspaceRecord[]; organizationId: string }) {
  const [archived, setArchived] = useState(false);
  const [asOfDate, setAsOfDate] = useState("");
  const [selectedAreaId, setSelectedAreaId] = useState("");
  const services = records.filter(
      (r) => r.entity === "services" && r.archived === archived,
    ),
    rates = records.filter(
      (r) => r.entity === "service-rates" && r.archived === archived &&
        rateCoversDate(r, asOfDate) && rateMatchesArea(r, selectedAreaId),
    ),
    zones = records.filter(
      (r) => r.entity === "pricing-zones" && r.archived === archived,
    );
  const areaOptions = records.filter((r) =>
    r.organization_id === organizationId && r.entity === "pricing-zones",
  ).sort((a, b) => String(a.data.name).localeCompare(String(b.data.name)));
  const exportRows = serviceRateCardRows(
    records, organizationId, archived, asOfDate, selectedAreaId,
  );
  const coverage = rateCoverageAudit(
    records, organizationId, selectedAreaId, asOfDate,
  );
  function downloadRateCard() {
    if (!exportRows.length) return;
    const csv = serviceRateCardCsv(
      records, organizationId, archived, asOfDate, selectedAreaId,
    );
    const file = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = archived
      ? "lms-archived-service-rates.csv"
      : "lms-active-service-rates.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const actions = (r: WorkspaceRecord) => (
    <div className="actions">
      {!r.archived && (
        <button
          disabled={!canManage || busy}
          className="secondary"
          aria-label={`Edit ${r.data.name ?? r.data.title}`}
          onClick={() => onEdit(r)}
        >
          Edit
        </button>
      )}
      <button
        className="quiet"
        disabled={!canManage || busy}
        aria-label={`${r.archived ? "Restore" : "Archive"} ${r.data.name ?? r.data.title}`}
        onClick={() => onArchive(r)}
      >
        {r.archived ? "Restore" : "Archive"}
      </button>
    </div>
  );
  return (
    <div className="stack">
      <section className="panel" aria-labelledby="catalog-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Reusable pricing · fictional USD</span>
            <h2 id="catalog-heading">Services & Rates</h2>
          </div>
          <button
            disabled={!canManage || busy}
            onClick={() => onAdd("services")}
          >
            + Add service
          </button>
        </div>
        <p className="muted">
          Owners and admins maintain services and dated area rates. Estimates
          load applicable prices automatically and retain their original
          descriptions and amounts. Area selection is explicit; no
          address/geographic inference or currency conversion runs.
        </p>
        <div className="actions">
          <button
            className="secondary"
            disabled={!canManage || busy}
            onClick={() => onAdd("service-rates")}
          >
            + Add service rate
          </button>
          <button
            className="secondary"
            disabled={!canManage || busy}
            onClick={() => onAdd("pricing-zones")}
          >
            + Add pricing zone
          </button>
          <label className="check-label">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Show archived catalog records
          </label>
          <div>
            <label htmlFor="service-rate-date">Rates covering date (optional)</label>
            <input
              id="service-rate-date"
              type="date"
              value={asOfDate}
              onChange={(event) => setAsOfDate(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="service-rate-area">Filter service rates by area</label>
            <select
              id="service-rate-area"
              value={selectedAreaId}
              onChange={(event) => setSelectedAreaId(event.target.value)}
            >
              <option value="">All service areas</option>
              {areaOptions.map((area) => (
                <option key={area.id} value={area.id}>
                  {String(area.data.name)}{area.archived ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </div>
          <button
            className="secondary"
            type="button"
            disabled={exportRows.length === 0}
            onClick={downloadRateCard}
          >
            Download {archived ? "archived" : "active"} service rates CSV
          </button>
        </div>
        <p className="muted">
          The read-only rate card lists saved prices by service and area,
          with effective dates, USD amounts and archived-link status.
          It follows the active/archived catalog view and the optional
          date filter on saved rate ranges, plus the explicitly chosen
          service-area filter. Clear either filter to see every matching
          saved rate. Effective-until dates are exclusive. Archived rates
          and linked services or areas are not automatically available for
          quoting even when a date matches. Exporting does not create a quote,
          update prices or contact a customer.
        </p>
      </section>
      <section className="panel">
        <h2>Services</h2>
        <div className="workforce-grid">
          {services.map((s) => (
            <article
              key={s.id}
              className="workforce-card"
              aria-label={`Service ${s.data.name}`}
            >
              <span className="badge">
                {String(s.data.kind)} · {String(s.data.mode)}
                {s.archived ? " · Archived" : ""}
              </span>
              <h3>{String(s.data.name)}</h3>
              <p>{String(s.data.description ?? "")}</p>
              <p className="muted">
                Unit: {String(s.data.unit)}
                {s.data.category ? " · " + String(s.data.category) : ""}
              </p>
              {s.data.parent && (
                <p>Extra for {relatedLabel(s.data.parent, records)}</p>
              )}
              {actions(s)}
            </article>
          ))}
        </div>
        {!services.length && (
          <p className="empty-state">
            Add a service to begin your fictional catalog.
          </p>
        )}
      </section>
      <section className="panel">
        <h2>Saved rates</h2>
        <p className="muted">
          One active rate per service and area on each date. Effective-until
          dates are exclusive. Close the previous date range before adding
          another; archived rates can only be restored if their range is
          available.
        </p>
        <div className="workforce-grid">
          {rates.map((r) => (
            <article
              key={r.id}
              className="workforce-card"
              aria-label={`Rate ${r.data.title}`}
            >
              <span className="badge">
                v{r.revision}
                {r.archived ? " · Archived" : ""}
              </span>
              <h3>{String(r.data.title)}</h3>
              <p>
                {relatedLabel(r.data.service, records)} ·{" "}
                {relatedLabel(r.data.zone, records)}
              </p>
              <p>
                <strong>{money(String(r.data.amount))}</strong> per configured
                unit
              </p>
              <p>
                {String(r.data.effective_from)} →{" "}
                {String(r.data.effective_until || "Open end")}
              </p>
              {actions(r)}
            </article>
          ))}
        </div>
        {!rates.length && (
          <p className="empty-state">
            No saved rates match the selected status, date and service area.
          </p>
        )}
      </section>
      <section className="panel" aria-labelledby="rate-coverage-heading">
        <h2 id="rate-coverage-heading">Rate coverage audit</h2>
        <p className="muted">
          Check which active catalog services lack a live saved rate for
          a chosen service area and date. This is an informational check,
          not a promise that every service is offered in every area. A
          matching rate is not a verified quote or price approval.
          Nothing is saved or automatically priced.
        </p>
        {coverage.status === "choose" && (
          <p>Choose a service area and a rate date above to audit coverage.</p>
        )}
        {coverage.status === "invalid-date" && (
          <p>Choose a valid rate date to audit coverage.</p>
        )}
        {coverage.status === "unavailable-area" && (
          <p>Choose an active service area for live rate coverage.
            Archived areas remain available for historical rate review only.</p>
        )}
        {coverage.status === "ready" && (
          <>
            <p role="status">
              {coverage.coveredServices} of {coverage.totalActiveServices} active
              catalog services have a saved active rate covering {coverage.date}
              in {coverage.areaName}.{" "}
              <strong>{coverage.gaps.length} missing rate candidates.</strong>
            </p>
            {coverage.gaps.length === 0 ? (
              <p>No missing active saved-rate coverage found for this selection.</p>
            ) : (
              <div className="workforce-grid">
                {coverage.gaps.map((gap) => (
                  <article
                    className="workforce-card"
                    key={gap.serviceId}
                    aria-label={"Missing rate for " + gap.serviceName}
                  >
                    <h3>{gap.serviceName}</h3>
                    <p>{gap.kind} · {gap.mode} · {gap.unit}</p>
                    <p className="muted">
                      No active rate for this area/date. Review whether this
                      service should be offered here before adding a rate.
                    </p>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </section>
      <section className="panel">
        <h2>Pricing zones / service areas</h2>
        <div className="workforce-grid">
          {zones.map((z) => (
            <article
              key={z.id}
              className="workforce-card"
              aria-label={`Pricing area ${z.data.name}`}
            >
              <h3>{String(z.data.name)}</h3>
              <p>{String(z.data.description ?? "")}</p>
              {actions(z)}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
export function EstimatePreview({
  record,
  version,
  businessName,
  theme,
  onClose,
  invoice = false,
}: {
  record: WorkspaceRecord;
  invoice?: boolean;
  version?: { data: RecordData; revision: number; archived?: boolean };
  businessName: string;
  theme: "light" | "dark";
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    title = useId();
  const data = version?.data ?? record.data,
    p = data.pricing as EstimatePricing;
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      id="estimate-print-root"
      className="app estimate-print"
      data-theme={theme}
      aria-labelledby={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="actions print-controls">
        <button className="secondary" onClick={onClose}>
          Close preview
        </button>
        <button onClick={() => window.print()}>Print fictional draft</button>
      </div>
      <p className="eyebrow">{businessName}</p>
      <h2 id={title}>{String(data.title)}</h2>
      <p>
        <strong>
          {invoice ? invoiceLabel : "FICTIONAL INTERNAL ESTIMATE DRAFT"}
        </strong>
      </p>
      <p>
        {invoice
          ? "Unissued internal demonstration. No payment, receipt or customer communication."
          : "No invoice, payment request or customer communication."}{" "}
        {String(data.status)} · revision {version?.revision ?? record.revision}
        {(version?.archived ?? record.archived) ? " · Archived" : ""}
      </p>
      {invoice && (
        <p>
          Originating estimate {String(data.estimate)} · exact revision{" "}
          {String(data.estimate_revision)}. Revision reason:{" "}
          {String(data.reason)}
        </p>
      )}
      <dl>
        <div>
          <dt>Customer snapshot</dt>
          <dd>{p.customerName}</dd>
        </div>
        <div>
          <dt>Pricing date / area</dt>
          <dd>
            {String(data.as_of)} · {p.lines[0]?.snapshot.zoneName}
          </dd>
        </div>
        {p.workTitle && (
          <div>
            <dt>Work</dt>
            <dd>{p.workTitle}</dd>
          </div>
        )}
        {p.appointmentTitle && (
          <div>
            <dt>Appointment</dt>
            <dd>{p.appointmentTitle}</dd>
          </div>
        )}
      </dl>
      <ol className="estimate-preview-lines">
        {p.lines.map((l) => (
          <li key={l.id}>
            <h3>
              {l.snapshot.name}
              {l.snapshot.kind === "Extra" ? " · Extra" : ""}
            </h3>
            <p>{l.snapshot.description}</p>
            <p>
              {l.quantity} {l.snapshot.unit} × {money(l.snapshot.amountMinor)} ·{" "}
              {l.snapshot.mode}
            </p>
            {l.note && <p>{l.note}</p>}
            <strong>{money(l.amountMinor)}</strong>
          </li>
        ))}
      </ol>
      <dl className="money-totals">
        <div>
          <dt>Subtotal</dt>
          <dd>{money(p.subtotalMinor)}</dd>
        </div>
        <div>
          <dt>Discount</dt>
          <dd>{money(p.discountMinor)}</dd>
        </div>
        <div>
          <dt>
            {p.tax.mode === "Manual"
              ? `${p.tax.label} (${minorToDecimal(p.tax.basisPoints)}%)`
              : "No tax configured"}
          </dt>
          <dd>{money(p.taxMinor)}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>{money(p.totalMinor)}</dd>
        </div>
      </dl>
      {data.notes && <p>{String(data.notes)}</p>}
      <p className="muted">
        USD. Half-up rounding per line, then discount, then exclusive manual tax
        on net. Manual tax is fictional configuration, not automated tax-law
        compliance.
      </p>
    </dialog>,
    document.body,
  );
}
export function Estimates({
  records,
  versions,
  businessName,
  theme,
  canManage,
  busy,
  onAdd,
  onEdit,
  onArchive,
  onConvert,
}: Actions & {
  onConvert?: (record: WorkspaceRecord) => void;
  records: WorkspaceRecord[];
  versions: EstimateVersion[];
  businessName: string;
  theme: "light" | "dark";
}) {
  const [archived, setArchived] = useState(false),
    [preview, setPreview] = useState<{
      record: WorkspaceRecord;
      version?: EstimateVersion;
    } | null>(null);
  const rows = records.filter(
    (r) => r.entity === "estimates" && r.archived === archived,
  );
  return (
    <section className="panel" aria-labelledby="estimates-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Saved pricing snapshots</span>
          <h2 id="estimates-heading">Estimates</h2>
        </div>
        <button
          disabled={!canManage || busy}
          onClick={() => onAdd("estimates")}
        >
          + Add estimate draft
        </button>
      </div>
      <p className="muted">
        Fictional drafts stay internal. Reviewed drafts are locked until
        explicitly reopened; void is terminal. Every saved revision and archive
        action remains in history. No sending, issuance or payment action is
        available.
        {onConvert &&
          " Reviewed estimates can be explicitly converted to fictional unissued invoice drafts."}
      </p>
      <label className="check-label">
        <input
          type="checkbox"
          checked={archived}
          onChange={(e) => setArchived(e.target.checked)}
        />
        Show archived estimate drafts
      </label>
      <div className="workforce-grid">
        {rows.map((r) => {
          const p = r.data.pricing as EstimatePricing;
          return (
            <article
              className="workforce-card"
              key={r.id}
              aria-label={`Estimate ${r.data.title}`}
            >
              <span className="badge">
                {String(r.data.status)} · v{r.revision}
              </span>
              <h3>{String(r.data.title)}</h3>
              <p>
                {p.customerName} · {String(r.data.as_of)}
              </p>
              <p>
                <strong>{money(p.totalMinor)}</strong>
              </p>
              <div className="actions">
                {onConvert &&
                  !r.archived &&
                  r.data.status === "Reviewed draft" && (
                    <button
                      disabled={
                        !canManage ||
                        busy ||
                        records.some(
                          (d) =>
                            d.entity === "invoice-drafts" &&
                            d.data.estimate === r.id,
                        )
                      }
                      onClick={() => onConvert(r)}
                    >
                      Create Invoice Draft from Estimate
                    </button>
                  )}
                <button
                  className="secondary"
                  onClick={() => setPreview({ record: r })}
                  aria-label={`Preview ${r.data.title}`}
                >
                  Preview / print
                </button>
                {!r.archived && r.data.status !== "Void" && (
                  <button
                    className="secondary"
                    disabled={!canManage || busy}
                    onClick={() => onEdit(r)}
                    aria-label={`Edit ${r.data.title}`}
                  >
                    Edit draft
                  </button>
                )}
                <button
                  className="quiet"
                  disabled={!canManage || busy}
                  onClick={() => onArchive(r)}
                  aria-label={`${r.archived ? "Restore" : "Archive"} ${r.data.title}`}
                >
                  {r.archived ? "Restore" : "Archive"}
                </button>
              </div>
              <details>
                <summary>Status and pricing history</summary>
                <ul className="history">
                  {versions
                    .filter((v) => v.record_id === r.id)
                    .map((v) => (
                      <li key={v.revision}>
                        <span>
                          v{v.revision} · {String(v.data.status)}
                          {v.archived ? " · Archived" : ""}
                        </span>
                        <button
                          className="quiet"
                          onClick={() => setPreview({ record: r, version: v })}
                          aria-label={`Preview ${r.data.title} version ${v.revision}`}
                        >
                          View snapshot
                        </button>
                      </li>
                    ))}
                </ul>
              </details>
            </article>
          );
        })}
      </div>
      {!rows.length && (
        <p className="empty-state">
          No estimate drafts here. Add a fictional draft from saved services and
          rates.
        </p>
      )}
      {preview && (
        <EstimatePreview
          {...preview}
          businessName={businessName}
          theme={theme}
          onClose={() => setPreview(null)}
        />
      )}
    </section>
  );
}
