import { useEffect, useId, useRef, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import type { RecordFormProps } from "./record-form";
import { validateRecord, type RecordData } from "../core/config";
import {
  calculateEstimate,
  decimalToMinor,
  minorToDecimal,
  money,
  estimateAcknowledgement,
  estimateInputSchema,
  estimateStatuses,
  type EstimateInput,
  type EstimatePricing,
} from "../core/pricing";
import { catalogSnapshots, rateKey, snapshotsFor } from "../core/catalog";
export function EstimateForm({
  entity,
  record,
  records,
  businessZone,
  busy,
  onSave,
  onCancel,
}: RecordFormProps) {
  const prefix = useId(),
    formRef = useRef<HTMLFormElement>(null),
    command = useRef<{ body: string; id: string } | null>(null);
  const prior = record?.data.pricing as EstimatePricing | undefined;
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      entity.fields
        .filter((f) => f.type !== "estimate")
        .map((f) => [
          f.key,
          String(
            record?.data[f.key] ??
              (f.key === "status"
                ? "Draft"
                : f.key === "as_of"
                  ? Temporal.Now.zonedDateTimeISO(businessZone)
                      .toPlainDate()
                      .toString()
                  : ""),
          ),
        ]),
    ),
  );
  const [lines, setLines] = useState<EstimateInput["lines"]>(
    () => prior?.lines.map((l) => ({ ...l })) ?? [],
  );
  const [discountKind, setDiscountKind] = useState<
    EstimateInput["discount"]["kind"]
  >(prior?.discount.kind ?? "None");
  const [discountValue, setDiscountValue] = useState(() =>
    minorToDecimal(prior?.discount.value ?? "0"),
  );
  const [taxMode, setTaxMode] = useState<EstimateInput["tax"]["mode"]>(
    prior?.tax.mode ?? "None",
  );
  const [taxRate, setTaxRate] = useState(() =>
    minorToDecimal(prior?.tax.basisPoints ?? "0"),
  );
  const [taxLabel, setTaxLabel] = useState(prior?.tax.label ?? "");
  const [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState("");
  const frozen = !!record && record.data.status !== "Draft";
  const available = catalogSnapshots(records, values.zone, values.as_of);
  const input = (): EstimateInput =>
    estimateInputSchema.parse({
      currency: "USD",
      lines,
      discount: {
        kind: discountKind,
        value: discountKind === "None" ? "0" : decimalToMinor(discountValue),
      },
      tax: {
        mode: taxMode,
        basisPoints: taxMode === "None" ? "0" : decimalToMinor(taxRate),
        label: taxMode === "None" ? "" : taxLabel,
      },
      acknowledgement: estimateAcknowledgement,
    });
  let preview: ReturnType<typeof calculateEstimate> | undefined,
    previewError = "";
  try {
    const p = input();
    preview = calculateEstimate(p, snapshotsFor(p, prior, available));
  } catch (e) {
    previewError =
      e instanceof Error && e.name !== "ZodError"
        ? e.message
        : "Choose an applicable rate and valid quantity for every line.";
  }
  useEffect(() => {
    formRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);
  function header(key: string, value: string) {
    setValues((v) => ({
      ...v,
      [key]: value,
      ...(key === "customer" && !record ? { work: "", appointment: "" } : {}),
    }));
    if (!record && ["zone", "as_of"].includes(key)) setLines([]);
  }
  return (
    <section className="panel editor" aria-labelledby={`${prefix}-heading`}>
      <div className="section-heading">
        <h2 id={`${prefix}-heading`}>
          {record ? "Edit" : "Add"} estimate draft
        </h2>
        <button type="button" className="quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="muted">
        Fictional internal draft only. Saved rates load automatically for the
        selected area and pricing date. Existing lines retain their snapshots;
        remove and add a line to explicitly select current pricing. USD only;
        quantities allow three decimals. Each line rounds half up to cents, then
        discount, then exclusive manual tax on the net.
      </p>
      {frozen && (
        <p className="muted">
          Reviewed drafts keep their content. Save status Draft first to reopen
          for editing. Void is terminal. Prior versions remain in history.
        </p>
      )}
      <form
        ref={formRef}
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            if (!confirmed)
              throw new Error("Confirm this is a fictional internal draft.");
            const data: RecordData = Object.fromEntries(
              entity.fields
                .filter((f) => f.type !== "estimate")
                .filter(
                  (f) =>
                    f.required ||
                    values[f.key] !== "" ||
                    record?.data[f.key] !== undefined,
                )
                .map((f) => [f.key, values[f.key] ?? ""]),
            );
            data.pricing = input();
            const clean = validateRecord(entity, data),
              body = JSON.stringify(clean);
            if (command.current?.body !== body)
              command.current = { body, id: crypto.randomUUID() };
            await onSave(clean, command.current!.id);
          } catch (e) {
            setError(
              e instanceof Error && e.name !== "ZodError"
                ? e.message
                : "Check the fields, selected rates and calculation values.",
            );
          }
        }}
      >
        <div className="form-grid">
          {entity.fields
            .filter((f) => f.type !== "estimate")
            .map((f) => {
              const id = `${prefix}-${f.key}`,
                locked =
                  (!!record &&
                    [
                      "customer",
                      "work",
                      "appointment",
                      "zone",
                      "as_of",
                    ].includes(f.key)) ||
                  (frozen && f.key !== "status");
              const choices = records.filter(
                (r) =>
                  r.entity === f.target &&
                  (!r.archived || r.id === values[f.key]) &&
                  (!["work", "appointment"].includes(f.key) ||
                    !values.customer ||
                    r.data.customer === values.customer),
              );
              return (
                <div
                  key={f.key}
                  className={f.type === "longtext" ? "full-field" : ""}
                >
                  <label htmlFor={id}>
                    {f.label}
                    {f.required ? " *" : ""}
                  </label>
                  {f.type === "reference" ? (
                    <select
                      id={id}
                      required={f.required}
                      disabled={locked}
                      value={values[f.key] ?? ""}
                      onChange={(e) => header(f.key, e.target.value)}
                    >
                      <option value="">Select…</option>
                      {values[f.key] &&
                        !choices.some((r) => r.id === values[f.key]) && (
                          <option value={values[f.key]}>Retained link</option>
                        )}
                      {choices.map((r) => (
                        <option value={r.id} key={r.id}>
                          {String(r.data.title ?? r.data.name ?? r.id)}
                          {r.archived ? " (archived)" : ""}
                        </option>
                      ))}
                    </select>
                  ) : f.key === "status" ? (
                    <select
                      id={id}
                      value={values.status}
                      onChange={(e) => header("status", e.target.value)}
                      disabled={record?.data.status === "Void"}
                    >
                      {(record ? estimateStatuses : ["Draft"]).map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  ) : f.type === "longtext" ? (
                    <textarea
                      id={id}
                      readOnly={locked}
                      rows={3}
                      maxLength={2000}
                      value={values[f.key] ?? ""}
                      onChange={(e) => header(f.key, e.target.value)}
                    />
                  ) : (
                    <input
                      id={id}
                      type={f.type === "date" ? "date" : "text"}
                      readOnly={locked}
                      required={f.required}
                      maxLength={200}
                      value={values[f.key] ?? ""}
                      onChange={(e) => header(f.key, e.target.value)}
                    />
                  )}
                </div>
              );
            })}
        </div>
        <fieldset>
          <legend>Estimate line items</legend>
          <p className="muted">
            Rates use explicit areas and effective dates. Extras require their
            base service. A new rate selection creates a new pricing snapshot.
          </p>
          <div className="stack">
            {lines.map((l, index) => {
              const retained = prior?.lines.find(
                  (old) => old.id === l.id && rateKey(old) === rateKey(l),
                )?.snapshot,
                snap =
                  retained ?? available.find((s) => rateKey(s) === rateKey(l));
              const id = `${prefix}-line-${index}`;
              return (
                <div className="estimate-line" key={l.id}>
                  <div className="form-grid">
                    <div className="full-field">
                      <label htmlFor={`${id}-service`}>
                        Line {index + 1} service or extra *
                      </label>
                      <select
                        id={`${id}-service`}
                        disabled={frozen}
                        required
                        value={l.rateId ? rateKey(l) : ""}
                        onChange={(e) => {
                          const s = available.find(
                            (s) => rateKey(s) === e.target.value,
                          );
                          setLines((old) =>
                            old.map((line, i) =>
                              i !== index
                                ? line
                                : s
                                  ? {
                                      id: crypto.randomUUID(),
                                      rateId: s.rateId,
                                      rateRevision: s.rateRevision,
                                      serviceRevision: s.serviceRevision,
                                      quantity:
                                        s.mode === "Fixed"
                                          ? "1"
                                          : line.quantity,
                                      note: line.note,
                                    }
                                  : {
                                      ...line,
                                      id: crypto.randomUUID(),
                                      rateId: "",
                                      rateRevision: 0,
                                      serviceRevision: 0,
                                    },
                            ),
                          );
                        }}
                      >
                        <option value="">Select a saved rate…</option>
                        {retained &&
                          !available.some((s) => rateKey(s) === rateKey(l)) && (
                            <option value={rateKey(l)}>
                              Saved: {retained.name} ·{" "}
                              {money(retained.amountMinor)} / {retained.unit}
                            </option>
                          )}
                        {available.map((s) => (
                          <option key={rateKey(s)} value={rateKey(s)}>
                            {s.kind === "Extra" ? "Extra: " : ""}
                            {s.name} · {money(s.amountMinor)} / {s.unit}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor={`${id}-qty`}>
                        Line {index + 1} quantity *
                      </label>
                      <input
                        id={`${id}-qty`}
                        type="text"
                        inputMode="decimal"
                        required
                        maxLength={12}
                        readOnly={frozen || snap?.mode === "Fixed"}
                        value={l.quantity}
                        onChange={(e) =>
                          setLines((old) =>
                            old.map((line, i) =>
                              i === index
                                ? { ...line, quantity: e.target.value }
                                : line,
                            ),
                          )
                        }
                      />
                    </div>
                    <div>
                      <label htmlFor={`${id}-note`}>
                        Line {index + 1} note
                      </label>
                      <input
                        id={`${id}-note`}
                        maxLength={500}
                        readOnly={frozen}
                        value={l.note}
                        onChange={(e) =>
                          setLines((old) =>
                            old.map((line, i) =>
                              i === index
                                ? { ...line, note: e.target.value }
                                : line,
                            ),
                          )
                        }
                      />
                    </div>
                  </div>
                  {snap && (
                    <p className="muted">
                      {snap.mode} · {snap.description} · Rate v
                      {snap.rateRevision}, service v{snap.serviceRevision}
                      {retained ? " · Saved snapshot" : ""}
                    </p>
                  )}
                  <button
                    type="button"
                    className="quiet"
                    disabled={frozen}
                    onClick={() =>
                      setLines((old) => old.filter((_, i) => i !== index))
                    }
                    aria-label={`Remove line ${index + 1}`}
                  >
                    Remove line
                  </button>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="secondary"
            disabled={
              frozen || lines.length >= 10 || !values.zone || !values.as_of
            }
            onClick={() =>
              setLines((old) => [
                ...old,
                {
                  id: crypto.randomUUID(),
                  rateId: "",
                  rateRevision: 0,
                  serviceRevision: 0,
                  quantity: "1",
                  note: "",
                },
              ])
            }
          >
            + Add line
          </button>
        </fieldset>
        <fieldset>
          <legend>Discount and explicit tax</legend>
          <div className="form-grid">
            <div>
              <label htmlFor={`${prefix}-discount`}>Discount type</label>
              <select
                id={`${prefix}-discount`}
                disabled={frozen}
                value={discountKind}
                onChange={(e) => {
                  setDiscountKind(e.target.value as typeof discountKind);
                  setDiscountValue("0.00");
                }}
              >
                {["None", "Amount", "Percent"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${prefix}-discount-value`}>
                {discountKind === "Percent"
                  ? "Discount percent"
                  : "Discount amount (USD)"}
              </label>
              <input
                id={`${prefix}-discount-value`}
                inputMode="decimal"
                readOnly={frozen || discountKind === "None"}
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor={`${prefix}-tax-mode`}>Tax handling</label>
              <select
                id={`${prefix}-tax-mode`}
                disabled={frozen}
                value={taxMode}
                onChange={(e) => setTaxMode(e.target.value as typeof taxMode)}
              >
                <option>None</option>
                <option>Manual</option>
              </select>
            </div>
            {taxMode === "Manual" && (
              <>
                <div>
                  <label htmlFor={`${prefix}-tax-rate`}>
                    Manual tax percent
                  </label>
                  <input
                    id={`${prefix}-tax-rate`}
                    inputMode="decimal"
                    readOnly={frozen}
                    value={taxRate}
                    onChange={(e) => setTaxRate(e.target.value)}
                  />
                </div>
                <div className="full-field">
                  <label htmlFor={`${prefix}-tax-label`}>
                    Manual tax label *
                  </label>
                  <input
                    id={`${prefix}-tax-label`}
                    required
                    maxLength={80}
                    readOnly={frozen}
                    value={taxLabel}
                    onChange={(e) => setTaxLabel(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>
          <p className="muted">
            Manual tax is an explicit fictional input, not automated tax-law
            compliance. No inclusive, compound or line-specific tax calculation
            is supplied.
          </p>
        </fieldset>
        {preview ? (
          <dl className="money-totals" aria-label="Estimate calculation">
            <div>
              <dt>Subtotal</dt>
              <dd>{money(preview.subtotalMinor)}</dd>
            </div>
            <div>
              <dt>Discount</dt>
              <dd>{money(preview.discountMinor)}</dd>
            </div>
            <div>
              <dt>Manual tax</dt>
              <dd>{money(preview.taxMinor)}</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>{money(preview.totalMinor)}</dd>
            </div>
          </dl>
        ) : (
          <p className="muted" role="status">
            {previewError}
          </p>
        )}
        <label className="check-label">
          <input
            type="checkbox"
            required
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I reviewed the amounts and confirm this is a fictional internal draft
          only.
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="form-footer">
          <span className="muted">
            No invoice, payment or customer message.
          </span>
          <button
            disabled={busy || record?.data.status === "Void"}
            type="submit"
          >
            {busy ? "Saving…" : "Save estimate draft"}
          </button>
        </div>
      </form>
    </section>
  );
}
