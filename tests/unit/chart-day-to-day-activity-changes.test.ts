import { expect, it } from "vitest";
import {
  recordedActivityBars, recordedActivityDailyChanges,
  type DailyWorkload,
} from "../../src/core/daily-operations-workload";

it("shows signed differences between consecutive saved-record counts only", () => {
  const bars = [
    { date: "2026-11-06", savedItems: 0, relativePercent: 0 },
    { date: "2026-11-07", savedItems: 3, relativePercent: 50 },
    { date: "2026-11-08", savedItems: 3, relativePercent: 50 },
    { date: "2026-11-09", savedItems: 1, relativePercent: 17 },
    { date: "2026-11-10", savedItems: 6, relativePercent: 100 },
    { date: "2026-11-11", savedItems: 0, relativePercent: 0 },
    { date: "2026-11-12", savedItems: 0, relativePercent: 0 },
  ];
  const before = structuredClone(bars);
  expect(recordedActivityDailyChanges(bars)).toEqual([
    { date: "2026-11-06", savedItems: 0, change: null, changeLabel: "First date in view" },
    { date: "2026-11-07", savedItems: 3, change: 3, changeLabel: "Change vs prior date: +3" },
    { date: "2026-11-08", savedItems: 3, change: 0, changeLabel: "Change vs prior date: 0" },
    { date: "2026-11-09", savedItems: 1, change: -2, changeLabel: "Change vs prior date: -2" },
    { date: "2026-11-10", savedItems: 6, change: 5, changeLabel: "Change vs prior date: +5" },
    { date: "2026-11-11", savedItems: 0, change: -6, changeLabel: "Change vs prior date: -6" },
    { date: "2026-11-12", savedItems: 0, change: 0, changeLabel: "Change vs prior date: 0" },
  ]);
  expect(bars).toEqual(before);
  expect(recordedActivityDailyChanges([])).toEqual([]);
});

it("shows zero changes across an empty week without claiming availability", () => {
  const bars = [
    { date: "2035-02-27", savedItems: 0 },
    { date: "2035-02-28", savedItems: 0 },
    { date: "2035-03-01", savedItems: 0 },
  ];
  const changes = recordedActivityDailyChanges(bars);
  expect(changes.map((item) => item.change)).toEqual([null, 0, 0]);
  expect(changes.map((item) => item.changeLabel)).toEqual([
    "First date in view", "Change vs prior date: 0", "Change vs prior date: 0",
  ]);
  expect(changes).not.toBe(bars);
  changes.forEach((item, index) => expect(item).not.toBe(bars[index]));
});

it("agrees with the selected chart for 720 fictional days, all categories and equipment modes", () => {
  const days: DailyWorkload[] = Array.from({ length: 720 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    appointments: index % 11 === 0 ? (index % 13) + 1 : 0,
    unfinishedWork: index % 7 === 0 ? (index % 19) + 1 : 0,
    inspections: index % 17 === 0 ? 2 : 0,
  }));
  const before = structuredClone(days);
  for (const selected of [
    days, [...days].reverse(), days.slice(0, 7), days.slice(-7),
    [days[0], days[0], days[1]], [] as DailyWorkload[],
  ]) {
    for (const equipmentEnabled of [false, true]) {
      for (const type of ["all", "appointments", "work", "inspections"] as const) {
        const bars = recordedActivityBars(selected, equipmentEnabled, type);
        const frozen = structuredClone(bars);
        const changes = recordedActivityDailyChanges(Object.freeze(bars));
        expect(changes).toHaveLength(bars.length);
        changes.forEach((change, index) => {
          const expected = index === 0 ? null
            : bars[index].savedItems - bars[index - 1].savedItems;
          expect(change.change).toBe(expected);
          expect(change.date).toBe(bars[index].date);
          expect(change.savedItems).toBe(bars[index].savedItems);
          expect(change.changeLabel).toBe(expected === null ? "First date in view"
            : "Change vs prior date: " + (expected > 0 ? "+" : "") + expected);
        });
        expect(bars).toEqual(frozen);
      }
    }
  }
  expect(days).toEqual(before);
});
