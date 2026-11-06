import { Temporal } from "@js-temporal/polyfill";
import type { WorkspaceSnapshot, WorkspaceRecord } from "./engine";
import { instant } from "./time";

/** Read-only observations from an already authorized, organization-scoped snapshot. */
export type DailySource = Pick<WorkspaceSnapshot, "organizationId" | "records" | "equipmentStates">;
export interface DueWork { record: WorkspaceRecord; due: string }
export interface EquipmentAttention { record: WorkspaceRecord; reason: string }

export function summarizeDailyOperations(snapshot: DailySource, zone: string, date: string) {
  // Local calendar days can have 23 or 25 hours during daylight-saving changes.
  const day = Temporal.PlainDate.from(date);
  // Dates one through seven after the selected business-local calendar day.
  // No millisecond/24-hour arithmetic: DST and leap days stay calendar-correct.
  const upcomingThrough = day.add({ days: 7 }).toString();
  const from = day.toZonedDateTime(zone).epochNanoseconds;
  const until = day.add({ days: 1 }).toZonedDateTime(zone).epochNanoseconds;
  const records = snapshot.records.filter(
    (r) => r.organization_id === snapshot.organizationId && !r.archived,
  );
  const appointments = records
    .filter(
      (r) =>
        r.entity === "appointments" &&
        r.data.status !== "Cancelled" &&
        instant(String(r.data.start)).epochNanoseconds < until &&
        instant(String(r.data.end)).epochNanoseconds > from,
    )
    .sort((a, b) =>
      Temporal.Instant.compare(
        instant(String(a.data.start)),
        instant(String(b.data.start)),
      ),
    );
  const unfinished = records
    .filter(
      (r) =>
        (r.entity === "tasks" || r.entity === "jobs") &&
        !["Done", "Completed", "Cancelled"].includes(String(r.data.status)),
    )
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
  const equipment = snapshot.equipmentStates
    .filter((state) => state.organization_id === snapshot.organizationId)
    .flatMap((state): EquipmentAttention[] => {
      const record = records.find(
        (r) => r.entity === "equipment" && r.id === state.record_id,
      );
      if (!record || state.condition === "Retired") return [];
      const reason =
        state.condition !== "Serviceable"
          ? state.condition
          : state.next_inspection && String(state.next_inspection).slice(0, 10) <= date
            ? "Inspection due"
            : "";
      return reason ? [{ record, reason }] : [];
    })
    .sort((a, b) =>
      String(a.record.data.name).localeCompare(String(b.record.data.name)),
    );
  return {
    date,
    appointments,
    dueToday: unfinished.filter((item) => item.due === date),
    overdue: unfinished.filter((item) => item.due < date),
    upcoming: unfinished.filter(
      (item) => item.due > date && item.due <= upcomingThrough,
    ),
    upcomingThrough,
    equipment,
  };
}
