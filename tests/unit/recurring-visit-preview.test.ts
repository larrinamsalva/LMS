import { expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import {
  previewRecurringVisitDates,
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
