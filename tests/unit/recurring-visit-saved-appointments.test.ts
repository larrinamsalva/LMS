import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import {
  savedAppointmentsOnPlannedDates,
  savedAppointmentStatusesOnPlannedDates,
  savedDateCoverage,
  cancelledOnlySavedDateCount,
  cancelledOnlySavedDateList,
  nextProposedDateBySavedCoverage,
  previousProposedDateBySavedCoverage,
} from "../../src/core/recurring-visit-saved-appointments";
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

it("summarizes distinct proposed dates with any non-archived saved record, not booked series", () => {
  const dates = ["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"];
  const records = [
    appointment("2026-11-06T18:00:00Z", "2026-11-06T19:00:00Z"),
    appointment("2026-11-06T20:00:00Z", "2026-11-06T21:00:00Z", false, "Completed"),
    appointment("2026-11-07T06:30:00Z", "2026-11-07T08:15:00Z", false, "Cancelled"),
    appointment("2026-11-08T18:00:00Z", "2026-11-08T19:00:00Z", true),
    appointment("corrupt", "2026-11-10T18:00:00Z"),
    otherRecord(),
  ];
  const original = structuredClone(records);
  const statuses = savedAppointmentStatusesOnPlannedDates(
    dates, records, "America/Los_Angeles",
  );
  // One date may contain multiple saved records, and one overnight
  // record may overlap two dates. Both remain distinct calendar dates.
  expect(statuses.map((row) => row.savedAppointments)).toEqual([3, 1, 0, 0]);
  expect(savedDateCoverage(statuses)).toEqual({ withSaved: 2, withoutSaved: 2 });
  expect(records).toEqual(original);
  expect(dates).toEqual(["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"]);
});

it("saved date coverage is empty-safe and reports zero/complete mixes without booking claims", () => {
  expect(savedDateCoverage([])).toEqual({ withSaved: 0, withoutSaved: 0 });
  const dates = previewRecurringVisitDates("2026-11-06", 4, 6);
  const noRecords = savedAppointmentStatusesOnPlannedDates(dates, [], "UTC");
  expect(savedDateCoverage(noRecords)).toEqual({ withSaved: 0, withoutSaved: 6 });
  const everyDate = dates.map((date) =>
    appointment(date + "T10:00:00Z", date + "T11:00:00Z"),
  );
  const rows = savedAppointmentStatusesOnPlannedDates(dates, everyDate, "UTC");
  expect(savedDateCoverage(rows)).toEqual({ withSaved: 6, withoutSaved: 0 });
  const before = structuredClone(rows);
  expect(savedDateCoverage([...rows].reverse()))
    .toEqual({ withSaved: 6, withoutSaved: 0 });
  expect(rows).toEqual(before);
  // A cancelled, non-archived appointment still contributes to the
  // same-date count, not to a proposed-series booking confirmation.
  const cancelled = dates.map((date) =>
    appointment(date + "T10:00:00Z", date + "T11:00:00Z", false, "Cancelled"),
  );
  expect(savedDateCoverage(savedAppointmentStatusesOnPlannedDates(
    dates, cancelled, "UTC",
  ))).toEqual({ withSaved: 6, withoutSaved: 0 });
});

it("reviews only strictly later proposed dates by saved record presence", () => {
  const dates = previewRecurringVisitDates("2026-11-06", 1, 6);
  const records = [
    appointment("2026-11-06T10:00:00Z", "2026-11-06T11:00:00Z"),
    appointment("2026-11-20T10:00:00Z", "2026-11-20T11:00:00Z"),
    appointment("2026-11-27T10:00:00Z", "2026-11-27T11:00:00Z", false, "Cancelled"),
    appointment("2026-11-13T10:00:00Z", "2026-11-13T11:00:00Z", true),
  ];
  // The weekly proposal includes Nov 6, 13, 20, 27, Dec 4, 11.
  const rows = savedAppointmentStatusesOnPlannedDates(dates, records, "UTC");
  expect(rows.map((row) => row.savedAppointments)).toEqual([1, 0, 1, 1, 0, 0]);
  const unchanged = structuredClone(rows);
  expect(nextProposedDateBySavedCoverage(rows, "2026-11-06", "with-saved"))
    .toBe("2026-11-20");
  expect(nextProposedDateBySavedCoverage(rows, "2026-11-06", "without-saved"))
    .toBe("2026-11-13");
  expect(nextProposedDateBySavedCoverage(rows, "2026-11-20", "with-saved"))
    .toBe("2026-11-27");
  expect(nextProposedDateBySavedCoverage(rows, "2026-11-27", "without-saved"))
    .toBe("2026-12-04");
  expect(nextProposedDateBySavedCoverage(rows, "2026-11-27", "with-saved"))
    .toBeNull();
  expect(nextProposedDateBySavedCoverage(rows, "2026-12-11", "without-saved"))
    .toBeNull();
  // Neither category wraps around to earlier dates.
  expect(nextProposedDateBySavedCoverage(rows, "2026-12-11", "with-saved"))
    .toBeNull();
  expect(rows).toEqual(unchanged);
});

it("coverage review shortcuts handle empty, all-saved, no-saved and off-plan agenda dates", () => {
  const dates = previewRecurringVisitDates("2026-11-06", 4, 4);
  expect(nextProposedDateBySavedCoverage([], dates[0], "with-saved"))
    .toBeNull();
  const empty = savedAppointmentStatusesOnPlannedDates(dates, [], "UTC");
  expect(nextProposedDateBySavedCoverage(empty, dates[0], "with-saved"))
    .toBeNull();
  expect(nextProposedDateBySavedCoverage(empty, dates[0], "without-saved"))
    .toBe(dates[1]);
  // With an off-plan calendar date, choose only strictly later dates.
  expect(nextProposedDateBySavedCoverage(empty, "2026-11-20", "without-saved"))
    .toBe(dates[1]);
  const records = dates.map((date) =>
    appointment(date + "T10:00:00Z", date + "T11:00:00Z"),
  );
  const covered = savedAppointmentStatusesOnPlannedDates(dates, records, "UTC");
  expect(nextProposedDateBySavedCoverage(covered, dates[0], "without-saved"))
    .toBeNull();
  expect(nextProposedDateBySavedCoverage(covered, dates[0], "with-saved"))
    .toBe(dates[1]);
  expect(nextProposedDateBySavedCoverage(covered, dates[3], "with-saved"))
    .toBeNull();
});

it("reviews only the closest strictly earlier date with or without saved records", () => {
  const dates = previewRecurringVisitDates("2026-11-06", 1, 6);
  const records = [
    appointment("2026-11-06T10:00:00Z", "2026-11-06T11:00:00Z"),
    appointment("2026-11-20T10:00:00Z", "2026-11-20T11:00:00Z", false, "Completed"),
    appointment("2026-11-27T10:00:00Z", "2026-11-27T11:00:00Z", false, "Cancelled"),
    appointment("2026-11-13T10:00:00Z", "2026-11-13T11:00:00Z", true),
    otherRecord(),
  ];
  const original = structuredClone(records);
  const rows = savedAppointmentStatusesOnPlannedDates(dates, records, "UTC");
  expect(rows.map((row) => row.savedAppointments)).toEqual([1, 0, 1, 1, 0, 0]);
  const unchanged = structuredClone(rows);
  expect(previousProposedDateBySavedCoverage(rows, "2026-11-27", "with-saved"))
    .toBe("2026-11-20");
  expect(previousProposedDateBySavedCoverage(rows, "2026-11-27", "without-saved"))
    .toBe("2026-11-13");
  expect(previousProposedDateBySavedCoverage(rows, "2026-12-11", "with-saved"))
    .toBe("2026-11-27");
  expect(previousProposedDateBySavedCoverage(rows, "2026-12-11", "without-saved"))
    .toBe("2026-12-04");
  expect(previousProposedDateBySavedCoverage(rows, "2026-11-20", "with-saved"))
    .toBe("2026-11-06");
  expect(previousProposedDateBySavedCoverage(rows, "2026-11-20", "without-saved"))
    .toBe("2026-11-13");
  // The first proposed visit never selects itself or wraps to the last.
  expect(previousProposedDateBySavedCoverage(rows, "2026-11-06", "with-saved"))
    .toBeNull();
  expect(previousProposedDateBySavedCoverage(rows, "2026-11-06", "without-saved"))
    .toBeNull();
  // Off-plan agenda dates still permit only strictly earlier dates.
  expect(previousProposedDateBySavedCoverage(rows, "2026-11-15", "with-saved"))
    .toBe("2026-11-06");
  expect(previousProposedDateBySavedCoverage(rows, "2026-11-15", "without-saved"))
    .toBe("2026-11-13");
  expect(rows).toEqual(unchanged);
  expect(records).toEqual(original);
});

it("backward saved-date review handles empty, all-saved, all-empty and no-match inputs", () => {
  const dates = previewRecurringVisitDates("2026-11-06", 4, 4);
  expect(previousProposedDateBySavedCoverage([], dates[3], "with-saved"))
    .toBeNull();
  const empty = savedAppointmentStatusesOnPlannedDates(dates, [], "UTC");
  expect(previousProposedDateBySavedCoverage(empty, dates[3], "with-saved"))
    .toBeNull();
  expect(previousProposedDateBySavedCoverage(empty, dates[3], "without-saved"))
    .toBe(dates[2]);
  expect(previousProposedDateBySavedCoverage(empty, dates[1], "without-saved"))
    .toBe(dates[0]);
  const records = dates.map((date) =>
    appointment(date + "T10:00:00Z", date + "T11:00:00Z"),
  );
  const covered = savedAppointmentStatusesOnPlannedDates(dates, records, "UTC");
  expect(previousProposedDateBySavedCoverage(covered, dates[3], "without-saved"))
    .toBeNull();
  expect(previousProposedDateBySavedCoverage(covered, dates[3], "with-saved"))
    .toBe(dates[2]);
  expect(previousProposedDateBySavedCoverage(covered, dates[0], "with-saved"))
    .toBeNull();
});

it("counts dates with only cancelled non-archived records without conflating blank, mixed or other statuses", () => {
  const dates = ["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11"];
  const records = [
    appointment("2026-11-06T10:00:00Z", "2026-11-06T11:00:00Z", false, "Cancelled"),
    appointment("2026-11-06T12:00:00Z", "2026-11-06T13:00:00Z", false, "Cancelled"),
    appointment("2026-11-07T10:00:00Z", "2026-11-07T11:00:00Z", false, "Cancelled"),
    appointment("2026-11-07T12:00:00Z", "2026-11-07T13:00:00Z", false, "Scheduled"),
    appointment("2026-11-08T10:00:00Z", "2026-11-08T11:00:00Z", true, "Cancelled"),
    appointment("2026-11-09T10:00:00Z", "2026-11-09T11:00:00Z", false, "Other"),
    appointment("2026-11-10T10:00:00Z", "2026-11-10T11:00:00Z", false, "Completed"),
    appointment("corrupt", "2026-11-11T11:00:00Z", false, "Cancelled"),
    otherRecord(),
  ];
  const original = structuredClone(records);
  const statuses = savedAppointmentStatusesOnPlannedDates(dates, records, "UTC");
  expect(statuses.map((r) => [r.savedAppointments, r.cancelled])).toEqual([
    [2, 2], [2, 1], [0, 0], [1, 0], [1, 0], [0, 0],
  ]);
  expect(cancelledOnlySavedDateCount(statuses)).toBe(1);
  expect(savedDateCoverage(statuses)).toEqual({ withSaved: 4, withoutSaved: 2 });
  expect(records).toEqual(original);
  expect(dates).toEqual(["2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11"]);
  expect(cancelledOnlySavedDateCount([...statuses].reverse())).toBe(1);
  expect(cancelledOnlySavedDateCount([])).toBe(0);
});

it("cancelled-only dates use the existing business-local overnight and DST boundaries", () => {
  const records = [
    // Nov 6, 23:30 -> Nov 7, 00:15 Pacific: both dates count as cancelled-only.
    appointment("2026-11-07T06:30:00Z", "2026-11-07T08:15:00Z", false, "Cancelled"),
    // A completed appointment on Nov 7 removes Nov 7 from cancelled-only,
    // but does not change the Nov 6 classification.
    appointment("2026-11-07T18:00:00Z", "2026-11-07T19:00:00Z", false, "Completed"),
    // The fall-back repeated hour on Nov 1 is 25 hours locally.
    appointment("2026-11-01T08:30:00Z", "2026-11-01T09:15:00Z", false, "Cancelled"),
  ];
  const statuses = savedAppointmentStatusesOnPlannedDates(
    ["2026-11-01", "2026-11-06", "2026-11-07", "2026-11-08"],
    records, "America/Los_Angeles",
  );
  expect(statuses.map((row) => [row.savedAppointments, row.cancelled])).toEqual([
    [1, 1], [1, 1], [2, 1], [0, 0],
  ]);
  expect(cancelledOnlySavedDateCount(statuses)).toBe(2);
});

it("lists exactly cancelled-only saved dates in proposal order without leaking records", () => {
  const dates = previewRecurringVisitDates("2026-11-06", 1, 6);
  const records = [
    appointment("2026-11-06T10:00:00Z", "2026-11-06T11:00:00Z", false, "Cancelled"),
    appointment("2026-11-06T12:00:00Z", "2026-11-06T13:00:00Z", false, "Cancelled"),
    appointment("2026-11-13T10:00:00Z", "2026-11-13T11:00:00Z", false, "Scheduled"),
    appointment("2026-11-20T10:00:00Z", "2026-11-20T11:00:00Z", true, "Cancelled"),
    appointment("2026-11-27T10:00:00Z", "2026-11-27T11:00:00Z", false, "Cancelled"),
    appointment("2026-11-27T13:00:00Z", "2026-11-27T14:00:00Z", false, "Completed"),
    appointment("2026-12-04T10:00:00Z", "2026-12-04T11:00:00Z", false, "Cancelled"),
    appointment("garbled", "2026-12-11T11:00:00Z", false, "Cancelled"),
    otherRecord(),
  ];
  const unchanged = structuredClone(records);
  const statuses = savedAppointmentStatusesOnPlannedDates(dates, records, "UTC");
  const snapshot = structuredClone(statuses);
  expect(cancelledOnlySavedDateList(statuses)).toEqual([
    "2026-11-06", "2026-12-04",
  ]);
  expect(cancelledOnlySavedDateCount(statuses))
    .toBe(cancelledOnlySavedDateList(statuses).length);
  expect(cancelledOnlySavedDateList([])).toEqual([]);
  expect(records).toEqual(unchanged);
  expect(statuses).toEqual(snapshot);
  expect(dates).toEqual(previewRecurringVisitDates("2026-11-06", 1, 6));
});

it("cancelled-only date list respects local midnight overlaps and is empty on no-saved proposals", () => {
  const dates = ["2026-11-06", "2026-11-07", "2026-11-08"];
  const cancelled = [
    appointment("2026-11-07T06:30:00Z", "2026-11-07T08:15:00Z", false, "Cancelled"),
  ];
  const statuses = savedAppointmentStatusesOnPlannedDates(
    dates, cancelled, "America/Los_Angeles",
  );
  expect(cancelledOnlySavedDateList(statuses)).toEqual([
    "2026-11-06", "2026-11-07",
  ]);
  expect(cancelledOnlySavedDateList(savedAppointmentStatusesOnPlannedDates(
    dates, [], "America/Los_Angeles",
  ))).toEqual([]);
});
