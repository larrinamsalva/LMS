import {
  reviewAppointmentResources,
  type AppointmentResources,
  type AppointmentAllocation,
} from "../core/coordinated-scheduling";
import {
  equipmentReservationWarning,
  type EquipmentMapping,
} from "../core/equipment-reservations";
import type { EquipmentState, EquipmentCheckout } from "../core/equipment";
import { relatedLabel } from "./schedule";
import { useEffect, useId, useRef, useState } from "react";
import {
  validateRecord,
  type EntityDefinition,
  type RecordData,
} from "../core/config";
import type { WorkspaceRecord } from "../core/engine";
import { stockUnits } from "../core/inventory";
import { decimalToMinor, minorToDecimal } from "../core/pricing";
import { localTime, wallToInstant, normalizeInstant } from "../core/time";
export type RecordFormProps = {
  equipmentMappings?: EquipmentMapping[];
  equipmentStates?: EquipmentState[];
  equipmentCheckouts?: EquipmentCheckout[];
  equipmentReservationsEnabled?: boolean;
  allocations?: AppointmentAllocation[];
  coordinatedEnabled?: boolean;
  configRevision?: number;
  entity: EntityDefinition;
  initialData?: RecordData;
  role?: string;
  record?: WorkspaceRecord;
  records: WorkspaceRecord[];
  businessZone: string;
  workforceEnabled: boolean;
  busy: boolean;
  onSave: (
    data: RecordData,
    operationId: string,
    resources?: AppointmentResources,
  ) => Promise<void>;
  onCancel: () => void;
};
export function RecordForm({
  entity,
  allocations = [],
  coordinatedEnabled = false,
  configRevision = 0,
  equipmentMappings = [],
  equipmentStates = [],
  equipmentCheckouts = [],
  equipmentReservationsEnabled = false,
  initialData,
  role = "owner",
  record,
  records,
  businessZone,
  workforceEnabled,
  busy,
  onSave,
  onCancel,
}: RecordFormProps) {
  const prefix = useId(),
    formRef = useRef<HTMLFormElement>(null),
    command = useRef<{ body: string; id: string } | null>(null);
  const initial = () =>
    Object.fromEntries(
      entity.fields.map((field) => {
        let value = String(
          record?.data[field.key] ?? initialData?.[field.key] ?? "",
        );
        if (entity.id === "stock-movements" && !record) {
          if (field.key === "action") value = "Receiving";
          if (field.key === "package") value = "Units";
          if (field.key === "quantity") value = "1";
          if (field.key === "occurred_on")
            value = localTime(new Date().toISOString(), businessZone).slice(
              0,
              10,
            );
          if (field.key === "product_revision" && initialData?.product)
            value = String(
              records.find((r) => r.id === initialData.product)?.revision ?? "",
            );
        }
        if (field.type === "money" && value) value = minorToDecimal(value);
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
  const [confirmed, setConfirmed] = useState(false);
  const retainedEquipment =
    allocations.find(
      (a) =>
        a.appointment_id === record?.id && a.slot === "Equipment" && a.present,
    )?.resource_id ?? "";
  const [additionalEquipment, setAdditionalEquipment] =
      useState(retainedEquipment),
    [bookingConfirmed, setBookingConfirmed] = useState(false);

  let converted = "";
  if (entity.id === "stock-movements") {
    try {
      converted = stockUnits(
        values.quantity,
        values.package,
        String(
          records.find((r) => r.id === values.product)?.data.case_size || "1",
        ),
      );
    } catch {
      /* Invalid inputs are explained on submit. */
    }
  }
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
    setConfirmed(false);
    if (key === "start" || key === "end")
      setOccurrences((current) => ({ ...current, [key]: "reject" }));
    if (key === "time_zone") setOccurrences({});
    setBookingConfirmed(false);
    setValues((current) => {
      const next = { ...current, [key]: value };
      if (entity.id === "stock-movements" && key === "product")
        next.product_revision = String(
          records.find((r) => r.id === value)?.revision ?? "",
        );
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
      {entity.module === "estimates" && (
        <p className="muted">
          Fictional catalog only. Prices use exact USD cents. Effective-until
          dates are exclusive. Archive linked active rates/extras before their
          service. A priced service keeps its method, unit and extra
          relationship.
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
      {entity.id === "stock-movements" && (
        <p className="muted">
          Post only after reviewing the product, packaging and location. Whole
          units only. Case conversion is saved with this movement. Posted
          history cannot be edited or archived; an owner/admin must post a
          correction.
        </p>
      )}
      <form
        ref={formRef}
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          try {
            if (entity.id === "stock-movements" && !confirmed)
              throw new Error("Review and confirm this stock movement.");
            const zone = values.time_zone || businessZone;
            const data = Object.fromEntries(
              entity.fields.map((field) => [
                field.key,
                field.type === "money" && values[field.key] !== ""
                  ? decimalToMinor(values[field.key])
                  : field.type === "datetime" && values[field.key]
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
            const clean = validateRecord(entity, data);
            let resources: AppointmentResources | undefined;
            if (entity.id === "appointments") {
              const cancelling = !!record && clean.status === "Cancelled";
              if (
                cancelling &&
                retainedEquipment &&
                (additionalEquipment !== retainedEquipment ||
                  clean.resource !== record.data.resource)
              )
                throw Error(
                  "Cancel with the retained resources first; changes require a separate review.",
                );
              const primary = records.find((r) => r.id === clean.resource);
              if (
                !cancelling &&
                coordinatedEnabled &&
                ["Crew", "Worker"].includes(String(primary?.data.kind))
              ) {
                if (!bookingConfirmed)
                  throw Error(
                    "Review and confirm the primary and optional equipment commitments.",
                  );
                resources = reviewAppointmentResources(
                  configRevision,
                  records,
                  equipmentMappings,
                  String(clean.resource),
                  additionalEquipment || null,
                );
              } else if (!cancelling && additionalEquipment)
                throw Error(
                  "Choose a Crew/Worker primary and enable coordinated scheduling before changing both resources.",
                );
            }
            const body = JSON.stringify(
              resources ? { clean, resources } : clean,
            );
            if (command.current?.body !== body)
              command.current = { body, id: crypto.randomUUID() };
            await onSave(clean, command.current!.id, resources);
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
          {entity.fields
            .filter(
              (f) =>
                !(
                  entity.id === "stock-movements" &&
                  (f.key === "product_revision" ||
                    (f.key === "correction" &&
                      !["owner", "admin"].includes(role)))
                ),
            )
            .map((field) => {
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
                      {field.options
                        ?.filter(
                          (option) =>
                            entity.id !== "stock-movements" ||
                            field.key !== "action" ||
                            ["owner", "admin"].includes(role) ||
                            !option.startsWith("Adjustment"),
                        )
                        .map((option) => (
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
                      inputMode={
                        field.type === "stock"
                          ? "numeric"
                          : field.type === "money"
                            ? "decimal"
                            : undefined
                      }
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
                        (entity.id === "appointments" &&
                          field.key === "scheduled_date") ||
                        (!!record &&
                          entity.id === "equipment" &&
                          field.key === "asset_id")
                      }
                    />
                  )}
                  {field.type === "datetime" && (
                    <>
                      <label
                        className="clock-label"
                        htmlFor={`${id}-occurrence`}
                      >
                        {field.label} clock occurrence
                      </label>
                      <select
                        id={`${id}-occurrence`}
                        value={occurrences[field.key] ?? "reject"}
                        onChange={(e) =>
                          setOccurrences({
                            ...occurrences,
                            [field.key]: e.target.value as
                              | "reject"
                              | "earlier"
                              | "later",
                          })
                        }
                      >
                        <option value="reject">
                          Reject repeated clock time
                        </option>
                        <option value="earlier">First occurrence</option>
                        <option value="later">Second occurrence</option>
                      </select>
                    </>
                  )}
                </div>
              );
            })}
        </div>
        {entity.id === "appointments" &&
          coordinatedEnabled &&
          ["Crew", "Worker"].includes(
            String(records.find((r) => r.id === values.resource)?.data.kind),
          ) && (
            <section
              className="stack"
              aria-label="Review appointment resources"
            >
              <label htmlFor={prefix + "-additional-equipment"}>
                Additional equipment (optional)
              </label>
              <select
                id={prefix + "-additional-equipment"}
                value={additionalEquipment}
                onChange={(e) => {
                  setAdditionalEquipment(e.target.value);
                  setBookingConfirmed(false);
                }}
              >
                <option value="">No additional equipment</option>
                {records
                  .filter(
                    (r) =>
                      r.entity === "resources" &&
                      r.data.kind === "Equipment" &&
                      (!r.archived || r.id === additionalEquipment),
                  )
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {String(r.data.name)}
                      {r.archived ? " (archived)" : ""}
                    </option>
                  ))}
              </select>
              <p>
                <strong>Primary:</strong>{" "}
                {relatedLabel(values.resource, records)} · resource revision{" "}
                {records.find((r) => r.id === values.resource)?.revision}.{" "}
                <strong>Additional:</strong>{" "}
                {additionalEquipment
                  ? relatedLabel(additionalEquipment, records)
                  : "None"}
                . Configuration revision {configRevision}.
              </p>
              {additionalEquipment && (
                <p className="equipment-warning">
                  {equipmentMappings
                    .filter(
                      (m) => m.active && m.resource_id === additionalEquipment,
                    )
                    .map((m) => (
                      <span key={m.equipment_id}>
                        Physical machine:{" "}
                        {relatedLabel(m.equipment_id, records)} · permanent ID{" "}
                        {String(
                          records.find((r) => r.id === m.equipment_id)?.data
                            .asset_id ?? "Unavailable",
                        )}{" "}
                        · mapping revision {m.revision}.{" "}
                        {equipmentReservationWarning(
                          equipmentStates.find(
                            (s) => s.record_id === m.equipment_id,
                          ),
                          equipmentCheckouts,
                          m.equipment_id,
                        )}
                        .{" "}
                      </span>
                    ))}
                  {!equipmentMappings.some(
                    (m) => m.active && m.resource_id === additionalEquipment,
                  ) &&
                    "No reviewed physical mapping — this equipment cannot be reserved."}
                </p>
              )}
              <p>
                Both resources, when selected, use the same appointment
                interval. The final database transaction checks conflicts and
                availability. This preview does not guarantee collection or
                reserve equipment before saving. Physical checkout stays
                separate.
              </p>
              {values.status !== "Cancelled" && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={bookingConfirmed}
                    required
                    onChange={(e) => setBookingConfirmed(e.target.checked)}
                  />
                  I reviewed the primary resource and optional equipment for
                  this exact appointment.
                </label>
              )}
            </section>
          )}
        {entity.id === "stock-movements" && (
          <>
            <p role="status">
              {converted
                ? `${values.quantity} ${values.package.toLowerCase()} = ${converted} individual units. ${values.action === "Transfer" ? "Source decreases and destination increases atomically." : ["Usage", "Adjustment decrease"].includes(values.action) ? "This decreases available stock." : "This increases available stock."}`
                : "Select a product and enter a positive whole quantity."}
            </p>
            <label className="check-label">
              <input
                type="checkbox"
                required
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />{" "}
              I reviewed this fictional stock movement and its locations.
            </label>
          </>
        )}
        {entity.id === "appointments" &&
          records.find((r) => r.id === values.resource)?.data.kind ===
            "Equipment" && (
            <p className="equipment-warning">
              {equipmentMappings
                .filter((m) => m.active && m.resource_id === values.resource)
                .map((m) => (
                  <span key={m.equipment_id}>
                    Physical equipment: {relatedLabel(m.equipment_id, records)}{" "}
                    ·{" "}
                    {equipmentReservationWarning(
                      equipmentStates.find(
                        (s) => s.record_id === m.equipment_id,
                      ),
                      equipmentCheckouts,
                      m.equipment_id,
                    )}
                    .{" "}
                  </span>
                ))}
              {!equipmentMappings.some(
                (m) => m.active && m.resource_id === values.resource,
              ) &&
                (equipmentReservationsEnabled
                  ? "No reviewed physical mapping — this booking will refuse."
                  : "Legacy resource only — no physical-machine identity or availability is established.")}{" "}
              One resource per appointment; physical checkout is separate.
            </p>
          )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="form-footer">
          <span className="muted">* Required · fictional data only</span>
          <button disabled={busy} type="submit">
            {busy
              ? "Saving…"
              : entity.id === "stock-movements"
                ? "Post stock movement"
                : "Save record"}
          </button>
        </div>
      </form>
    </section>
  );
}
