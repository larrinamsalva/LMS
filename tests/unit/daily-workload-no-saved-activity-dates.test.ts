import { expect, it } from "vitest";
import {
  datesWithoutSavedActivity,
  sevenDayWorkload,
  summarizeSevenDayWorkload,
  visibleWorkloadDays,
  type DailyWorkload,
} from "../../src/core/daily-operations-workload";
import { summarizeDailyOperations } from "../../src/core/daily-operations";
import type { WorkspaceRecord } from "../../src/core/engine";
import type { EquipmentState } from "../../src/core/equipment";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

function equipmentState(
  record_id: string, next_inspection: string,
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

// Independent definition from already-merged workload activity predicates:
// a date is classified as "no saved activity" iff it is not counted by
// the original activity-only display or daysWithActivity total.
function originalInactiveDays(
  days: readonly DailyWorkload[], includeInspections: boolean,
): DailyWorkload[] {
  return days.filter((day) => !(
    day.appointments > 0 ||
    day.unfinishedWork > 0 ||
    (includeInspections && day.inspections > 0)
  ));
}

it("preserves exact entries and order across 720 fictional day cards", () => {
  const days: DailyWorkload[] = Array.from({ length: 720 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
    appointments: i % 5 === 0 ? i % 3 : 0,
    unfinishedWork: i % 7 === 0 ? 2 : 0,
    inspections: i % 11 === 0 ? 3 : 0,
  }));
  const repeated: DailyWorkload = {
    date: "2026-11-05", appointments: 0, unfinishedWork: 0, inspections: 0,
  };
  days.push(repeated, repeated, {
    date: "2026-11-05", appointments: 0, unfinishedWork: 0, inspections: 1,
  });
  const snapshot = structuredClone(days);
  for (const input of [days, [...days].reverse(), days.slice(-7), []]) {
    const frozen = Object.freeze([...input]);
    for (const includeInspections of [false, true]) {
      const actual = datesWithoutSavedActivity(frozen, includeInspections);
      const expected = originalInactiveDays(frozen, includeInspections);
      expect(actual).toEqual(expected);
      actual.forEach((day, i) => expect(day).toBe(expected[i]));
      expect(actual.length +
        visibleWorkloadDays(frozen, includeInspections, true).length)
        .toBe(frozen.length);
      const totals = summarizeSevenDayWorkload(frozen, includeInspections);
      expect(actual.length).toBe(frozen.length - totals.daysWithActivity);
      expect(datesWithoutSavedActivity(frozen, includeInspections))
        .toEqual(actual);
    }
    expect(frozen).toEqual(input);
  }
  expect(days).toEqual(snapshot);
});

it("does not treat inspection-only dates as active when equipment is disabled", () => {
  const days: DailyWorkload[] = [
    { date: "2026-11-06", appointments: 0, unfinishedWork: 0, inspections: 5 },
    { date: "2026-11-07", appointments: 1, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-08", appointments: 0, unfinishedWork: 2, inspections: 0 },
    { date: "2026-11-09", appointments: 0, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-10", appointments: 0, unfinishedWork: 0, inspections: 0 },
  ];
  const dates = (included: boolean) =>
    datesWithoutSavedActivity(days, included).map((row) => row.date);
  expect(dates(true)).toEqual(["2026-11-09", "2026-11-10"]);
  expect(dates(false)).toEqual([
    "2026-11-06", "2026-11-09", "2026-11-10",
  ]);
  expect(datesWithoutSavedActivity(days, true)[0]).toBe(days[3]);
  expect(datesWithoutSavedActivity([], false)).toEqual([]);
  expect(datesWithoutSavedActivity([
    { date: "2026-11-11", appointments: 3, unfinishedWork: 2, inspections: 1 },
  ], true)).toEqual([]);
});

it("uses the current authorized seven dates including DST without inventing availability", () => {
  const records: WorkspaceRecord[] = [
    record("appointments", "fold-one", {
      title: "Fictional visit", status: "Scheduled",
      start: "2026-11-01T08:30:00Z", end: "2026-11-01T09:00:00Z",
    }),
    record("appointments", "fold-two", {
      title: "Fictional repeated-hour visit", status: "Scheduled",
      start: "2026-11-01T09:30:00Z", end: "2026-11-01T10:00:00Z",
    }),
    record("tasks", "due", { title: "Local repair", status: "Open", due: "2026-11-02" }),
    record("tasks", "foreign", {
      title: "PRIVATE FOREIGN WORK", status: "Open", due: "2026-11-03",
    }, FOREIGN),
    record("jobs", "archived", {
      title: "PRIVATE ARCHIVED JOB", status: "Planned", date: "2026-11-04",
    }, ORG, true),
    record("equipment", "tool", { name: "Fictional vacuum" }),
  ];
  const states: EquipmentState[] = [
    equipmentState("tool", "2026-11-05"),
    equipmentState("tool", "2026-11-04", FOREIGN),
  ];
  const recordsBefore = structuredClone(records);
  const statesBefore = structuredClone(states);
  const overview = summarizeDailyOperations({
    organizationId: ORG, records, equipmentStates: states,
  }, "America/Los_Angeles", "2026-10-31");
  const days = sevenDayWorkload(overview, "America/Los_Angeles");
  expect(days.map((day) => day.date)).toEqual([
    "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04",
    "2026-11-05", "2026-11-06", "2026-11-07",
  ]);
  expect(datesWithoutSavedActivity(days, false).map((day) => day.date))
    .toEqual(["2026-11-03", "2026-11-04", "2026-11-05",
      "2026-11-06", "2026-11-07"]);
  expect(datesWithoutSavedActivity(days, true).map((day) => day.date))
    .toEqual(["2026-11-03", "2026-11-04", "2026-11-06", "2026-11-07"]);
  expect(records).toEqual(recordsBefore);
  expect(states).toEqual(statesBefore);
});

it("respects leap day and recomputes when saved counts change", () => {
  const overview = summarizeDailyOperations({
    organizationId: ORG,
    records: [
      record("tasks", "leap", {
        title: "Fictional leap task", status: "Open", due: "2028-02-29",
      }),
    ],
    equipmentStates: [],
  }, "America/Los_Angeles", "2028-02-26");
  const days = sevenDayWorkload(overview, "America/Los_Angeles");
  const inactive = datesWithoutSavedActivity(days, false);
  expect(inactive.map((day) => day.date)).toEqual([
    "2028-02-27", "2028-02-28", "2028-03-01", "2028-03-02",
    "2028-03-03", "2028-03-04",
  ]);
  expect(days[2].date).toBe("2028-02-29");
  days[2].unfinishedWork = 0;
  expect(datesWithoutSavedActivity(days, false)).toHaveLength(7);
  days[0].appointments = 1;
  expect(datesWithoutSavedActivity(days, false)).toHaveLength(6);
});
