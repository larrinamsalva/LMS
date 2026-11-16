import { expect, it } from "vitest";
import { summarizeDailyOperations } from "../../src/core/daily-operations";
import {
  earliestFocusedActivityDay,
  filterWorkloadDaysByType,
  focusedRecordedItemCount,
  sevenDayWorkload,
  type DailyWorkload,
  type WorkloadActivityType,
} from "../../src/core/daily-operations-workload";
import type { WorkspaceRecord } from "../../src/core/engine";
import type { EquipmentState } from "../../src/core/equipment";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TYPES: WorkloadActivityType[] = ["all", "appointments", "work", "inspections"];

// Independent reference: use the preexisting category filter and a sorted
// copy rather than the new single-pass earliest-date algorithm.
function originalFocusedOracle(
  days: readonly DailyWorkload[],
  withEquipment: boolean,
  type: WorkloadActivityType,
): { date: string; matchingItems: number } | null {
  const filtered = filterWorkloadDaysByType(days, withEquipment, type)
    .sort((a, b) => a.date.localeCompare(b.date));
  const first = filtered.find((day) =>
    focusedRecordedItemCount(day, withEquipment, type) > 0,
  );
  return first === undefined ? null : {
    date: first.date,
    matchingItems: focusedRecordedItemCount(first, withEquipment, type),
  };
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

function equipment(
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

it("chooses earliest matching category, not biggest counts or initial array order", () => {
  const days: DailyWorkload[] = [
    { date: "2026-11-12", appointments: 14, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-10", appointments: 0, unfinishedWork: 9, inspections: 0 },
    { date: "2026-11-06", appointments: 0, unfinishedWork: 0, inspections: 2 },
    { date: "2026-11-08", appointments: 1, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-07", appointments: 0, unfinishedWork: 1, inspections: 0 },
  ];
  const before = structuredClone(days);
  expect(earliestFocusedActivityDay(days, true, "appointments"))
    .toEqual({ date: "2026-11-08", matchingItems: 1 });
  expect(earliestFocusedActivityDay(days, true, "work"))
    .toEqual({ date: "2026-11-07", matchingItems: 1 });
  expect(earliestFocusedActivityDay(days, true, "inspections"))
    .toEqual({ date: "2026-11-06", matchingItems: 2 });
  expect(earliestFocusedActivityDay(days, false, "inspections")).toBeNull();
  expect(earliestFocusedActivityDay(days, true, "all"))
    .toEqual({ date: "2026-11-06", matchingItems: 2 });
  expect(earliestFocusedActivityDay([...days].reverse(), true, "work"))
    .toEqual({ date: "2026-11-07", matchingItems: 1 });
  expect(days).toEqual(before);
});

it("matches existing category and count calculations across 720 fictional date cards", () => {
  const days: DailyWorkload[] = Array.from({ length: 720 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
    appointments: i % 19 === 0 ? i % 5 + 1 : 0,
    unfinishedWork: i % 13 === 0 ? 2 : 0,
    inspections: i % 11 === 0 ? 1 : 0,
  }));
  const repeated = {
    date: "2026-11-06", appointments: 0,
    unfinishedWork: 0, inspections: 2,
  };
  days.push(repeated, repeated);
  const before = structuredClone(days);
  for (const input of [
    days, [...days].reverse(), days.slice(-35),
    days.filter((_, i) => i % 4 === 0), [] as DailyWorkload[],
  ]) {
    const frozen = Object.freeze([...input]);
    for (const withEquipment of [true, false]) {
      for (const type of TYPES) {
        expect(earliestFocusedActivityDay(frozen, withEquipment, type))
          .toEqual(originalFocusedOracle(frozen, withEquipment, type));
      }
    }
    expect(frozen).toEqual(input);
  }
  expect(days).toEqual(before);
});

it("returns no focused dates for an empty week or disabled inspections", () => {
  const empty = Array.from({ length: 7 }, (_, index) => ({
    date: ["2026-11-06", "2026-11-07", "2026-11-08",
      "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"][index],
    appointments: 0, unfinishedWork: 0, inspections: 0,
  }));
  for (const type of TYPES) {
    expect(earliestFocusedActivityDay([], true, type)).toBeNull();
    expect(earliestFocusedActivityDay(empty, true, type)).toBeNull();
  }
  const inspectionOnly = [
    { date: "2026-11-06", appointments: 0, unfinishedWork: 0, inspections: 4 },
  ];
  expect(earliestFocusedActivityDay(inspectionOnly, false, "all")).toBeNull();
  expect(earliestFocusedActivityDay(inspectionOnly, false, "inspections")).toBeNull();
  expect(earliestFocusedActivityDay(inspectionOnly, true, "inspections"))
    .toEqual({ date: "2026-11-06", matchingItems: 4 });
});

it("uses only authorized business records through the DST fold and leap dates", () => {
  const records = [
    record("appointments", "fall", {
      title: "Fictional DST visit", status: "Scheduled",
      start: "2026-11-01T09:30:00Z", end: "2026-11-01T10:00:00Z",
    }),
    record("tasks", "future", {
      title: "Fictional work", status: "Open", due: "2026-11-02",
    }),
    record("appointments", "foreign", {
      title: "PRIVATE FOREIGN VISIT", status: "Scheduled",
      start: "2026-11-01T08:30:00Z", end: "2026-11-01T09:00:00Z",
    }, FOREIGN),
    record("tasks", "archived", {
      title: "PRIVATE ARCHIVED WORK", status: "Open", due: "2026-11-01",
    }, ORG, true),
    record("equipment", "asset", { name: "Fictional tool" }),
    record("tasks", "leap", {
      title: "Leap day work", status: "Open", due: "2028-02-29",
    }),
  ];
  const states = [equipment("asset", "2026-11-01")];
  const snapshot = structuredClone({ records, states });
  const fall = summarizeDailyOperations({
    organizationId: ORG, records, equipmentStates: states,
  }, "America/Los_Angeles", "2026-10-31");
  const days = sevenDayWorkload(fall, "America/Los_Angeles");
  expect(earliestFocusedActivityDay(days, true, "appointments"))
    .toEqual({ date: "2026-11-01", matchingItems: 1 });
  expect(earliestFocusedActivityDay(days, true, "work"))
    .toEqual({ date: "2026-11-02", matchingItems: 1 });
  expect(earliestFocusedActivityDay(days, true, "inspections"))
    .toEqual({ date: "2026-11-01", matchingItems: 1 });
  const leap = summarizeDailyOperations({
    organizationId: ORG, records, equipmentStates: states,
  }, "America/Los_Angeles", "2028-02-26");
  expect(earliestFocusedActivityDay(
    sevenDayWorkload(leap, "America/Los_Angeles"), false, "work",
  )).toEqual({ date: "2028-02-29", matchingItems: 1 });
  expect({ records, states }).toEqual(snapshot);
});
