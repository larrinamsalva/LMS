import { useEffect, useId, useRef, useState } from "react";
import {
  validateRecord,
  type EntityDefinition,
  type RecordData,
} from "../core/config";
import type { WorkspaceRecord } from "../core/engine";
export function RecordForm({
  entity,
  record,
  busy,
  onSave,
  onCancel,
}: {
  entity: EntityDefinition;
  record?: WorkspaceRecord;
  busy: boolean;
  onSave: (data: RecordData) => Promise<void>;
  onCancel: () => void;
}) {
  const prefix = useId();
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    formRef.current
      ?.querySelector<HTMLInputElement>("input,select,textarea")
      ?.focus();
  }, []);
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
      <form
        ref={formRef}
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          const form = new FormData(event.currentTarget);
          const data = Object.fromEntries(
            entity.fields.map((field) => {
              const raw = String(form.get(field.key) ?? "");
              return [
                field.key,
                field.type === "number" && raw !== "" ? Number(raw) : raw,
              ];
            }),
          );
          try {
            await onSave(validateRecord(entity, data));
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
            const fieldId = `${prefix}-${field.key}`;
            const value = record?.data[field.key] ?? "";
            return (
              <div
                className={field.type === "longtext" ? "full-field" : ""}
                key={field.key}
              >
                <label htmlFor={fieldId}>
                  {field.label}
                  {field.required ? " *" : ""}
                </label>
                {field.type === "select" ? (
                  <select
                    id={fieldId}
                    name={field.key}
                    required={field.required}
                    defaultValue={value}
                  >
                    <option value="">Select…</option>
                    {field.options?.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                ) : field.type === "longtext" ? (
                  <textarea
                    id={fieldId}
                    name={field.key}
                    defaultValue={value}
                    maxLength={2000}
                    required={field.required}
                    rows={3}
                  />
                ) : (
                  <input
                    id={fieldId}
                    name={field.key}
                    type={
                      field.type === "number"
                        ? "number"
                        : field.type === "date"
                          ? "date"
                          : field.type === "email"
                            ? "email"
                            : "text"
                    }
                    defaultValue={value}
                    min={field.type === "number" ? 0 : undefined}
                    max={field.type === "number" ? 1000000 : undefined}
                    step={field.type === "number" ? "any" : undefined}
                    maxLength={field.type === "email" ? 254 : 200}
                    required={field.required}
                  />
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
