import { expect, it } from "vitest";
import { summarizeDailyOperations } from "../../src/core/daily-operations";
import {
  sevenDayWorkload,
  summarizeSevenDayWorkload,
  type DailyWorkload,
} from "../../src/core/daily-operations-workload";
import type { WorkspaceRecord } from "../../src/core/engine";
import type { EquipmentState } from "../../src/core/equipment";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// Independent copy of the original allocating reduce from verified
// merged, five-green LMS #183. The new summary must produce exactly
// the same five counters and preserve caller input.
function previousTotals(
  days: readonly DailyWorkload[],
  includeInspections: boolean,
): ReturnType<typeof summarizeSevenDayWorkload> {
  return days.reduce(
    (totals, day) => ({
      appointments: totals.appointments + day.appointments,
      unfinishedWork: totals.unfinishedWork + day.unfinishedWork,
      inspections: totals.inspections + (includeInspections ? day.inspections : 0),
      daysWithActivity: totals.daysWithActivity + Number(
        day.appointments > 0 || day.unfinishedWork > 0 ||
        (includeInspections && day.inspections > 0),
      ),
      daysInWindow: totals.daysInWindow + 1,
    }),
    {
      appointments: 0, unfinishedWork: 0,
      inspections: 0, daysWithActivity: 0, daysInWindow: 0,
    },
  );
}

function assertSameTotals(
  days: readonly DailyWorkload[],
  includeInspections: boolean,
) {
  expect(summarizeSevenDayWorkload(days, includeInspections))
    .toEqual(previousTotals(days, includeInspections));
}

function record(
  entity: string, id: string, data: WorkspaceRecord["data"],
  organization_id = ORG, archived = false,
): WorkspaceRecord {
  return {
    id, entity, data, organization_id, archived,
    revision: 1, config_revision: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function equipmentState(
  record_id: string,
  next_inspection: string,
  organization_id = ORG,
): EquipmentState {
  return {
    organization_id, record_id, revision: 1,
    asset_key: record_id, barcode_key: null,
    condition: "Serviceable", maintenance: "Clear",
    work_id: null, technician_id: null,
    last_service: null, next_inspection,
  };
}

it("matches the old five-counter rollup across 720 fictional day cards", () => {
  const rows: DailyWorkload[] = Array.from({ length: 720 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
    appointments: i % 13 === 0 ? 0 : i % 9,
    unfinishedWork: i % 11 === 0 ? 0 : i % 7,
    inspections: i % 5 === 0 ? 0 : i % 4,
  }));
  const repeated: DailyWorkload = {
    date: "2026-11-05", appointments: 4,
    unfinishedWork: 0, inspections: 3,
  };
  rows.push(repeated, repeated, {
    date: "2026-11-05", appointments: 4,
    unfinishedWork: 0, inspections: 3,
  });
  const before = structuredClone(rows);
  const inputs = [
    rows, [...rows].reverse(),
    rows.filter((_, i) => i % 3 !== 0),
    rows.slice(0, 7), rows.slice(-7),
    [] as DailyWorkload[],
  ];
  for (const input of inputs) {
    const frozen = Object.freeze([...input]);
    for (const includeInspections of [false, true]) {
      assertSameTotals(frozen, includeInspections);
      assertSameTotals(frozen, includeInspections);
    }
    expect(frozen).toEqual(input);
  }
  expect(rows).toEqual(before);
});

it("preserves equipment visibility and counts activity without inferring capacity", () => {
  const days: DailyWorkload[] = [
    { date: "2026-11-06", appointments: 0, unfinishedWork: 0, inspections: 5 },
    { date: "2026-11-07", appointments: 3, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-08", appointments: 0, unfinishedWork: 2, inspections: 0 },
    { date: "2026-11-09", appointments: 1, unfinishedWork: 1, inspections: 1 },
    { date: "2026-11-10", appointments: 0, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-11", appointments: 0, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-12", appointments: 0, unfinishedWork: 0, inspections: 0 },
  ];
  const included = summarizeSevenDayWorkload(days, true);
  const excluded = summarizeSevenDayWorkload(days, false);
  expect(included).toEqual({
    appointments: 4, unfinishedWork: 3, inspections: 6,
    daysWithActivity: 4, daysInWindow: 7,
  });
  expect(excluded).toEqual({
    appointments: 4, unfinishedWork: 3, inspections: 0,
    daysWithActivity: 3, daysInWindow: 7,
  });
  assertSameTotals(days, true);
  assertSameTotals(days, false);
  expect(days[0].inspections).toBe(5);
});

it("preserves sparse-array reduce behavior and repeated row occurrences", () => {
  // Unusual direct callers can pass sparse arrays. Array.reduce skips holes.
  const days = new Array<DailyWorkload>(8);
  days[2] = {
    date: "2026-11-06", appointments: 1,
    unfinishedWork: 2, inspections: 0,
  };
  days[6] = {
    date: "2026-11-07", appointments: 0,
    unfinishedWork: 0, inspections: 3,
  };
  assertSameTotals(days, true);
  assertSameTotals(days, false);
  expect(summarizeSevenDayWorkload(days, true).daysInWindow).toBe(2);
  const same = days[2];
  assertSameTotals([same, same, same], false);
  expect(summarizeSevenDayWorkload([same, same, same], false))
    .toEqual({
      appointments: 3, unfinishedWork: 6, inspections: 0,
      daysWithActivity: 3, daysInWindow: 3,
    });
});

it("matches the old rollup on authorized seven-day overviews across DST and leap day", () => {
  const records = [
    record("appointments", "fall-first", {
      title: "Fictional early appointment", status: "Scheduled",
      start: "2026-11-01T08:30:00Z", end: "2026-11-01T09:00:00Z",
    }),
    record("appointments", "fall-second", {
      title: "Fictional late appointment", status: "Scheduled",
      start: "2026-11-01T09:30:00Z", end: "2026-11-01T10:00:00Z",
    }),
    record("tasks", "fall-task", {
      title: "Fictional work", status: "Open", due: "2026-11-02",
    }),
    record("tasks", "foreign", {
      title: "PRIVATE FOREIGN TASK", status: "Open", due: "2026-11-02",
    }, FOREIGN),
    record("jobs", "archived", {
      title: "Archived fictional work", status: "Planned", date: "2026-11-02",
    }, ORG, true),
    record("tasks", "leap-task", {
      title: "Leap task", status: "Open", due: "2028-02-29",
    }),
    record("appointments", "leap-visit", {
      title: "Leap-day visit", status: "Scheduled",
      start: "2028-02-29T18:30:00Z", end: "2028-02-29T19:00:00Z",
    }),
  ];
  const equipment = [
    record("equipment", "asset", { name: "Fictional scrubber" }),
  ];
  const states = [
    equipmentState("asset", "2026-11-02"),
  ];
  for (const [zone, date] of [
    ["America/Los_Angeles", "2026-10-31"],
    ["America/New_York", "2026-10-31"],
    ["UTC", "2026-10-31"],
    ["America/Los_Angeles", "2028-02-26"],
    ["UTC", "2028-02-26"],
  ]) {
    const overview = summarizeDailyOperations(
      { organizationId: ORG, records: [...records, ...equipment], equipmentStates: states },
      zone, date,
    );
    const workload = sevenDayWorkload(overview, zone);
    expect(workload).toHaveLength(7);
    assertSameTotals(workload, false);
    assertSameTotals(workload, true);
  }
});
