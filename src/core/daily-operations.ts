import { Temporal } from "@js-temporal/polyfill";
import type { WorkspaceSnapshot, WorkspaceRecord } from "./engine";
import { instant } from "./time";

/** Read-only observations from an already authorized, organization-scoped snapshot. */
export type DailySource = Pick<WorkspaceSnapshot, "organizationId" | "records" | "equipmentStates">;
export interface DueWork { record: WorkspaceRecord; due: string }
export interface EquipmentAttention { record: WorkspaceRecord; reason: string }
export interface UpcomingEquipmentInspection { record: WorkspaceRecord; due: string }

export function summarizeDailyOperations(snapshot: DailySource, zone: string, date: string) {
  // Local calendar days can have 23 or 25 hours during daylight-saving changes.
  const day = Temporal.PlainDate.from(date);
  // Dates one through seven after the selected business-local calendar day.
  // No millisecond/24-hour arithmetic: DST and leap days stay calendar-correct.
  const upcomingThrough = day.add({ days: 7 }).toString();
  const from = day.toZonedDateTime(zone).epochNanoseconds;
  const until = day.add({ days: 1 }).toZonedDateTime(zone).epochNanoseconds;
  // Upcoming starts the next local midnight and ends at midnight on day +8.
  // This includes starts on day +7 even across DST transitions.
  const upcomingEnd = day.add({ days: 8 }).toZonedDateTime(zone).epochNanoseconds;
  const records = snapshot.records.filter(
    (r) => r.organization_id === snapshot.organizationId && !r.archived,
  );
  // Historical appointments often share start/end instants. Reuse parsed
  // string timestamps only inside this authorized daily summary call.
  // Non-string retained values still take the original conversion path.
  const dayInstants = new Map<string, bigint>();
  const dayInstant = (value: unknown): bigint => {
    if (typeof value !== "string") return instant(String(value)).epochNanoseconds;
    const cached = dayInstants.get(value);
    if (cached !== undefined) return cached;
    const parsed = instant(value).epochNanoseconds;
    dayInstants.set(value, parsed);
    return parsed;
  };
  // Both views already parse included string starts when filtering.
  // Compare their exact epoch nanoseconds instead of reparsing during
  // every sort comparison. Non-string historical values retain original
  // Temporal.Instant.compare and per-comparison String coercion.
  const compareAppointmentStarts = (a: WorkspaceRecord, b: WorkspaceRecord): number => {
    const first = a.data.start;
    const second = b.data.start;
    if (typeof first !== "string" || typeof second !== "string") {
      return Temporal.Instant.compare(instant(String(first)), instant(String(second)));
    }
    const startA = dayInstant(first);
    const startB = dayInstant(second);
    return startA < startB ? -1 : startA > startB ? 1 : 0;
  };
  const appointments = records
    .filter(
      (r) =>
        r.entity === "appointments" &&
        r.data.status !== "Cancelled" &&
        dayInstant(r.data.start) < until &&
        dayInstant(r.data.end) > from,
    )
    .sort(compareAppointmentStarts);
  // Both appointment views use the same string timestamp parser. Reuse
  // the current-day cache for upcoming starts within this summary call:
  // no cached value can cross organization, date, or snapshot boundaries.
  // Non-string historical starts still take the original two-conversion
  // short-circuit path below without caching.
  const upcomingAppointments = records
    .filter((r) => {
      if (r.entity !== "appointments" || r.data.status === "Cancelled") {
        return false;
      }
      const value = r.data.start;
      if (typeof value !== "string") {
        return instant(String(r.data.start)).epochNanoseconds >= until &&
          instant(String(r.data.start)).epochNanoseconds < upcomingEnd;
      }
      const parsed = dayInstant(value);
      return parsed >= until && parsed < upcomingEnd;
    })
    .sort(compareAppointmentStarts);
  // Keep work without an assigned date visible, without fabricating a due date.
  const activeWork = records.filter(
    (r) =>
      (r.entity === "tasks" || r.entity === "jobs") &&
      !["Done", "Completed", "Cancelled"].includes(String(r.data.status)),
  );
  const needsScheduling = activeWork
    .filter((record) => {
      const value = record.entity === "jobs" ? record.data.date : record.data.due;
      return value === null || value === undefined ||
        (typeof value === "string" && value.trim() === "");
    })
    .sort((a, b) =>
      String(a.data.title).localeCompare(String(b.data.title)) ||
      a.id.localeCompare(b.id),
    );
  const unfinished = activeWork
    .flatMap((record): DueWork[] => {
      const value = record.entity === "jobs" ? record.data.date : record.data.due;
      // Do not invent deadlines for work that has no due date.
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? [{ record, due: value }]
        : [];
    })
    .sort((a, b) =>
      a.due.localeCompare(b.due) ||
      String(a.record.data.title).localeCompare(String(b.record.data.title)),
    );
  // Both equipment views resolve the same authorized record by ID.
  // Index only current, same-organization equipment once. Keep the FIRST
  // matching record per ID, exactly like the previous records.find() calls,
  // including duplicate IDs and separate retained historical revisions.
  const equipmentById = new Map<string, WorkspaceRecord>();
  for (const record of records) {
    if (record.entity === "equipment" && !equipmentById.has(record.id)) {
      equipmentById.set(record.id, record);
    }
  }
  // Both read-only equipment views use the identical same-organization
  // state subset. Scope it once per summary without deduplicating, sorting,
  // changing the state references, or sharing data between calls.
  const authorizedEquipmentStates = snapshot.equipmentStates.filter(
    (state) => state.organization_id === snapshot.organizationId,
  );
  // Classify each authorized state once into the two read-only views.
  // Preserve duplicate state occurrences, original reason/date predicates,
  // and each view's separate display ordering.
  const equipment: EquipmentAttention[] = [];
  const upcomingEquipmentInspections: UpcomingEquipmentInspection[] = [];
  for (const state of authorizedEquipmentStates) {
    const record = equipmentById.get(state.record_id);
    if (!record) continue;
    if (state.condition !== "Retired") {
      const reason =
        state.condition !== "Serviceable"
          ? state.condition
          : state.next_inspection && String(state.next_inspection).slice(0, 10) <= date
            ? "Inspection due"
            : "";
      if (reason) equipment.push({ record, reason });
    }
    // Look ahead only for serviceable assets with a saved next-inspection
    // date; current and overdue conditions belong in Equipment to review.
    if (state.condition === "Serviceable" && state.next_inspection) {
      const due = String(state.next_inspection).slice(0, 10);
      if (due > date && due <= upcomingThrough) {
        upcomingEquipmentInspections.push({ record, due });
      }
    }
  }
  equipment.sort((a, b) =>
    String(a.record.data.name).localeCompare(String(b.record.data.name)),
  );
  upcomingEquipmentInspections.sort((a, b) =>
    a.due.localeCompare(b.due) ||
    String(a.record.data.name).localeCompare(String(b.record.data.name)) ||
    a.record.id.localeCompare(b.record.id),
  );
  // Classify the same sorted, authorized due-work rows once instead of
  // filtering them separately for each read-only Operations panel.
  // Each branch retains the exact YYYY-MM-DD lexical comparison rules,
  // existing relative order, and original record references.
  const dueToday: DueWork[] = [];
  const overdue: DueWork[] = [];
  const upcoming: DueWork[] = [];
  for (const item of unfinished) {
    if (item.due === date) {
      dueToday.push(item);
    } else if (item.due < date) {
      overdue.push(item);
    } else if (item.due > date && item.due <= upcomingThrough) {
      upcoming.push(item);
    }
  }
  return {
    date,
    appointments,
    upcomingAppointments,
    dueToday,
    overdue,
    needsScheduling,
    upcoming,
    upcomingThrough,
    equipment,
    upcomingEquipmentInspections,
  };
}
