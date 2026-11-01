import { useEffect, useId, useRef, useState } from "react";
import {
  validateRecord,
  type EntityDefinition,
  type RecordData,
} from "../core/config";
import type { WorkspaceRecord } from "../core/engine";
import { localTime, wallToInstant, normalizeInstant } from "../core/time";
export function RecordForm({
  entity,
  record,
  records,
  businessZone,
  workforceEnabled,
  busy,
  onSave,
  onCancel,
}: {
  entity: EntityDefinition;
  record?: WorkspaceRecord;
  records: WorkspaceRecord[];
  businessZone: string;
  workforceEnabled: boolean;
  busy: boolean;
  onSave: (data: RecordData, operationId: string) => Promise<void>;
  onCancel: () => void;
}) {
  const prefix = useId(),
    formRef = useRef<HTMLFormElement>(null),
    command = useRef<{ body: string; id: string } | null>(null);
  const initial = () =>
    Object.fromEntries(
      entity.fields.map((field) => {
        let value = String(record?.data[field.key] ?? "");
        if (field.type === "datetime" && value)
          value = localTime(
            value,
            String(record?.data.time_zone ?? businessZone),
          );
        if (entity.id === "appointments" && !record) {
          if (field.key === "time_zone") value = businessZone;
          if (field.key === "status") value = "Scheduled";
        }
        if (!record && field.key === "time_zone") value = businessZone;
        if (!record && entity.id === "employees" && field.key === "status")
          value = "Active";
        return [field.key, value];
      }),
    );
  const [values, setValues] = useState(initial),
    [error, setError] = useState("");
  const [occurrences, setOccurrences] = useState<
    Record<string, "reject" | "earlier" | "later">
  >(() => {
    const result: Record<string, "reject" | "earlier" | "later"> = {};
    if (record)
      for (const f of entity.fields.filter(
        (f) => f.type === "datetime" && record.data[f.key],
      )) {
        const zone = String(record.data.time_zone ?? businessZone),
          value = String(record.data[f.key]);
        result[f.key] =
          wallToInstant(localTime(value, zone), zone, "earlier") ===
          normalizeInstant(value)
            ? "earlier"
            : "later";
      }
    return result;
  });
  useEffect(() => {
    formRef.current
      ?.querySelector<HTMLInputElement>("input,select,textarea")
      ?.focus();
  }, []);
  function change(key: string, value: string) {
    if (key === "start" || key === "end")
      setOccurrences((current) => ({ ...current, [key]: "reject" }));
    if (key === "time_zone") setOccurrences({});
    setValues((current) => {
      const next = { ...current, [key]: value };
      if (entity.id === "appointments") {
        if (key === "start") next.scheduled_date = value.slice(0, 10);
        if (key === "customer" && current.customer !== value) {
          next.work = "";
          next.site = "";
        }
        if (key === "work") {
          const work = records.find((r) => r.id === value);
          if (work?.data.customer) next.customer = String(work.data.customer);
          if (entity.fields.some((f) => f.key === "site"))
            next.site = String(work?.data.site ?? "");
        }
      }
      return next;
    });
  }
  return (
    <section className="panel editor" aria-labelledby={`${prefix}-heading`}>
      <div className="section-heading">
        <h2 id={`${prefix}-heading`}>
          {record ? "Edit" : "Add"} {entity.singular.toLowerCase()}
        </h2>
        <button onClick={onCancel} className="quiet" type="button">
          Cancel
        </button>
      </div>
      {entity.id === "appointments" && (
        <p className="muted">
          Link the job or request to a customer first. Each resource can have
          one appointment at a time. Times use the booking zone below; changing
          that zone reinterprets the entered clock times.
        </p>
      )}
      {record && entity.id === "appointments" && (
        <p className="muted">
          Customer, work and site stay linked to this history. For different
          work, archive this appointment and create another. Times, resource,
          status and notes can be edited.
        </p>
      )}
      {entity.id === "appointments" && values.resource && (
        <p className="muted" role="status">
          {!workforceEnabled
            ? "Retained workforce rules still apply when this resource is enrolled. Enable Employees & crews to manage its roster."
            : records.find((r) => r.id === values.resource)?.data.kind ===
                "Equipment"
              ? "Equipment reservation: resource availability applies; no employee roster."
              : records.some(
                    (r) =>
                      r.entity === "resource-memberships" &&
                      r.data.resource === values.resource,
                  )
                ? "Staffed reservation: every effective member needs covering work hours and no time off or competing employee assignment."
                : "Resource-only reservation: no employee identity or employee availability is reserved. Add dated memberships in Crews & availability to enroll it."}
        </p>
      )}
      {entity.module === "workforce" && (
        <p className="muted">
          Fictional profiles never create login accounts or grant access.
          Memberships and periods use the zone below. Publish a finite work
          window for each employee; time off always takes priority. Choose
          exactly one employee or resource for a period. Reserved work must be
          cancelled or archived before changing its roster or availability.
        </p>
      )}
      <form
        ref={formRef}
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          try {
            const zone = values.time_zone || businessZone;
            const data = Object.fromEntries(
              entity.fields.map((field) => [
                field.key,
                field.type === "datetime" && values[field.key]
                  ? wallToInstant(
                      values[field.key],
                      zone,
                      occurrences[field.key] ?? "reject",
                    )
                  : field.type === "number" && values[field.key] !== ""
                    ? Number(values[field.key])
                    : values[field.key],
              ]),
            );
            const clean = validateRecord(entity, data),
              body = JSON.stringify(clean);
            if (command.current?.body !== body)
              command.current = { body, id: crypto.randomUUID() };
            await onSave(clean, command.current!.id);
          } catch (err) {
            setError(
              err instanceof Error && err.name !== "ZodError"
                ? err.message
                : "Check the fields and allowed values.",
            );
          }
        }}
      >
        <div className="form-grid">
          {entity.fields.map((field) => {
            const id = `${prefix}-${field.key}`,
              value = values[field.key] ?? "";
            const choices = records.filter(
              (r) =>
                r.entity === field.target &&
                (!r.archived || r.id === value) &&
                (entity.id !== "appointments" ||
                  field.key !== "work" ||
                  !values.customer ||
                  r.data.customer === values.customer) &&
                (entity.id !== "resource-memberships" ||
                  field.key !== "resource" ||
                  ["Worker", "Crew"].includes(String(r.data.kind))),
            );
            return (
              <div
                className={field.type === "longtext" ? "full-field" : ""}
                key={field.key}
              >
                <label htmlFor={id}>
                  {field.label}
                  {field.required ? " *" : ""}
                </label>
                {field.type === "reference" ? (
                  <select
                    id={id}
                    name={field.key}
                    disabled={
                      !!record &&
                      ((entity.id === "appointments" &&
                        ["customer", "work", "site"].includes(field.key)) ||
                        (entity.id === "resource-memberships" &&
                          ["employee", "resource"].includes(field.key)))
                    }
                    required={field.required}
                    value={value}
                    onChange={(e) => change(field.key, e.target.value)}
                  >
                    <option value="">Select…</option>
                    {value && !choices.some((r) => r.id === value) && (
                      <option value={value}>
                        Retained link (module unavailable)
                      </option>
                    )}
                    {choices.map((r) => (
                      <option value={r.id} key={r.id}>
                        {String(
                          r.data.title ?? r.data.name ?? r.data.label ?? r.id,
                        )}
                        {r.archived ? " (archived)" : ""}
                      </option>
                    ))}
                  </select>
                ) : field.type === "select" ? (
                  <select
                    id={id}
                    name={field.key}
                    required={field.required}
                    value={value}
                    onChange={(e) => change(field.key, e.target.value)}
                  >
                    <option value="">Select…</option>
                    {field.options?.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                ) : field.type === "longtext" ? (
                  <textarea
                    id={id}
                    name={field.key}
                    value={value}
                    onChange={(e) => change(field.key, e.target.value)}
                    maxLength={2000}
                    required={field.required}
                    rows={3}
                  />
                ) : (
                  <input
                    id={id}
                    name={field.key}
                    value={value}
                    onChange={(e) => change(field.key, e.target.value)}
                    type={
                      field.type === "number"
                        ? "number"
                        : field.type === "date"
                          ? "date"
                          : field.type === "datetime"
                            ? "datetime-local"
                            : field.type === "email"
                              ? "email"
                              : "text"
                    }
                    min={field.type === "number" ? 0 : undefined}
                    max={field.type === "number" ? 1000000 : undefined}
                    step={
                      field.type === "number"
                        ? "any"
                        : field.type === "datetime"
                          ? 60
                          : undefined
                    }
                    maxLength={field.type === "email" ? 254 : 200}
                    required={field.required}
                    readOnly={
                      entity.id === "appointments" &&
                      field.key === "scheduled_date"
                    }
                  />
                )}
                {field.type === "datetime" && (
                  <>
                    <label className="clock-label" htmlFor={`${id}-occurrence`}>
                      {field.label} clock occurrence
                    </label>
                    <select
                      id={`${id}-occurrence`}
                      value={occurrences[field.key] ?? "reject"}
                      onChange={(e) =>
                        setOccurrences({
                          ...occurrences,
                          [field.key]: e.target.value as
                            "reject" | "earlier" | "later",
                        })
                      }
                    >
                      <option value="reject">Reject repeated clock time</option>
                      <option value="earlier">First occurrence</option>
                      <option value="later">Second occurrence</option>
                    </select>
                  </>
                )}
              </div>
            );
          })}
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="form-footer">
          <span className="muted">* Required · fictional data only</span>
          <button disabled={busy} type="submit">
            {busy ? "Saving…" : "Save record"}
          </button>
        </div>
      </form>
    </section>
  );
}
