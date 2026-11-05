import {
  EquipmentCalendar,
  type EquipmentCalendarProps,
} from "./equipment-reservations";
import { useEffect, useId, useRef, useState } from "react";
import type { WorkspaceRecord } from "../core/engine";
import {
  equipmentCommandSchema,
  equipmentConfirmation,
  releaseEquipmentConfirmation,
  retireEquipmentConfirmation,
  equipmentStatus,
  equipmentIndicators,
  type EquipmentCommand,
  type EquipmentState,
  type EquipmentCheckout,
  type EquipmentEvent,
} from "../core/equipment";
import { displayTime, localTime, wallToInstant } from "../core/time";
import { money } from "../core/pricing";
import { relatedLabel } from "./schedule";
const actionNames: Record<EquipmentCommand["kind"], string> = {
  checkout: "Check out equipment",
  "begin-use": "Begin equipment use",
  return: "Return equipment",
  "report-problem": "Report equipment problem",
  "open-maintenance": "Open equipment maintenance",
  "record-service": "Record maintenance performed",
  release: "Review return to service",
  retire: "Retire equipment permanently",
};
export function EquipmentAction({
  record,
  kind,
  checkout,
  state,
  records,
  configRevision,
  zone,
  busy,
  onSave,
  onClose,
}: {
  record: WorkspaceRecord;
  kind: EquipmentCommand["kind"];
  checkout?: EquipmentCheckout;
  state?: EquipmentState;
  records: WorkspaceRecord[];
  configRevision: number;
  zone: string;
  busy: boolean;
  onSave: (input: EquipmentCommand, operationId: string) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    title = useId(),
    operation = useRef<{ text: string; id: string } | null>(null);
  const [employee, setEmployee] = useState(""),
    [resource, setResource] = useState(""),
    [work, setWork] = useState("");
  const [start, setStart] = useState(() =>
    localTime(
      new Date(Math.floor(Date.now() / 60000) * 60000).toISOString(),
      zone,
    ),
  );
  const [end, setEnd] = useState(() =>
    localTime(
      new Date(Math.floor(Date.now() / 60000) * 60000 + 86400000).toISOString(),
      zone,
    ),
  );
  const [occurrence, setOccurrence] = useState<"reject" | "earlier" | "later">(
    "reject",
  );
  const [serviceDate, setServiceDate] = useState(() =>
      localTime(new Date().toISOString(), zone).slice(0, 10),
    ),
    [inspection, setInspection] = useState(state?.next_inspection ?? "");
  const [condition, setCondition] = useState(
      kind === "report-problem" ? "Needs inspection" : "Serviceable",
    ),
    [notes, setNotes] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState("");
  const employees = records.filter(
      (r) =>
        r.entity === "employees" && !r.archived && r.data.status === "Active",
    ),
    resources = records.filter(
      (r) =>
        r.entity === "resources" &&
        !r.archived &&
        ["Worker", "Crew"].includes(String(r.data.kind)),
    ),
    works = records.filter(
      (r) =>
        !r.archived &&
        (r.entity === "tasks" || (kind === "checkout" && r.entity === "jobs")),
    );
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  const personNeeded = ["checkout", "release", "record-service"].includes(kind),
    timeNeeded = ["checkout", "return"].includes(kind),
    serviceNeeded = ["release", "record-service"].includes(kind);
  return (
    <dialog
      ref={dialog}
      className="equipment-dialog"
      aria-labelledby={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        className="stack"
        aria-busy={busy}
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || !confirmed) return;
          setError("");
          try {
            const req: Record<string, unknown> = {
              kind,
              equipmentId: record.id,
              revision: record.revision,
              configRevision,
              acknowledgement: equipmentConfirmation,
              notes,
            };
            if (kind === "report-problem") req.condition = condition;
            const employeeRecord = records.find((r) => r.id === employee),
              resourceRecord = records.find((r) => r.id === resource),
              workRecord = records.find((r) => r.id === work);
            if (personNeeded)
              Object.assign(req, {
                employeeId: employee,
                employeeRevision: employeeRecord?.revision,
              });
            if (kind === "checkout")
              Object.assign(req, {
                resourceId: resource || null,
                resourceRevision: resourceRecord?.revision ?? null,
                workId: work || null,
                workRevision: workRecord?.revision ?? null,
                checkedOutAt: wallToInstant(start, zone, occurrence),
                expectedReturnAt: wallToInstant(end, zone, occurrence),
              });
            if (kind === "return" || kind === "begin-use")
              Object.assign(req, {
                checkoutId: checkout?.id,
                checkoutRevision: checkout?.revision,
              });
            if (kind === "return")
              Object.assign(req, {
                returnedAt: wallToInstant(start, zone, occurrence),
                condition,
              });
            if (kind === "open-maintenance")
              Object.assign(req, {
                workId: work,
                workRevision: workRecord?.revision,
              });
            if (serviceNeeded)
              Object.assign(req, {
                serviceDate,
                nextInspection: inspection || null,
              });
            if (kind === "release")
              req.confirmation = releaseEquipmentConfirmation;
            if (kind === "retire")
              req.confirmation = retireEquipmentConfirmation;
            const input = equipmentCommandSchema.parse(req),
              text = JSON.stringify(input);
            if (operation.current?.text !== text)
              operation.current = { text, id: crypto.randomUUID() };
            await onSave(input, operation.current.id);
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : "Review the equipment action before retrying.",
            );
          }
        }}
      >
        <span className="eyebrow">Fictional equipment · explicit review</span>
        <h2 id={title}>{actionNames[kind]}</h2>
        <p>
          <strong>{String(record.data.name)}</strong> ·{" "}
          {String(record.data.asset_id)} · equipment revision {record.revision}
        </p>
        {checkout && (
          <p>
            Held by {relatedLabel(checkout.employee_id, records)} · checkout
            revision {checkout.revision}
          </p>
        )}
        {personNeeded && (
          <label>
            {kind === "checkout"
              ? "Responsible employee"
              : "Technician / inspector"}
            <select
              required
              value={employee}
              onChange={(e) => setEmployee(e.target.value)}
            >
              <option value="">Choose an active employee</option>
              {employees.map((r) => (
                <option key={r.id} value={r.id}>
                  {String(r.data.name)}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "checkout" && (
          <>
            <label>
              Optional crew / worker resource
              <select
                value={resource}
                onChange={(e) => setResource(e.target.value)}
              >
                <option value="">Individual custody only</option>
                {resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {String(r.data.name)}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">
              Crew selection requires the named employee's effective membership
              at checkout. Custody stays with that employee until return;
              calendars and payroll stay separate.
            </p>
          </>
        )}
        {(kind === "checkout" || kind === "open-maintenance") && (
          <label>
            {kind === "checkout"
              ? "Optional linked job / task"
              : "Open maintenance task"}
            <select
              required={kind === "open-maintenance"}
              value={work}
              onChange={(e) => setWork(e.target.value)}
            >
              <option value="">
                {kind === "checkout"
                  ? "No linked work"
                  : "Choose an existing open task"}
              </option>
              {works.map((r) => (
                <option key={r.id} value={r.id}>
                  {String(r.data.title)}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "open-maintenance" && (
          <p className="muted">
            Create the work in Tasks first, then link it here. Recording
            completed service and reviewing release are separate actions.
          </p>
        )}
        {timeNeeded && (
          <>
            <p>
              Business time zone: <strong>{zone}</strong>
            </p>
            <label>
              {kind === "checkout" ? "Checkout time" : "Actual return time"}
              <input
                type="datetime-local"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            {kind === "checkout" && (
              <label>
                Expected return time
                <input
                  type="datetime-local"
                  required
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
            )}
            <label>
              Repeated clock-time choice
              <select
                value={occurrence}
                onChange={(e) =>
                  setOccurrence(e.target.value as typeof occurrence)
                }
              >
                <option value="reject">Require an unambiguous time</option>
                <option value="earlier">First occurrence</option>
                <option value="later">Second occurrence</option>
              </select>
            </label>
          </>
        )}
        {kind === "report-problem" && (
          <label>
            Reported condition
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
            >
              <option>Needs inspection</option>
              <option>Out of service</option>
            </select>
          </label>
        )}
        {kind === "return" && (
          <>
            <label>
              Observed return condition
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
              >
                <option>Serviceable</option>
                <option>Needs inspection</option>
                <option>Out of service</option>
              </select>
            </label>
            <p className="equipment-warning">
              A serviceable return never clears an unresolved problem or
              maintenance restriction.
            </p>
          </>
        )}
        {serviceNeeded && (
          <div className="field-grid">
            <label>
              Service / inspection date
              <input
                type="date"
                required
                value={serviceDate}
                onChange={(e) => setServiceDate(e.target.value)}
              />
            </label>
            <label>
              Next inspection date (optional)
              <input
                type="date"
                value={inspection}
                onChange={(e) => setInspection(e.target.value)}
              />
            </label>
          </div>
        )}
        {kind === "release" && (
          <p className="equipment-warning">
            Confirm inspection passed and all required repair/service has been
            completed. This review is required before the item becomes
            Available.
          </p>
        )}
        {kind === "retire" && (
          <p className="equipment-warning">
            Permanent retirement is terminal. It retains the equipment ID,
            records and full history, and cannot erase custody or free a
            retained identifier.
          </p>
        )}
        <label>
          {serviceNeeded ? "Inspection / repair notes" : "Reason / issues"}
          <textarea
            required
            minLength={8}
            maxLength={1000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          {kind === "retire"
            ? "I explicitly confirm permanent fictional equipment retirement."
            : kind === "release"
              ? "I confirm the equipment is inspected and safe to return to service."
              : "I reviewed the exact equipment and assignment revisions and confirm this fictional action."}
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel equipment review
          </button>
          <button disabled={busy || !confirmed}>
            {busy ? "Saving…" : "Confirm equipment action"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
export function EquipmentWorkspace({
  records,
  states,
  checkouts,
  events,
  zone,
  canManage,
  canOperate,
  busy,
  onAdd,
  onEdit,
  onAction,
  calendar,
  focusedEquipmentId,
  onClearEquipmentFocus,
}: {
  calendar: EquipmentCalendarProps;
  records: WorkspaceRecord[];
  states: EquipmentState[];
  checkouts: EquipmentCheckout[];
  events: EquipmentEvent[];
  zone: string;
  canManage: boolean;
  canOperate: boolean;
  busy: boolean;
  onAdd: () => void;
  onEdit: (record: WorkspaceRecord) => void;
  focusedEquipmentId?: string | null;
  onClearEquipmentFocus?: () => void;
  onAction: (
    record: WorkspaceRecord,
    kind: EquipmentCommand["kind"],
    checkout?: EquipmentCheckout,
  ) => void;
}) {
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("All"),
    [location, setLocation] = useState(""),
    [employee, setEmployee] = useState(""),
    [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), 60000);
    return () => clearInterval(timer);
  }, []);
  const all = records.filter((r) => r.entity === "equipment"),
    locations = records.filter((r) => r.entity === "stock-locations"),
    employees = records.filter((r) => r.entity === "employees");
  const focused = focusedEquipmentId
    ? all.find((r) => r.id === focusedEquipmentId && !r.archived)
    : undefined;
  const rows = all.filter((r) => {
    const s = states.find((s) => s.record_id === r.id),
      c = checkouts.find((c) => c.equipment_id === r.id && !c.returned_at);
    return (
      (!focusedEquipmentId || (!!focused && r.id === focusedEquipmentId)) &&
      [
        r.data.name,
        r.data.asset_id,
        r.data.barcode,
        r.data.serial,
        r.data.category,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!location || r.data.location === location) &&
      (!employee || c?.employee_id === employee) &&
      (status === "All" ||
        (!!s && (equipmentStatus(s, c) === status || s.condition === status)))
    );
  });
  return (
    <section className="panel stack" aria-labelledby="equipment-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Reusable assets · fictional custody</span>
          <h2 id="equipment-heading">Equipment & Tools</h2>
        </div>
        <button disabled={!canManage || busy} onClick={onAdd}>
          + Add equipment item
        </button>
      </div>
      {focusedEquipmentId && (
        <div className="record-focus" role="status">
          <span>
            {focused
              ? <>Showing the exact equipment item selected in Daily Operations: <strong>{String(focused.data.name)}</strong>.</>
              : "The selected equipment item is no longer available in this list."}
          </span>
          <button className="secondary" type="button" onClick={onClearEquipmentFocus}>
            Show all equipment
          </button>
        </div>
      )}
      <p>
        Track individual machines and tools separately from consumable stock.
        New items require inspection. Checkout ownership, physical condition and
        maintenance are separate; returning an item cannot clear an unresolved
        problem. Optional purchase cost is non-accounting metadata.
      </p>
      <div className="field-grid">
        <label>
          Search equipment
          <input
            type="search"
            value={query}
            onChange={(e) => {
              onClearEquipmentFocus?.();
              setQuery(e.target.value);
            }
            placeholder="Name, ID, asset tag, serial or category"
          />
        </label>
        <label>
          Equipment status
          <select value={status} onChange={(e) => {
            onClearEquipmentFocus?.();
            setStatus(e.target.value);
          }}>
            {[
              "All",
              "Available",
              "Checked out",
              "In use",
              "Needs inspection",
              "Under maintenance",
              "Out of service",
              "Retired",
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Equipment location
          <select
            value={location}
            onChange={(e) => {
              onClearEquipmentFocus?.();
              setLocation(e.target.value);
            }
          >
            <option value="">All storage locations</option>
            {locations.map((r) => (
              <option key={r.id} value={r.id}>
                {String(r.data.name)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Equipment assigned employee
          <select
            value={employee}
            onChange={(e) => {
              onClearEquipmentFocus?.();
              setEmployee(e.target.value);
            }
          >
            <option value="">All employees / unassigned</option>
            {employees.map((r) => (
              <option key={r.id} value={r.id}>
                {String(r.data.name)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p aria-live="polite">
        {rows.length} matching equipment items ·{" "}
        {
          all.filter((r) => {
            const s = states.find((s) => s.record_id === r.id);
            return (
              s?.condition === "Serviceable" &&
              !checkouts.some((c) => c.equipment_id === r.id && !c.returned_at)
            );
          }).length
        }{" "}
        available · {checkouts.filter((c) => !c.returned_at).length} checked out
      </p>
      <div className="workforce-grid">
        {rows.map((r) => {
          const s = states.find((s) => s.record_id === r.id),
            c = checkouts.find(
              (c) => c.equipment_id === r.id && !c.returned_at,
            );
          if (!s)
            return (
              <article key={r.id} className="equipment-warning">
                <h3>{String(r.data.name)}</h3>
                <p>
                  Equipment state is unavailable. Inspection is required;
                  actions refuse.
                </p>
              </article>
            );
          const flags = equipmentIndicators(s, c, now, zone),
            available = s.condition === "Serviceable" && !c;
          const action = (
            kind: EquipmentCommand["kind"],
            label: string,
            admin = false,
          ) => (
            <button
              key={kind}
              className="secondary"
              disabled={busy || !(admin ? canManage : canOperate)}
              onClick={() => onAction(r, kind, c)}
            >
              {label}
            </button>
          );
          return (
            <article
              key={r.id}
              className="workforce-card"
              aria-label={`Equipment ${r.data.name}`}
            >
              <h3>{String(r.data.name)}</h3>
              <EquipmentCalendar
                key={`${r.revision}:${calendar.configRevision}:${calendar.mappings.find((m) => m.equipment_id === r.id)?.revision ?? 0}`}
                equipment={r}
                state={s}
                checkouts={checkouts}
                records={records}
                calendar={calendar}
                zone={zone}
                canManage={canManage}
                busy={busy}
              />
              <span className="badge">{equipmentStatus(s, c)}</span>
              <p>
                Equipment ID: <strong>{String(r.data.asset_id)}</strong> ·
                revision {r.revision}
              </p>
              <p>Home storage: {relatedLabel(r.data.location, records)}</p>
              <p className={available ? "" : "equipment-warning"}>
                Physical condition: <strong>{s.condition}</strong> ·{" "}
                {available
                  ? "Available for checkout"
                  : "Unavailable for another checkout"}
              </p>
              {c && (
                <>
                  <p>
                    Held by{" "}
                    <strong>{relatedLabel(c.employee_id, records)}</strong>
                    {c.resource_id
                      ? " · " + relatedLabel(c.resource_id, records)
                      : ""}
                  </p>
                  <p>
                    Checkout:{" "}
                    {displayTime(
                      new Date(c.checked_out_at).toISOString(),
                      zone,
                    )}
                  </p>
                  <p>
                    Expected return:{" "}
                    {displayTime(
                      new Date(c.expected_return_at).toISOString(),
                      zone,
                    )}
                  </p>
                  {c.work_id && (
                    <p>Linked work: {relatedLabel(c.work_id, records)}</p>
                  )}
                </>
              )}
              {flags.overdue && (
                <p className="equipment-warning">Overdue return</p>
              )}
              {flags.inspectionDue && (
                <p className="equipment-warning">
                  Inspection due: {String(s.next_inspection).slice(0, 10)}
                </p>
              )}
              {flags.inspectionSoon && (
                <p className="equipment-warning">
                  Inspection upcoming: {String(s.next_inspection).slice(0, 10)}
                </p>
              )}
              <div className="actions">
                {available && action("checkout", "Check out")}
                {c?.status === "Checked out" &&
                  s.condition === "Serviceable" &&
                  action("begin-use", "Begin use")}
                {c && action("return", "Record return")}
                {s.condition !== "Retired" &&
                  action("report-problem", "Report problem")}
                {["Needs inspection", "Out of service"].includes(s.condition) &&
                  action("open-maintenance", "Open maintenance", true)}
                {s.maintenance === "Task opened" &&
                  !c &&
                  action("record-service", "Record service", true)}
                {["Initial inspection", "Service recorded"].includes(
                  s.maintenance,
                ) &&
                  !c &&
                  action("release", "Review release", true)}
                {s.condition !== "Retired" &&
                  !c &&
                  action("retire", "Retire equipment", true)}
                <button
                  className="quiet"
                  disabled={busy || !canManage || s.condition === "Retired"}
                  onClick={() => onEdit(r)}
                >
                  Edit equipment details
                </button>
              </div>
              <details>
                <summary>Equipment details</summary>
                <dl>
                  {[
                    ["Category", r.data.category],
                    ["Description", r.data.description],
                    ["Manufacturer", r.data.manufacturer],
                    ["Model", r.data.model],
                    ["Serial number", r.data.serial],
                    ["Barcode / asset tag", r.data.barcode],
                    ["Purchase date", r.data.purchased_on],
                    [
                      "Purchase cost (non-accounting)",
                      r.data.purchase_cost
                        ? money(String(r.data.purchase_cost))
                        : "Not recorded",
                    ],
                    ["Notes", r.data.notes],
                    [
                      "Created",
                      displayTime(new Date(r.created_at).toISOString(), zone),
                    ],
                    [
                      "Last updated",
                      displayTime(new Date(r.updated_at).toISOString(), zone),
                    ],
                  ].map(([k, v]) => (
                    <div key={String(k)}>
                      <dt>{String(k)}</dt>
                      <dd>{String(v || "Not recorded")}</dd>
                    </div>
                  ))}
                </dl>
              </details>
              <details>
                <summary>Checkout & maintenance history</summary>
                {events
                  .filter((e) => e.record_id === r.id)
                  .map((e) => (
                    <div className="subdued equipment-event" key={e.revision}>
                      <p>
                        <strong>
                          v{e.revision} · {e.action}
                        </strong>{" "}
                        · {e.state.condition}
                      </p>
                      <p>{e.notes}</p>
                      {e.checkout && (
                        <p>
                          Responsible employee:{" "}
                          {relatedLabel(e.checkout.employee_id, records)} ·{" "}
                          {e.checkout.status}
                          {e.checkout.return_condition
                            ? " · Return condition: " +
                              e.checkout.return_condition
                            : ""}
                        </p>
                      )}
                      {e.state.work_id && (
                        <p>
                          Maintenance task:{" "}
                          {relatedLabel(e.state.work_id, records)}
                        </p>
                      )}
                      {e.state.last_service && (
                        <p>
                          Service / inspection:{" "}
                          {String(e.state.last_service).slice(0, 10)}
                        </p>
                      )}
                      {e.state.next_inspection && (
                        <p>
                          Next inspection:{" "}
                          {String(e.state.next_inspection).slice(0, 10)}
                        </p>
                      )}
                      <p>
                        Recorded by operator {e.actor_id} ·{" "}
                        {displayTime(
                          new Date(e.occurred_at).toISOString(),
                          zone,
                        )}
                      </p>
                    </div>
                  ))}
              </details>
            </article>
          );
        })}
      </div>
      {!rows.length && (
        <p className="empty-state">
          Add an individually identified equipment item or revise the search
          filters.
        </p>
      )}
    </section>
  );
}
