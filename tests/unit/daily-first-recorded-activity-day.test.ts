import { expect, it } from "vitest";
import { summarizeDailyOperations } from "../../src/core/daily-operations";
import {
  datesWithoutSavedActivity,
  earliestRecordedActivityDay,
  sevenDayWorkload,
  summarizeSevenDayWorkload,
  type DailyWorkload,
} from "../../src/core/daily-operations-workload";
import type { WorkspaceRecord } from "../../src/core/engine";
import type { EquipmentState } from "../../src/core/equipment";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// Independent date-first oracle: a qualifying date has positive
// appointments, unfinished due work, or enabled inspection counts.
function oldPredicateOracle(
  days: readonly DailyWorkload[],
  includeInspections: boolean,
): { date: string; recordedItems: number } | null {
  const qualifying = days.filter((day) =>
    day.appointments > 0 || day.unfinishedWork > 0 ||
    (includeInspections && day.inspections > 0),
  );
  qualifying.sort((a, b) => a.date.localeCompare(b.date));
  const first = qualifying[0];
  if (!first) return null;
  return {
    date: first.date,
    recordedItems: first.appointments + first.unfinishedWork +
      (includeInspections ? first.inspections : 0),
  };
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

function state(
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

it("chooses the earliest date, not the busiest or first array entry", () => {
  const days: DailyWorkload[] = [
    { date: "2026-11-12", appointments: 24, unfinishedWork: 4, inspections: 2 },
    { date: "2026-11-07", appointments: 0, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-09", appointments: 1, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-06", appointments: 0, unfinishedWork: 0, inspections: 1 },
    { date: "2026-11-08", appointments: 0, unfinishedWork: 1, inspections: 0 },
  ];
  const snapshot = structuredClone(days);
  expect(earliestRecordedActivityDay(days, true)).toEqual({
    date: "2026-11-06", recordedItems: 1,
  });
  expect(earliestRecordedActivityDay(days, false)).toEqual({
    date: "2026-11-08", recordedItems: 1,
  });
  expect(earliestRecordedActivityDay([...days].reverse(), false)).toEqual({
    date: "2026-11-08", recordedItems: 1,
  });
  expect(earliestRecordedActivityDay([], true)).toBeNull();
  expect(earliestRecordedActivityDay(
    datesWithoutSavedActivity(days, true), true,
  )).toBeNull();
  expect(days).toEqual(snapshot);
});

it("matches the original saved-activity definition over 720 fictional dates", () => {
  const days: DailyWorkload[] = Array.from({ length: 720 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    appointments: index % 19 === 0 ? 3 : 0,
    unfinishedWork: index % 13 === 0 ? 2 : 0,
    inspections: index % 7 === 0 ? 1 : 0,
  }));
  const duplicate = {
    date: "2026-11-05", appointments: 0,
    unfinishedWork: 0, inspections: 4,
  };
  days.push(duplicate, duplicate);
  const before = structuredClone(days);
  for (const input of [
    days, [...days].reverse(), days.slice(-30),
    days.filter((_, i) => i % 3 === 0), [] as DailyWorkload[],
  ]) {
    const frozen = Object.freeze([...input]);
    for (const equipmentEnabled of [true, false]) {
      expect(earliestRecordedActivityDay(frozen, equipmentEnabled))
        .toEqual(oldPredicateOracle(frozen, equipmentEnabled));
      const totals = summarizeSevenDayWorkload(frozen, equipmentEnabled);
      if (totals.daysWithActivity === 0) {
        expect(earliestRecordedActivityDay(frozen, equipmentEnabled)).toBeNull();
      } else {
        expect(earliestRecordedActivityDay(frozen, equipmentEnabled)).not.toBeNull();
      }
    }
    expect(frozen).toEqual(input);
  }
  expect(days).toEqual(before);
});

it("respects authorized organization boundaries and equipment toggle across DST", () => {
  const records = [
    record("appointments", "fold-visit", {
      title: "Fictional repeated-hour visit", status: "Scheduled",
      start: "2026-11-01T09:30:00Z", end: "2026-11-01T10:00:00Z",
    }),
    record("tasks", "open", {
      title: "Fictional future work", due: "2026-11-02", status: "Open",
    }),
    record("tasks", "foreign", {
      title: "Foreign work", due: "2026-11-01", status: "Open",
    }, FOREIGN),
    record("appointments", "archived", {
      title: "Archived visit", status: "Scheduled",
      start: "2026-11-01T08:30:00Z", end: "2026-11-01T09:00:00Z",
    }, ORG, true),
    record("equipment", "asset", { name: "Fictional equipment" }),
    record("equipment", "foreign-equipment", { name: "Private foreign equipment" }, FOREIGN),
  ];
  const states = [
    state("asset", "2026-11-01"),
    state("foreign-equipment", "2026-11-01", FOREIGN),
  ];
  const before = structuredClone({ records, states });
  const summary = summarizeDailyOperations({
    organizationId: ORG, records, equipmentStates: states,
  }, "America/Los_Angeles", "2026-10-31");
  const week = sevenDayWorkload(summary, "America/Los_Angeles");
  expect(week[0].date).toBe("2026-11-01");
  expect(earliestRecordedActivityDay(week, true)).toEqual({
    date: "2026-11-01", recordedItems: 2,
  });
  expect(earliestRecordedActivityDay(week, false)).toEqual({
    date: "2026-11-01", recordedItems: 1,
  });
  expect({ records, states }).toEqual(before);
});

it("keeps a leap-day work item on February 29 and recomputes fresh changes", () => {
  const task = record("tasks", "leap", {
    title: "Fictional leap work", due: "2028-02-29", status: "Open",
  });
  const records = [task];
  function first() {
    const summary = summarizeDailyOperations({
      organizationId: ORG, records, equipmentStates: [],
    }, "America/Los_Angeles", "2028-02-26");
    return earliestRecordedActivityDay(
      sevenDayWorkload(summary, "America/Los_Angeles"), false,
    );
  }
  expect(first()).toEqual({ date: "2028-02-29", recordedItems: 1 });
  task.data.due = "2028-03-02";
  expect(first()).toEqual({ date: "2028-03-02", recordedItems: 1 });
  task.data.status = "Done";
  expect(first()).toBeNull();
});
