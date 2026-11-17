import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import {
  savedAppointmentStatusesOnPlannedDates,
  savedAppointmentsOnPlannedDates,
} from "../../src/core/recurring-visit-saved-appointments";
import { previewRecurringVisitDates } from "../../src/core/recurring-visit-preview";

type Row = Pick<WorkspaceRecord, "entity" | "archived" | "data">;
function appointment(start: string, end: string, status: unknown, archived = false): Row {
  return {
    entity: "appointments", archived,
    data: { start, end, status } as WorkspaceRecord["data"],
  };
}
function sumStatuses(day: ReturnType<typeof savedAppointmentStatusesOnPlannedDates>[number]) {
  return day.scheduled + day.inProgress + day.completed + day.cancelled + day.other;
}

it("discloses each saved status and preserves total-count parity without silently classing unknown as scheduled", () => {
  const start = "2026-11-06T18:00:00Z";
  const end = "2026-11-06T19:00:00Z";
  const items: Row[] = [
    appointment(start, end, "Scheduled"),
    appointment(start, end, "Scheduled"),
    appointment(start, end, "In progress"),
    appointment(start, end, "Completed"),
    appointment(start, end, "Cancelled"),
    appointment(start, end, "Legacy status"),
    appointment(start, end, null),
    appointment(start, end, "Scheduled", true),
    { entity: "work", archived: false, data: { start, end, status: "Scheduled" } },
    appointment("bad", end, "Scheduled"),
    appointment(end, start, "Scheduled"),
  ];
  const before = structuredClone(items);
  const dates = ["2026-11-06", "2026-11-07"];
  const result = savedAppointmentStatusesOnPlannedDates(dates, items, "UTC");
  expect(result).toEqual([
    { date: "2026-11-06", savedAppointments: 7,
      scheduled: 2, inProgress: 1, completed: 1, cancelled: 1, other: 2 },
    { date: "2026-11-07", savedAppointments: 0,
      scheduled: 0, inProgress: 0, completed: 0, cancelled: 0, other: 0 },
  ]);
  expect(result.every((day) => sumStatuses(day) === day.savedAppointments)).toBe(true);
  expect(savedAppointmentsOnPlannedDates(dates, items, "UTC")).toEqual(
    result.map(({ date, savedAppointments }) => ({ date, savedAppointments })),
  );
  expect(items).toEqual(before);
  expect(dates).toEqual(["2026-11-06", "2026-11-07"]);
});

it("counts overnight and DST boundary records on every matching business-local date", () => {
  const records: Row[] = [
    appointment("2026-11-07T06:30:00Z", "2026-11-07T08:15:00Z", "Scheduled"),
    appointment("2026-11-07T08:00:00Z", "2026-11-07T09:00:00Z", "Completed"),
  ];
  expect(savedAppointmentStatusesOnPlannedDates(
    ["2026-11-06", "2026-11-07", "2026-11-08"],
    records, "America/Los_Angeles",
  )).toEqual([
    { date: "2026-11-06", savedAppointments: 1,
      scheduled: 1, inProgress: 0, completed: 0, cancelled: 0, other: 0 },
    { date: "2026-11-07", savedAppointments: 2,
      scheduled: 1, inProgress: 0, completed: 1, cancelled: 0, other: 0 },
    { date: "2026-11-08", savedAppointments: 0,
      scheduled: 0, inProgress: 0, completed: 0, cancelled: 0, other: 0 },
  ]);
  const spring: Row[] = [
    appointment("2026-03-09T06:59:00Z", "2026-03-09T07:00:00Z", "Cancelled"),
    appointment("2026-03-09T07:00:00Z", "2026-03-09T07:30:00Z", "In progress"),
  ];
  const springRows = savedAppointmentStatusesOnPlannedDates(
    ["2026-03-08", "2026-03-09"], spring, "America/Los_Angeles",
  );
  expect(springRows.map((day) => day.savedAppointments)).toEqual([1, 1]);
  expect(springRows.map((day) => day.cancelled)).toEqual([1, 0]);
  expect(springRows.map((day) => day.inProgress)).toEqual([0, 1]);
});

it("preserves count parity, date ordering, statuses and immutability across 720 fictional days", () => {
  const dates = Array.from({ length: 720 }, (_, index) =>
    new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
  );
  const kinds = ["Scheduled", "In progress", "Completed", "Cancelled", "Other"] as const;
  const records: Row[] = dates.filter((_, i) => i % 9 === 0).map((date, i) =>
    appointment(date + "T15:00:00Z", date + "T16:00:00Z", kinds[i % kinds.length]),
  );
  const snapshot = structuredClone(records);
  for (const everyWeeks of [1, 2, 4] as const) {
    const list = previewRecurringVisitDates("2026-11-06", everyWeeks, 12);
    for (const proposed of [list, [...list].reverse(), dates.slice(100, 112), []]) {
      const frozen = Object.freeze([...proposed]);
      const statusRows = savedAppointmentStatusesOnPlannedDates(frozen, records, "UTC");
      const totals = savedAppointmentsOnPlannedDates(frozen, records, "UTC");
      expect(statusRows.map(({ date, savedAppointments }) => ({ date, savedAppointments })))
        .toEqual(totals);
      expect(statusRows.map((item) => item.date)).toEqual(proposed);
      for (const item of statusRows) {
        expect(sumStatuses(item)).toBe(item.savedAppointments);
        expect(item.savedAppointments).toBe(records.filter((r) =>
          String(r.data.start).slice(0, 10) === item.date,
        ).length);
      }
    }
  }
  expect(records).toEqual(snapshot);
});
