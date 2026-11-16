import { expect, it } from "vitest";
import {
  datesWithoutSavedActivity,
  filterWorkloadDaysByCalendarDay,
  orderWorkloadDays,
  summarizeSevenDayWorkload,
  visibleWorkloadDays,
  type DailyWorkload,
} from "../../src/core/daily-operations-workload";

const days: DailyWorkload[] = [
  { date: "2026-11-06", appointments: 1, unfinishedWork: 2, inspections: 0 },
  { date: "2026-11-07", appointments: 0, unfinishedWork: 0, inspections: 1 },
  { date: "2026-11-08", appointments: 0, unfinishedWork: 0, inspections: 0 },
  { date: "2026-11-09", appointments: 0, unfinishedWork: 1, inspections: 0 },
  { date: "2026-11-10", appointments: 0, unfinishedWork: 0, inspections: 0 },
  { date: "2026-11-11", appointments: 0, unfinishedWork: 0, inspections: 0 },
  { date: "2026-11-12", appointments: 0, unfinishedWork: 0, inspections: 0 },
];

function quietCards(
  records: readonly DailyWorkload[],
  equipmentEnabled: boolean,
  calendarDay: "all" | "weekdays" | "weekends" = "all",
  order: "calendar" | "most-recorded" = "calendar",
) {
  return orderWorkloadDays(
    filterWorkloadDaysByCalendarDay(
      datesWithoutSavedActivity(records, equipmentEnabled),
      calendarDay,
    ),
    equipmentEnabled,
    order,
  );
}

it("shows only no-saved-activity dates and keeps original canonical full-week totals", () => {
  const untouched = structuredClone(days);
  const withEquipment = quietCards(days, true);
  expect(withEquipment.map((day) => day.date)).toEqual([
    "2026-11-08", "2026-11-10", "2026-11-11", "2026-11-12",
  ]);
  const withoutEquipment = quietCards(days, false);
  expect(withoutEquipment.map((day) => day.date)).toEqual([
    "2026-11-07", "2026-11-08", "2026-11-10",
    "2026-11-11", "2026-11-12",
  ]);
  expect(summarizeSevenDayWorkload(days, true)).toEqual({
    appointments: 1,
    unfinishedWork: 3,
    inspections: 1,
    daysWithActivity: 3,
    daysInWindow: 7,
  });
  expect(summarizeSevenDayWorkload(withEquipment, true)).toEqual({
    appointments: 0,
    unfinishedWork: 0,
    inspections: 0,
    daysWithActivity: 0,
    daysInWindow: 4,
  });
  for (const [i, entry] of withEquipment.entries()) {
    expect(entry).toBe(days[[2, 4, 5, 6][i]]);
  }
  expect(days).toEqual(untouched);
});

it("allows independent weekday/weekend and sorting, without turning quiet dates into capacity", () => {
  expect(quietCards(days, true, "weekends").map((d) => d.date))
    .toEqual(["2026-11-08"]);
  expect(quietCards(days, false, "weekends").map((d) => d.date))
    .toEqual(["2026-11-07", "2026-11-08"]);
  expect(quietCards(days, true, "weekdays").map((d) => d.date))
    .toEqual(["2026-11-10", "2026-11-11", "2026-11-12"]);
  expect(quietCards(days, true, "all", "most-recorded"))
    .toEqual(quietCards(days, true, "all", "calendar"));
  // The original saved activity-only selection is the exact complement of
  // quiet dates. Neither category is a staffing or resource availability test.
  for (const equipmentEnabled of [true, false]) {
    const active = visibleWorkloadDays(days, equipmentEnabled, true);
    const quiet = quietCards(days, equipmentEnabled);
    expect(active.length + quiet.length).toBe(7);
    expect(new Set([...active, ...quiet])).toEqual(new Set(days));
  }
});

it("keeps duplicate retained day references, a fresh array and empty weeks", () => {
  const same = days[2];
  const repeated = [days[0], same, same, days[1], same];
  const actual = quietCards(repeated, true);
  expect(actual).toEqual([same, same, same]);
  expect(actual[0]).toBe(same);
  expect(actual[1]).toBe(same);
  expect(actual[2]).toBe(same);
  expect(repeated).toHaveLength(5);
  expect(quietCards([], true)).toEqual([]);
  expect(quietCards(
    Array.from({ length: 7 }, (_, i) => ({
      date: "2035-02-" + String(27 + i).padStart(2, "0"),
      appointments: 0, unfinishedWork: 0, inspections: 0,
    })),
    false,
  )).toHaveLength(7);
});
