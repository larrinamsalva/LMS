import { expect, it } from "vitest";
import {
  recordedActivityBars,
  recordedActivityWeekShares,
  type DailyWorkload,
} from "../../src/core/daily-operations-workload";

it("shows daily share of selected weekly saved items, not tallest-bar height", () => {
  const bars = [
    { date: "2026-11-06", savedItems: 1, relativePercent: 17 },
    { date: "2026-11-07", savedItems: 2, relativePercent: 33 },
    { date: "2026-11-08", savedItems: 3, relativePercent: 50 },
    { date: "2026-11-09", savedItems: 6, relativePercent: 100 },
    { date: "2026-11-10", savedItems: 0, relativePercent: 0 },
  ];
  const before = structuredClone(bars);
  expect(recordedActivityWeekShares(bars)).toEqual([
    { date: "2026-11-06", savedItems: 1, shareLabel: "8.3%" },
    { date: "2026-11-07", savedItems: 2, shareLabel: "16.7%" },
    { date: "2026-11-08", savedItems: 3, shareLabel: "25.0%" },
    { date: "2026-11-09", savedItems: 6, shareLabel: "50.0%" },
    { date: "2026-11-10", savedItems: 0, shareLabel: "0%" },
  ]);
  expect(bars).toEqual(before);
  expect(bars[3].relativePercent).toBe(100);
  expect(recordedActivityWeekShares(bars)[3].shareLabel).toBe("50.0%");
});

it("handles empty weeks, zero-only categories and tiny positive counts", () => {
  expect(recordedActivityWeekShares([])).toEqual([]);
  expect(recordedActivityWeekShares([
    { date: "2026-11-06", savedItems: 0 },
    { date: "2026-11-07", savedItems: 0 },
  ])).toEqual([
    { date: "2026-11-06", savedItems: 0, shareLabel: "0%" },
    { date: "2026-11-07", savedItems: 0, shareLabel: "0%" },
  ]);
  expect(recordedActivityWeekShares([
    { date: "2026-11-06", savedItems: 1 },
    { date: "2026-11-07", savedItems: 99999 },
  ])).toEqual([
    { date: "2026-11-06", savedItems: 1, shareLabel: "<0.1%" },
    { date: "2026-11-07", savedItems: 99999, shareLabel: "100.0%" },
  ]);
  expect(recordedActivityWeekShares([
    { date: "2026-11-06", savedItems: 1 },
  ])[0].shareLabel).toBe("100.0%");
});

it("preserves chart categories, order, business dates and immutability across 720 fictional days", () => {
  const days: DailyWorkload[] = Array.from({ length: 720 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    appointments: index % 11 === 0 ? index + 1 : 0,
    unfinishedWork: index % 7 === 0 ? 3 : 0,
    inspections: index % 13 === 0 ? 2 : 0,
  }));
  const before = structuredClone(days);
  for (const current of [days, [...days].reverse(), days.slice(0, 7), [], [days[0], days[0]]]) {
    for (const enabled of [false, true]) {
      for (const category of ["all", "appointments", "work", "inspections"] as const) {
        const bars = recordedActivityBars(current, enabled, category);
        const copy = structuredClone(bars);
        const shares = recordedActivityWeekShares(Object.freeze(bars));
        const total = bars.reduce((sum, bar) => sum + bar.savedItems, 0);
        expect(shares).toHaveLength(current.length);
        for (let index = 0; index < bars.length; index++) {
          expect(shares[index].date).toBe(bars[index].date);
          expect(shares[index].savedItems).toBe(bars[index].savedItems);
          const count = bars[index].savedItems;
          const percentage = total === 0 ? 0 : (count / total) * 100;
          const label = count === 0 ? "0%"
            : percentage < 0.1 ? "<0.1%"
              : (Math.round(percentage * 10) / 10).toFixed(1) + "%";
          expect(shares[index].shareLabel).toBe(label);
        }
        expect(bars).toEqual(copy);
      }
    }
  }
  expect(days).toEqual(before);
});
