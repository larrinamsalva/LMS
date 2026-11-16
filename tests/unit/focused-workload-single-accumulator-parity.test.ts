import { expect, it } from "vitest";
import { summarizeDailyOperations } from "../../src/core/daily-operations";
import {
  focusedRecordedItemCount,
  sevenDayWorkload,
  summarizeFocusedWorkload,
  type DailyWorkload,
  type WorkloadActivityType,
} from "../../src/core/daily-operations-workload";
import type { WorkspaceRecord } from "../../src/core/engine";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const types: WorkloadActivityType[] = [
  "all", "appointments", "work", "inspections",
];

// Independent original allocating reduce from verified five-green #184.
// Keep all predicates and arithmetic independent of the changed production
// accumulator; changing this oracle would hide a behavioral regression.
function previousFocusedTotals(
  days: readonly DailyWorkload[],
  includeInspections: boolean,
  type: WorkloadActivityType,
): { savedItems: number; matchingDays: number; daysInWindow: number } {
  return days.reduce((result, day) => {
    const saved = focusedRecordedItemCount(day, includeInspections, type);
    return {
      savedItems: result.savedItems + saved,
      matchingDays: result.matchingDays + Number(saved > 0),
      daysInWindow: result.daysInWindow + 1,
    };
  }, { savedItems: 0, matchingDays: 0, daysInWindow: 0 });
}

function assertSameFocusedTotals(days: readonly DailyWorkload[]): void {
  for (const includeInspections of [false, true]) {
    for (const type of types) {
      const expected = previousFocusedTotals(days, includeInspections, type);
      const actual = summarizeFocusedWorkload(days, includeInspections, type);
      expect(actual).toEqual(expected);
      expect(Object.keys(actual).sort()).toEqual([
        "daysInWindow", "matchingDays", "savedItems",
      ]);
    }
  }
}

function record(
  entity: string, id: string, data: WorkspaceRecord["data"],
  organization_id = ORG, archived = false,
): WorkspaceRecord {
  return {
    entity, id, data, organization_id, archived,
    revision: 1, config_revision: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

it("preserves three focused counters across 720 fictional recorded day cards", () => {
  const rows: DailyWorkload[] = Array.from({ length: 720 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 0, index + 1))
      .toISOString().slice(0, 10),
    appointments: index % 7 === 0 ? 0 : index % 11,
    unfinishedWork: index % 9 === 0 ? 0 : index % 5,
    inspections: index % 13 === 0 ? 0 : index % 3,
  }));
  const duplicate: DailyWorkload = {
    date: "2026-11-06", appointments: 5,
    unfinishedWork: 0, inspections: 2,
  };
  rows.push(duplicate, duplicate, {
    date: "2026-11-06", appointments: 5,
    unfinishedWork: 0, inspections: 2,
  });
  const before = structuredClone(rows);
  const inputs: DailyWorkload[][] = [
    rows, [...rows].reverse(), rows.slice(0, 7),
    rows.slice(717), rows.filter((_, index) => index % 3 !== 0), [],
  ];
  for (const input of inputs) {
    const frozen = Object.freeze([...input]);
    assertSameFocusedTotals(frozen);
    // Repeat with the same input: no persistent cache or counter leak.
    assertSameFocusedTotals(frozen);
    expect(frozen).toEqual(input);
  }
  expect(rows).toEqual(before);
});

it("does not count disabled inspections as saved items or matching days", () => {
  const days: DailyWorkload[] = [
    { date: "2026-11-06", appointments: 0, unfinishedWork: 0, inspections: 5 },
    { date: "2026-11-07", appointments: 3, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-08", appointments: 0, unfinishedWork: 2, inspections: 0 },
    { date: "2026-11-09", appointments: 1, unfinishedWork: 1, inspections: 1 },
    { date: "2026-11-10", appointments: 0, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-11", appointments: 0, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-12", appointments: 0, unfinishedWork: 0, inspections: 0 },
  ];
  assertSameFocusedTotals(days);
  expect(summarizeFocusedWorkload(days, true, "all")).toEqual({
    savedItems: 13, matchingDays: 4, daysInWindow: 7,
  });
  expect(summarizeFocusedWorkload(days, false, "all")).toEqual({
    savedItems: 7, matchingDays: 3, daysInWindow: 7,
  });
  expect(summarizeFocusedWorkload(days, false, "inspections")).toEqual({
    savedItems: 0, matchingDays: 0, daysInWindow: 7,
  });
  expect(summarizeFocusedWorkload(days, true, "inspections")).toEqual({
    savedItems: 6, matchingDays: 2, daysInWindow: 7,
  });
  expect(summarizeFocusedWorkload(days, false, "appointments")).toEqual({
    savedItems: 4, matchingDays: 2, daysInWindow: 7,
  });
  expect(summarizeFocusedWorkload(days, true, "work")).toEqual({
    savedItems: 3, matchingDays: 2, daysInWindow: 7,
  });
});

it("preserves sparse-array reduce behavior and repeated occurrences", () => {
  const sparse = new Array<DailyWorkload>(8);
  sparse[2] = {
    date: "2026-11-06", appointments: 1, unfinishedWork: 0, inspections: 2,
  };
  sparse[6] = {
    date: "2026-11-07", appointments: 0, unfinishedWork: 1, inspections: 0,
  };
  assertSameFocusedTotals(sparse);
  expect(summarizeFocusedWorkload(sparse, true, "all"))
    .toEqual({ savedItems: 4, matchingDays: 2, daysInWindow: 2 });
  const same = sparse[2];
  const repeated = [same, same, same];
  assertSameFocusedTotals(repeated);
  expect(summarizeFocusedWorkload(repeated, false, "appointments"))
    .toEqual({ savedItems: 3, matchingDays: 3, daysInWindow: 3 });
});

it("recomputes after day count changes, without mutating the original cards", () => {
  const first: DailyWorkload = {
    date: "2026-11-06", appointments: 1, unfinishedWork: 0, inspections: 0,
  };
  const second: DailyWorkload = {
    date: "2026-11-07", appointments: 0, unfinishedWork: 0, inspections: 3,
  };
  const days = [first, second];
  assertSameFocusedTotals(days);
  expect(summarizeFocusedWorkload(days, false, "all"))
    .toEqual({ savedItems: 1, matchingDays: 1, daysInWindow: 2 });
  first.appointments = 8;
  second.unfinishedWork = 4;
  assertSameFocusedTotals(days);
  expect(summarizeFocusedWorkload(days, false, "all"))
    .toEqual({ savedItems: 12, matchingDays: 2, daysInWindow: 2 });
  expect(summarizeFocusedWorkload(days, true, "all"))
    .toEqual({ savedItems: 15, matchingDays: 2, daysInWindow: 2 });
  expect(days[0]).toBe(first);
  expect(days[1]).toBe(second);
});

it("matches the original rollup on authorized seven-day summaries across DST and leap dates", () => {
  const records: WorkspaceRecord[] = [
    record("appointments", "fall-first", {
      title: "Fictional morning visit", status: "Scheduled",
      start: "2026-11-01T08:30:00Z", end: "2026-11-01T09:00:00Z",
    }),
    record("appointments", "fall-second", {
      title: "Fictional later visit", status: "Scheduled",
      start: "2026-11-01T09:30:00Z", end: "2026-11-01T10:00:00Z",
    }),
    record("tasks", "task", {
      title: "Fictional inspection task", status: "Open", due: "2026-11-02",
    }),
    record("tasks", "foreign", {
      title: "FOREIGN PRIVATE WORK", status: "Open", due: "2026-11-02",
    }, FOREIGN),
    record("jobs", "archived", {
      title: "ARCHIVED PRIVATE WORK", status: "Open", date: "2026-11-02",
    }, ORG, true),
    record("jobs", "leap-job", {
      title: "Leap day cleaning", status: "Planned", date: "2028-02-29",
    }),
    record("appointments", "leap-visit", {
      title: "Leap day visit", status: "Scheduled",
      start: "2028-02-29T18:30:00Z", end: "2028-02-29T19:00:00Z",
    }),
  ];
  const before = structuredClone(records);
  for (const zone of ["UTC", "America/Los_Angeles", "America/New_York"]) {
    for (const selectedDate of ["2026-10-31", "2028-02-26"]) {
      const overview = summarizeDailyOperations({
        organizationId: ORG, records, equipmentStates: [],
      }, zone, selectedDate);
      const days = sevenDayWorkload(overview, zone);
      expect(days).toHaveLength(7);
      assertSameFocusedTotals(days);
      expect(days.every((day) => !Number.isNaN(day.appointments))).toBe(true);
    }
  }
  expect(records).toEqual(before);
});
