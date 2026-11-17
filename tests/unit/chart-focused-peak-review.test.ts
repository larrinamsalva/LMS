import { expect, it } from "vitest";
import {
  busiestFocusedDay, recordedActivityBars, type DailyWorkload,
  type WorkloadActivityType,
} from "../../src/core/daily-operations-workload";
import { isReviewableOperationsDate } from "../../src/core/daily-operations-dates";

// A chart-selected peak is always the highest *saved count* for its own
// category over all authorized dates. It is not a staffing/capacity claim.
function peakOracle(
  days: readonly DailyWorkload[], enabled: boolean, type: WorkloadActivityType,
) {
  const bars = recordedActivityBars(days, enabled, type);
  const max = Math.max(0, ...bars.map((bar) => bar.savedItems));
  if (max <= 0) return null;
  const winners = bars.filter((bar) => bar.savedItems === max);
  return {
    date: winners.map((bar) => bar.date).sort()[0],
    matchingItems: max, tiedDates: winners.length,
  };
}

it("matches independent chart bars across 720 fictional days and all chart categories", () => {
  const days: DailyWorkload[] = Array.from({ length: 720 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
    appointments: i % 13 === 0 ? i % 17 + 1 : 0,
    unfinishedWork: i % 7 === 0 ? i % 11 + 1 : 0,
    inspections: i % 23 === 0 ? i % 19 + 1 : 0,
  }));
  const before = structuredClone(days);
  for (const input of [days, [...days].reverse(), days.slice(0, 7), []]) {
    for (const enabled of [false, true]) {
      for (const type of ["all", "appointments", "work", "inspections"] as const) {
        expect(busiestFocusedDay(input, enabled, type))
          .toEqual(peakOracle(input, enabled, type));
      }
    }
  }
  expect(days).toEqual(before);
});

it("ties show earliest business-local date, without deriving availability", () => {
  const input: DailyWorkload[] = [
    { date: "2026-11-09", appointments: 2, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-06", appointments: 2, unfinishedWork: 0, inspections: 4 },
    { date: "2026-11-07", appointments: 0, unfinishedWork: 7, inspections: 0 },
    { date: "2026-11-08", appointments: 2, unfinishedWork: 0, inspections: 4 },
  ];
  expect(busiestFocusedDay(input, true, "appointments")).toEqual({
    date: "2026-11-06", matchingItems: 2, tiedDates: 3,
  });
  expect(busiestFocusedDay(input, true, "work")).toEqual({
    date: "2026-11-07", matchingItems: 7, tiedDates: 1,
  });
  expect(busiestFocusedDay(input, true, "inspections")).toEqual({
    date: "2026-11-06", matchingItems: 4, tiedDates: 2,
  });
  expect(busiestFocusedDay(input, false, "inspections")).toBeNull();
  expect(busiestFocusedDay(input, true, "all")).toEqual({
    date: "2026-11-07", matchingItems: 7, tiedDates: 1,
  });
});

it("keeps the same reviewability guardrails at date-picker boundaries", () => {
  const future: DailyWorkload[] = [
    { date: "2101-01-01", appointments: 10, unfinishedWork: 0, inspections: 0 },
    { date: "2100-12-31", appointments: 1, unfinishedWork: 0, inspections: 0 },
  ];
  const top = busiestFocusedDay(future, false, "appointments");
  expect(top?.date).toBe("2101-01-01");
  expect(isReviewableOperationsDate(top!.date)).toBe(false);
  expect(isReviewableOperationsDate("2100-12-31")).toBe(true);
  expect(isReviewableOperationsDate("2020-01-01")).toBe(true);
  expect(isReviewableOperationsDate("2019-12-31")).toBe(false);
  expect(busiestFocusedDay([
    { date: "2035-02-27", appointments: 0, unfinishedWork: 0, inspections: 0 },
  ], false, "all")).toBeNull();
});
