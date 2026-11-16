import { expect, it } from "vitest";
import {
  focusedRecordedItemCount,
  orderWorkloadDays,
  type DailyWorkload,
  type WorkloadActivityType,
} from "../../src/core/daily-operations-workload";

// Independent reference copied from merged, five-green LMS #182.
// This comparator recomputes both activity counts on every comparison;
// #183 must return the exact same ordered day OBJECTS, including duplicates.
function previousOrder(
  days: readonly DailyWorkload[],
  includeInspections: boolean,
  mode: "calendar" | "most-recorded",
  activityType: WorkloadActivityType = "all",
): DailyWorkload[] {
  const result = [...days];
  if (mode === "calendar") {
    return result.sort((a, b) => a.date.localeCompare(b.date));
  }
  return result.sort((a, b) =>
    focusedRecordedItemCount(b, includeInspections, activityType) -
      focusedRecordedItemCount(a, includeInspections, activityType) ||
    a.date.localeCompare(b.date),
  );
}

function assertExactOrder(
  actual: readonly DailyWorkload[],
  expected: readonly DailyWorkload[],
): void {
  expect(actual).toHaveLength(expected.length);
  expect(actual).toEqual(expected);
  actual.forEach((day, index) => expect(day).toBe(expected[index]));
}

const activityTypes: WorkloadActivityType[] = [
  "all", "appointments", "work", "inspections",
];

it("preserves every workload ordering for 720 fictional calendar day records", () => {
  const days: DailyWorkload[] = Array.from({ length: 720 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, 1 + index))
      .toISOString().slice(0, 10);
    return {
      date,
      appointments: index % 13 === 0 ? 0 : index % 7,
      unfinishedWork: index % 9 === 0 ? 0 : index % 11,
      inspections: index % 5 === 0 ? 0 : index % 3,
    };
  });
  // Different records with identical dates and duplicate object references
  // must not be collapsed, even when all activity scores tie.
  const first = {
    date: "2026-11-05", appointments: 3,
    unfinishedWork: 2, inspections: 1,
  };
  const sameDateDifferentCounts = {
    date: "2026-11-05", appointments: 0,
    unfinishedWork: 0, inspections: 0,
  };
  days.push(first, first, sameDateDifferentCounts, {
    date: "2026-11-05", appointments: 3,
    unfinishedWork: 2, inspections: 1,
  });
  const inputs = [
    days, [...days].reverse(),
    days.filter((_, i) => i % 3 !== 0),
  ];
  const original = structuredClone(days);
  for (const input of inputs) {
    const frozenInput = Object.freeze([...input]);
    for (const includeInspections of [false, true]) {
      for (const activityType of activityTypes) {
        for (const mode of ["calendar", "most-recorded"] as const) {
          const expected = previousOrder(
            frozenInput, includeInspections, mode, activityType,
          );
          const actual = orderWorkloadDays(
            frozenInput, includeInspections, mode, activityType,
          );
          assertExactOrder(actual, expected);
          // Do not sort or mutate the caller's input in place.
          expect(frozenInput).toEqual(input);
        }
      }
    }
  }
  expect(days).toEqual(original);
});

it("keeps earliest-date tie breaks, stable same-date ties and zero activity", () => {
  const first = {
    date: "2026-11-08", appointments: 4,
    unfinishedWork: 0, inspections: 0,
  };
  const second = {
    date: "2026-11-06", appointments: 4,
    unfinishedWork: 0, inspections: 0,
  };
  const third = {
    date: "2026-11-06", appointments: 4,
    unfinishedWork: 0, inspections: 0,
  };
  const zero = {
    date: "2026-11-07", appointments: 0,
    unfinishedWork: 0, inspections: 0,
  };
  const input = [first, third, zero, second, second];
  const result = orderWorkloadDays(input, false, "most-recorded", "appointments");
  assertExactOrder(result, [third, second, second, first, zero]);
  assertExactOrder(result, previousOrder(
    input, false, "most-recorded", "appointments",
  ));
  // Changing inclusion of equipment does not invent non-equipment records.
  for (const includeInspections of [false, true]) {
    assertExactOrder(orderWorkloadDays(
      input, includeInspections, "most-recorded", "work",
    ), previousOrder(input, includeInspections, "most-recorded", "work"));
  }
  expect(input[0]).toBe(first);
});

it("uses a fresh per-call count for changed days and changed activity focus", () => {
  const first = {
    date: "2026-11-06", appointments: 5, unfinishedWork: 1, inspections: 0,
  };
  const second = {
    date: "2026-11-07", appointments: 1, unfinishedWork: 7, inspections: 4,
  };
  const days = [first, second];
  function compare(
    includeInspections: boolean, type: WorkloadActivityType,
  ) {
    const expected = previousOrder(
      days, includeInspections, "most-recorded", type,
    );
    const actual = orderWorkloadDays(
      days, includeInspections, "most-recorded", type,
    );
    assertExactOrder(actual, expected);
    return actual;
  }
  expect(compare(false, "appointments")[0]).toBe(first);
  expect(compare(false, "work")[0]).toBe(second);
  expect(compare(false, "all")[0]).toBe(second);
  expect(compare(false, "inspections")).toEqual([first, second]);
  expect(compare(true, "inspections")[0]).toBe(second);
  first.appointments = 99;
  expect(compare(false, "all")[0]).toBe(first);
  first.inspections = 100;
  expect(compare(true, "inspections")[0]).toBe(first);
  expect(compare(false, "inspections")).toEqual([first, second]);
});

it("returns a fresh calendar-ordered array without computing activity scores", () => {
  const a: DailyWorkload = {
    date: "2026-11-13", appointments: 0,
    unfinishedWork: 0, inspections: 0,
  };
  const b: DailyWorkload = {
    date: "2026-11-12", appointments: 0,
    unfinishedWork: 0, inspections: 0,
  };
  // Calendar mode historically only reads the date field.
  Object.defineProperty(a, "appointments", {
    get() { throw new Error("Calendar must not inspect activity counts"); },
  });
  const input = [a, b];
  const actual = orderWorkloadDays(input, true, "calendar", "all");
  expect(actual[0]).toBe(b);
  expect(actual[1]).toBe(a);
  expect(input[0]).toBe(a);
});
