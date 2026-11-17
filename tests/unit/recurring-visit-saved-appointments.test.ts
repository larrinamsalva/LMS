import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import { savedAppointmentsOnPlannedDates } from "../../src/core/recurring-visit-saved-appointments";
import { previewRecurringVisitDates } from "../../src/core/recurring-visit-preview";

type SavedRecord = Pick<WorkspaceRecord, "entity" | "archived" | "data">;
function appointment(
  start: string, end: string, archived = false, status = "Scheduled",
): SavedRecord {
  return { entity: "appointments", archived, data: { start, end, status } };
}
function otherRecord(): SavedRecord {
  return { entity: "work", archived: false, data: {
    start: "2026-11-06T10:00:00Z", end: "2026-11-06T11:00:00Z",
  } };
}
it("counts non-archived saved entries on their exact business-local dates", () => {
  const dates = ["2026-11-06", "2026-11-07", "2026-11-08"];
  const records = [
    appointment("2026-11-06T18:00:00Z", "2026-11-06T19:00:00Z"),
    appointment("2026-11-06T20:00:00Z", "2026-11-06T21:00:00Z", false, "Completed"),
    appointment("2026-11-06T19:00:00Z", "2026-11-06T20:00:00Z", false, "Cancelled"),
    appointment("2026-11-06T15:00:00Z", "2026-11-06T16:00:00Z", true),
    otherRecord(),
  ];
  const before = structuredClone(records);
  const result = savedAppointmentsOnPlannedDates(dates, records, "America/Los_Angeles");
  expect(result).toEqual([
    { date: "2026-11-06", savedAppointments: 3 },
    { date: "2026-11-07", savedAppointments: 0 },
    { date: "2026-11-08", savedAppointments: 0 },
  ]);
  expect(records).toEqual(before);
  expect(dates).toEqual(["2026-11-06", "2026-11-07", "2026-11-08"]);
});

it("counts an overnight visit on both dates but not on a next-day start boundary", () => {
  const records = [
    appointment("2026-11-07T06:30:00Z", "2026-11-07T08:15:00Z"),
    // Nov 6 at 23:30 Pacific into Nov 7 at 00:15 Pacific.
    appointment("2026-11-07T08:00:00Z", "2026-11-07T09:00:00Z"),
    // Nov 7 at 00:00 Pacific: must not count on Nov 6.
  ];
  expect(savedAppointmentsOnPlannedDates(
    ["2026-11-06", "2026-11-07", "2026-11-08"],
    records, "America/Los_Angeles",
  )).toEqual([
    { date: "2026-11-06", savedAppointments: 1 },
    { date: "2026-11-07", savedAppointments: 2 },
    { date: "2026-11-08", savedAppointments: 0 },
  ]);
});

it("uses calendar-day DST boundaries, not assumed 24-hour UTC offsets", () => {
  // 2026-03-08 is 23h in Los Angeles. Next local midnight is 07:00Z.
  const spring = [
    appointment("2026-03-08T09:30:00Z", "2026-03-08T11:00:00Z"),
    appointment("2026-03-09T06:59:00Z", "2026-03-09T07:00:00Z"),
    appointment("2026-03-09T07:00:00Z", "2026-03-09T08:00:00Z"),
  ];
  expect(savedAppointmentsOnPlannedDates(
    ["2026-03-08", "2026-03-09"], spring, "America/Los_Angeles",
  )).toEqual([
    { date: "2026-03-08", savedAppointments: 2 },
    { date: "2026-03-09", savedAppointments: 1 },
  ]);
  // 2026-11-01 is 25h locally. Repeated-hour appointments both count.
  const fall = [
    appointment("2026-11-01T08:30:00Z", "2026-11-01T09:15:00Z"),
    appointment("2026-11-01T09:30:00Z", "2026-11-01T10:00:00Z"),
  ];
  expect(savedAppointmentsOnPlannedDates(
    ["2026-11-01"], fall, "America/Los_Angeles",
  )).toEqual([{ date: "2026-11-01", savedAppointments: 2 }]);
});

it("ignores invalid/corrupt stored intervals and does not mutate the snapshot", () => {
  const records = [
    appointment("garbled", "2026-11-07T20:00:00Z"),
    appointment("2026-11-06T20:00:00Z", "not-a-time"),
    appointment("2026-11-06T20:00:00Z", "2026-11-06T19:00:00Z"),
    appointment("2026-11-06T20:00:00Z", "2026-11-06T21:00:00Z"),
  ];
  expect(savedAppointmentsOnPlannedDates([], records, "UTC")).toEqual([]);
  expect(savedAppointmentsOnPlannedDates(["2026-11-06"], records, "UTC"))
    .toEqual([{ date: "2026-11-06", savedAppointments: 1 }]);
});

it("stays deterministic over 720 fictional dates, including zero counts", () => {
  const dates = Array.from({ length: 720 }, (_, index) =>
    new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
  );
  const records = dates.filter((_, index) => index % 23 === 0).map((date) =>
    appointment(date + "T16:00:00Z", date + "T17:00:00Z"),
  );
  const original = structuredClone(records);
  for (const interval of [1, 2, 4] as const) {
    const proposed = previewRecurringVisitDates("2026-11-06", interval, 12);
    for (const input of [proposed, [...proposed].reverse(), dates.slice(100, 112)]) {
      const counts = savedAppointmentsOnPlannedDates(input, records, "UTC");
      expect(counts).toHaveLength(input.length);
      expect(counts.map((item) => item.date)).toEqual(input);
      counts.forEach((item) => {
        const expected = records.filter((r) =>
          String(r.data.start).slice(0, 10) === item.date,
        ).length;
        expect(item.savedAppointments).toBe(expected);
      });
    }
  }
  expect(records).toEqual(original);
});
