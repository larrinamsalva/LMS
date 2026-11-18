import { expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import {
  previewRecurringVisitDates,
  plannedVisitAppointmentDraft,
  validateRecurringVisitReturnPlan,
  adjacentPlannedVisitDate,
  plannedVisitReviewPosition,
  recurringVisitPreviewCsv,
  plannedVisitWeekday,
  recurringVisitPreviewText,
  recurringVisitPlanOverview,
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

it("reports only the currently reviewed preview-date position, never booking progress", () => {
  const all = Object.freeze(previewRecurringVisitDates("2026-11-06", 4, 6));
  const snapshot = [...all];
  expect(all).toEqual([
    "2026-11-06", "2026-12-04", "2027-01-01",
    "2027-01-29", "2027-02-26", "2027-03-26",
  ]);
  for (let index = 0; index < all.length; index++) {
    expect(plannedVisitReviewPosition(all, all[index])).toBe(index + 1);
  }
  for (const notPlanned of [
    "", "2026-11-07", "2026-11-13", "2026-12-31",
    "2027-03-27", "2026-11-06T10:00",
  ]) {
    expect(plannedVisitReviewPosition(all, notPlanned)).toBeNull();
  }
  expect(plannedVisitReviewPosition([], all[0])).toBeNull();
  expect(all).toEqual(snapshot);
});

it("finds the exact reviewed position across all three intervals and DST/leap days", () => {
  for (const start of ["2026-03-01", "2026-10-25", "2028-02-29", "2026-12-25"]) {
    for (const weeks of [1, 2, 4] as const) {
      const dates = Object.freeze(previewRecurringVisitDates(start, weeks, 12));
      for (const [index, date] of dates.entries()) {
        expect(plannedVisitReviewPosition(dates, date)).toBe(index + 1);
      }
      expect(plannedVisitReviewPosition(dates, dates[0] + "T00:00"))
        .toBeNull();
      expect(plannedVisitReviewPosition(dates, "2100-12-31"))
        .toBeNull();
    }
  }
});

it("exports only the exact bounded recurring visit dates as a CSV planning preview", () => {
  const result = recurringVisitPreviewCsv("2026-11-06", 4, 6);
  const lines = result.trimEnd().split("\r\n");
  expect(lines).toEqual([
    "Visit,Proposed date,Repeat every (weeks),Note",
    "1,2026-11-06,4,Preview only - no appointment booked by export",
    "2,2026-12-04,4,Preview only - no appointment booked by export",
    "3,2027-01-01,4,Preview only - no appointment booked by export",
    "4,2027-01-29,4,Preview only - no appointment booked by export",
    "5,2027-02-26,4,Preview only - no appointment booked by export",
    "6,2027-03-26,4,Preview only - no appointment booked by export",
  ]);
  expect(result).toBe(lines.join("\r\n") + "\r\n");
  expect(result).not.toMatch(/customer|resource|equipment|worker|appointment title|status/i);
  expect(result.split("\r\n")).toHaveLength(8);
});

it("exports canonical dates over DST, leap years and year changes without writes", () => {
  for (const start of ["2026-03-01", "2026-10-25", "2028-02-29", "2026-12-25"]) {
    for (const weeks of [1, 2, 4] as const) {
      const original = previewRecurringVisitDates(start, weeks, 12);
      const csv = recurringVisitPreviewCsv(start, weeks, 12);
      const rows = csv.trimEnd().split("\r\n").slice(1);
      expect(rows).toHaveLength(12);
      expect(rows.map((row) => row.split(",")[1])).toEqual(original);
      expect(rows.every((row, index) =>
        row.startsWith(String(index + 1) + "," + original[index] + "," + weeks + ","),
      )).toBe(true);
      expect(previewRecurringVisitDates(start, weeks, 12)).toEqual(original);
    }
  }
});

it("rejects invalid CSV plans instead of exporting partial or out-of-range dates", () => {
  for (const invalid of ["", "2026-02-30", "2101-01-01", "2026-11-06T09:00"]) {
    expect(() => recurringVisitPreviewCsv(invalid, 1, 4)).toThrow(RangeError);
  }
  expect(() => recurringVisitPreviewCsv("2100-12-31", 4, 12))
    .toThrow(/on or before 2100-12-31/);
  expect(() => recurringVisitPreviewCsv("2026-11-06", 3 as VisitFrequencyWeeks, 4))
    .toThrow(/Choose weekly/);
  expect(() => recurringVisitPreviewCsv("2026-11-06", 1, 13))
    .toThrow(/between 2 and 12/);
});

it("labels all seven weekdays on canonical business-local dates", () => {
  const dates = [
    "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19",
    "2026-11-20", "2026-11-21", "2026-11-22",
  ];
  const expected = [
    "Monday", "Tuesday", "Wednesday", "Thursday",
    "Friday", "Saturday", "Sunday",
  ];
  for (let index = 0; index < dates.length; index++) {
    expect(plannedVisitWeekday(dates[index])).toEqual({
      weekday: expected[index],
      isWeekend: index >= 5,
    });
  }
});

it("keeps weekday labels stable across DST, leap days, and calendar years", () => {
  const cases = [
    ["2026-03-07", "Saturday", true],
    ["2026-03-08", "Sunday", true],
    ["2026-03-09", "Monday", false],
    ["2026-10-31", "Saturday", true],
    ["2026-11-01", "Sunday", true],
    ["2026-11-02", "Monday", false],
    ["2028-02-29", "Tuesday", false],
    ["2026-12-31", "Thursday", false],
    ["2027-01-01", "Friday", false],
    ["2100-12-31", "Friday", false],
  ] as const;
  for (const [date, weekday, isWeekend] of cases) {
    expect(plannedVisitWeekday(date)).toEqual({ weekday, isWeekend });
  }
  for (const start of ["2026-03-01", "2026-10-25", "2028-02-29", "2026-12-25"]) {
    for (const weeks of [1, 2, 4] as const) {
      const dates = previewRecurringVisitDates(start, weeks, 12);
      const first = plannedVisitWeekday(dates[0]);
      expect(dates.map((date) => plannedVisitWeekday(date)))
        .toEqual(Array.from({ length: 12 }, () => first));
    }
  }
});

it("rejects malformed weekday labels rather than inferring a timezone or clock", () => {
  for (const invalid of [
    "", "2026-1-01", "2026-02-30", "2026-00-10",
    "2026-11-06T00:00", "2026-11-06Z",
  ]) {
    expect(() => plannedVisitWeekday(invalid)).toThrow(RangeError);
  }
});

it("copies a plain-text proposal with exact weekday/date and explicit unbooked warning", () => {
  const text = recurringVisitPreviewText("2026-11-06", 4, 6);
  expect(text).toBe([
    "LMS proposed recurring visit dates - NOT BOOKED",
    "Starts: 2026-11-06 | Repeat: every four weeks (not monthly) | Proposed visits: 6",
    "Business-local calendar dates (no appointment times or availability):",
    "1. Friday, 2026-11-06 - proposed only",
    "2. Friday, 2026-12-04 - proposed only",
    "3. Friday, 2027-01-01 - proposed only",
    "4. Friday, 2027-01-29 - proposed only",
    "5. Friday, 2027-02-26 - proposed only",
    "6. Friday, 2027-03-26 - proposed only",
    "Planning preview only. Copying does not book visits, reserve resources, or confirm staff availability.",
  ].join("\n"));
  for (const prohibited of ["customer", "address", "employee", "job title", "amount", "booking ID"]) {
    expect(text.toLowerCase()).not.toContain(prohibited.toLowerCase());
  }
});

it("copies full validated dates across supported intervals, DST and leap days", () => {
  for (const start of ["2026-03-01", "2026-10-25", "2028-02-29", "2026-12-25"]) {
    for (const weeks of [1, 2, 4] as const) {
      const dates = previewRecurringVisitDates(start, weeks, 12);
      const text = recurringVisitPreviewText(start, weeks, 12);
      const rows = text.split("\n");
      expect(rows).toHaveLength(16);
      expect(rows[0]).toContain("NOT BOOKED");
      expect(rows[2]).toContain("no appointment times or availability");
      expect(rows.at(-1)).toContain("does not book visits");
      for (const [index, date] of dates.entries()) {
        expect(rows[index + 3]).toBe(
          `${index + 1}. ${plannedVisitWeekday(date).weekday}, ${date} - proposed only`,
        );
      }
    }
  }
});

it("rejects invalid or overflowing copy proposals without partially formatted output", () => {
  for (const bad of ["", "2026-02-30", "2026-1-01", "2101-01-01", "2026-11-06T09:00"]) {
    expect(() => recurringVisitPreviewText(bad, 1, 4)).toThrow(RangeError);
  }
  expect(() => recurringVisitPreviewText("2100-12-31", 4, 12))
    .toThrow(/on or before 2100-12-31/);
  expect(() => recurringVisitPreviewText("2026-11-06", 3 as VisitFrequencyWeeks, 4))
    .toThrow(/Choose weekly/);
  expect(() => recurringVisitPreviewText("2026-11-06", 1, 13))
    .toThrow(/between 2 and 12/);
});

it("summarizes an unbooked four-week plan with truthful calendar counts and span", () => {
  expect(recurringVisitPlanOverview("2026-11-06", 4, 6)).toEqual({
    proposedVisits: 6,
    weekdayDates: 6,
    weekendDates: 0,
    firstDate: "2026-11-06",
    lastDate: "2027-03-26",
    spanWeeks: 20,
  });
  expect(recurringVisitPlanOverview("2026-11-07", 4, 6)).toEqual({
    proposedVisits: 6,
    weekdayDates: 0,
    weekendDates: 6,
    firstDate: "2026-11-07",
    lastDate: "2027-03-27",
    spanWeeks: 20,
  });
  expect(recurringVisitPlanOverview("2026-11-08", 1, 2)).toEqual({
    proposedVisits: 2,
    weekdayDates: 0,
    weekendDates: 2,
    firstDate: "2026-11-08",
    lastDate: "2026-11-15",
    spanWeeks: 1,
  });
});

it("summarizes each supported recurrence across DST, leap and year boundaries without side effects", () => {
  for (const start of ["2026-03-01", "2026-10-25", "2028-02-29", "2026-12-25"]) {
    for (const weeks of [1, 2, 4] as const) {
      for (const count of [2, 4, 6, 8, 12]) {
        const dates = previewRecurringVisitDates(start, weeks, count);
        const before = [...dates];
        const result = recurringVisitPlanOverview(start, weeks, count);
        const weekends = dates.filter((date) => plannedVisitWeekday(date).isWeekend).length;
        expect(result).toEqual({
          proposedVisits: count,
          weekdayDates: count - weekends,
          weekendDates: weekends,
          firstDate: dates[0],
          lastDate: dates[count - 1],
          spanWeeks: (count - 1) * weeks,
        });
        expect(dates).toEqual(before);
      }
    }
  }
});

it("never returns a partial overview for invalid or overflowing proposals", () => {
  for (const start of ["", "2026-1-01", "2026-02-30", "2019-12-31", "2101-01-01"]) {
    expect(() => recurringVisitPlanOverview(start, 1, 4)).toThrow(RangeError);
  }
  expect(() => recurringVisitPlanOverview("2100-12-31", 4, 12))
    .toThrow(/on or before 2100-12-31/);
  expect(() => recurringVisitPlanOverview("2026-11-06", 3 as VisitFrequencyWeeks, 4))
    .toThrow(/Choose weekly/);
  expect(() => recurringVisitPlanOverview("2026-11-06", 1, 1))
    .toThrow(/between 2 and 12/);
});
