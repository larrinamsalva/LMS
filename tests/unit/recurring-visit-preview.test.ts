import { expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import {
  previewRecurringVisitDates,
  plannedVisitAppointmentDraft,
  validateRecurringVisitReturnPlan,
  adjacentPlannedVisitDate,
  type VisitFrequencyWeeks,
} from "../../src/core/recurring-visit-preview";

it("previews exact weekly, fortnightly and four-week visit dates without bookings", () => {
  expect(previewRecurringVisitDates("2026-11-06", 1, 4)).toEqual([
    "2026-11-06", "2026-11-13", "2026-11-20", "2026-11-27",
  ]);
  expect(previewRecurringVisitDates("2026-11-06", 2, 4)).toEqual([
    "2026-11-06", "2026-11-20", "2026-12-04", "2026-12-18",
  ]);
  expect(previewRecurringVisitDates("2026-01-31", 4, 4)).toEqual([
    "2026-01-31", "2026-02-28", "2026-03-28", "2026-04-25",
  ]);
  expect(previewRecurringVisitDates("2020-01-01", 1, 2)).toEqual([
    "2020-01-01", "2020-01-08",
  ]);
});

it("uses business-local DATE arithmetic over DST changes, leap day and year boundaries", () => {
  expect(previewRecurringVisitDates("2026-03-01", 1, 3)).toEqual([
    "2026-03-01", "2026-03-08", "2026-03-15",
  ]);
  expect(previewRecurringVisitDates("2026-10-25", 1, 3)).toEqual([
    "2026-10-25", "2026-11-01", "2026-11-08",
  ]);
  expect(previewRecurringVisitDates("2028-02-29", 2, 3)).toEqual([
    "2028-02-29", "2028-03-14", "2028-03-28",
  ]);
  expect(previewRecurringVisitDates("2026-12-25", 1, 3)).toEqual([
    "2026-12-25", "2027-01-01", "2027-01-08",
  ]);
  // These are dates, not UTC instants or wall-clock time guesses.
  for (const date of previewRecurringVisitDates("2026-03-01", 1, 8)) {
    expect(Temporal.PlainDate.from(date).dayOfWeek).toBe(7);
  }
});

it("rejects invalid calendars, unsupported rules and date-range overflow atomically", () => {
  for (const invalid of [
    "", "2026-1-01", "2026-02-30", "2026-00-10",
    "2019-12-31", "2101-01-01", "2026-12-01T10:00",
  ]) {
    expect(() => previewRecurringVisitDates(invalid, 1, 4))
      .toThrow(RangeError);
  }
  for (const rule of [0, 3, 5, -1, 1.5, NaN]) {
    expect(() => previewRecurringVisitDates(
      "2026-11-06", rule as VisitFrequencyWeeks, 4,
    )).toThrow(RangeError);
  }
  for (const count of [0, 1, 13, 2.5, NaN, Infinity]) {
    expect(() => previewRecurringVisitDates("2026-11-06", 1, count))
      .toThrow(RangeError);
  }
  expect(previewRecurringVisitDates("2100-12-24", 1, 2))
    .toEqual(["2100-12-24", "2100-12-31"]);
  expect(() => previewRecurringVisitDates("2100-12-25", 1, 2))
    .toThrow(/on or before 2100-12-31/);
  expect(() => previewRecurringVisitDates("2100-12-31", 4, 12))
    .toThrow(/on or before 2100-12-31/);
});

it("remains deterministic and bounded across 720 fictional starts and all supported rules", () => {
  const starts = Array.from({ length: 720 }, (_, i) =>
    new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10));
  const originalStarts = structuredClone(starts);
  for (const date of starts) {
    for (const interval of [1, 2, 4] as const) {
      for (const occurrences of [2, 4, 6, 8, 12]) {
        const results = previewRecurringVisitDates(date, interval, occurrences);
        expect(results).toHaveLength(occurrences);
        expect(new Set(results).size).toBe(occurrences);
        expect(results[0]).toBe(date);
        const start = Temporal.PlainDate.from(date);
        for (let i = 0; i < results.length; i++) {
          expect(results[i]).toBe(start.add({ days: i * interval * 7 }).toString());
        }
      }
    }
  }
  expect(starts).toEqual(originalStarts);
});

it("prepares only the selected preview date; refuses unrelated or invalid draft dates", () => {
  const before = "2026-11-06";
  const selected = plannedVisitAppointmentDraft(before, 2, 4, "2026-12-04");
  expect(selected).toEqual({ scheduled_date: "2026-12-04" });
  expect(Object.keys(selected)).toEqual(["scheduled_date"]);
  expect(selected).not.toHaveProperty("start");
  expect(selected).not.toHaveProperty("end");
  expect(selected).not.toHaveProperty("customer");
  expect(selected).not.toHaveProperty("resource");
  expect(selected).not.toHaveProperty("work");
  for (const unplanned of ["2026-11-13", "2026-11-27", "2026-12-31", "", "2026-12-04T09:00"]) {
    expect(() => plannedVisitAppointmentDraft(before, 2, 4, unplanned))
      .toThrow(/date from the current recurring visit preview/);
  }
  expect(() => plannedVisitAppointmentDraft("2100-12-31", 4, 12, "2100-12-31"))
    .toThrow(/on or before 2100-12-31/);
  expect(() => plannedVisitAppointmentDraft("2026-11-06", 3 as VisitFrequencyWeeks, 4, "2026-11-06"))
    .toThrow(/Choose weekly/);
});

it("validates and copies only a transient recurrence return route", () => {
  const input = Object.freeze({
    startDate: "2026-11-06",
    everyWeeks: 4 as const,
    occurrences: 6,
    selectedDate: "2027-01-01",
  });
  const restored = validateRecurringVisitReturnPlan(input);
  expect(restored).toEqual(input);
  expect(restored).not.toBe(input);
  expect(Object.keys(restored)).toEqual([
    "startDate", "everyWeeks", "occurrences", "selectedDate",
  ]);
  expect(restored).not.toHaveProperty("start");
  expect(restored).not.toHaveProperty("end");
  expect(restored).not.toHaveProperty("resource");
  expect(restored).not.toHaveProperty("customer");
  expect(restored).not.toHaveProperty("appointment");
  for (const date of ["2026-11-13", "2027-01-02", "", "2100-12-31"]) {
    expect(() => validateRecurringVisitReturnPlan({
      ...input, selectedDate: date,
    })).toThrow(/date from the current recurring visit preview/);
  }
  expect(() => validateRecurringVisitReturnPlan({
    ...input, occurrences: 13,
  })).toThrow(/between 2 and 12/);
  expect(() => validateRecurringVisitReturnPlan({
    ...input, everyWeeks: 3 as VisitFrequencyWeeks,
  })).toThrow(/Choose weekly/);
  expect(() => validateRecurringVisitReturnPlan({
    ...input, startDate: "2100-12-31", selectedDate: "2100-12-31",
  })).toThrow(/on or before 2100-12-31/);
});

it("finds nearest preceding/following proposed date without changing the plan", () => {
  for (const interval of [1, 2, 4] as const) {
    const dates = Object.freeze(previewRecurringVisitDates("2026-11-06", interval, 6));
    const untouched = [...dates];
    for (let index = 0; index < dates.length; index++) {
      expect(adjacentPlannedVisitDate(dates, dates[index], "previous"))
        .toBe(index === 0 ? null : dates[index - 1]);
      expect(adjacentPlannedVisitDate(dates, dates[index], "next"))
        .toBe(index === dates.length - 1 ? null : dates[index + 1]);
    }
    expect(adjacentPlannedVisitDate(dates, "2020-01-01", "previous")).toBeNull();
    expect(adjacentPlannedVisitDate(dates, "2020-01-01", "next")).toBe(dates[0]);
    expect(adjacentPlannedVisitDate(dates, "2100-12-31", "previous"))
      .toBe(dates[dates.length - 1]);
    expect(adjacentPlannedVisitDate(dates, "2100-12-31", "next")).toBeNull();
    expect(adjacentPlannedVisitDate(dates, "2026-11-07", "previous"))
      .toBe(dates[0]);
    expect(adjacentPlannedVisitDate(dates, "2026-11-07", "next"))
      .toBe(dates[1]);
    expect(dates).toEqual(untouched);
  }
  expect(adjacentPlannedVisitDate([], "2026-11-06", "previous")).toBeNull();
  expect(adjacentPlannedVisitDate([], "2026-11-06", "next")).toBeNull();
});

it("keeps adjacent navigation date-only and deterministic across DST and year boundaries", () => {
  for (const start of ["2026-03-01", "2026-10-25", "2026-12-25", "2028-02-29"]) {
    for (const interval of [1, 2, 4] as const) {
      const dates = previewRecurringVisitDates(start, interval, 12);
      let current = dates[0];
      for (let i = 1; i < dates.length; i++) {
        const next = adjacentPlannedVisitDate(dates, current, "next");
        expect(next).toBe(dates[i]);
        expect(next).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        current = next!;
      }
      expect(adjacentPlannedVisitDate(dates, current, "next")).toBeNull();
    }
  }
});
