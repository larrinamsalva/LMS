import { expect, it } from "vitest";
import { summarizeDailyOperations } from "../../src/core/daily-operations";
import {
  savedActivityTypeBreakdown,
  recordedActivityBars,
  sevenDayWorkload,
  summarizeSevenDayWorkload,
  type DailyWorkload,
} from "../../src/core/daily-operations-workload";
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

// Independent oracle based only on existing chart counts and the supplied
// saved day cards; never infer hours, staff capacity, bookable slots or urgency.
function originalBreakdownOracle(
  days: readonly DailyWorkload[], includeInspections: boolean,
) {
  return days.map((day) => ({
    date: day.date,
    appointments: day.appointments,
    unfinishedWork: day.unfinishedWork,
    inspections: includeInspections ? day.inspections : 0,
    savedItems: day.appointments + day.unfinishedWork +
      (includeInspections ? day.inspections : 0),
  }));
}

it("retains exact category counts, chart totals, day order and disabled-equipment rules", () => {
  const days: DailyWorkload[] = [
    { date: "2026-11-06", appointments: 1, unfinishedWork: 2, inspections: 3 },
    { date: "2026-11-07", appointments: 0, unfinishedWork: 0, inspections: 4 },
    { date: "2026-11-08", appointments: 2, unfinishedWork: 1, inspections: 0 },
    { date: "2026-11-09", appointments: 0, unfinishedWork: 0, inspections: 0 },
  ];
  const before = structuredClone(days);
  expect(savedActivityTypeBreakdown(days, true)).toEqual([
    { date: "2026-11-06", appointments: 1, unfinishedWork: 2, inspections: 3, savedItems: 6 },
    { date: "2026-11-07", appointments: 0, unfinishedWork: 0, inspections: 4, savedItems: 4 },
    { date: "2026-11-08", appointments: 2, unfinishedWork: 1, inspections: 0, savedItems: 3 },
    { date: "2026-11-09", appointments: 0, unfinishedWork: 0, inspections: 0, savedItems: 0 },
  ]);
  expect(savedActivityTypeBreakdown(days, false)).toEqual([
    { date: "2026-11-06", appointments: 1, unfinishedWork: 2, inspections: 0, savedItems: 3 },
    { date: "2026-11-07", appointments: 0, unfinishedWork: 0, inspections: 0, savedItems: 0 },
    { date: "2026-11-08", appointments: 2, unfinishedWork: 1, inspections: 0, savedItems: 3 },
    { date: "2026-11-09", appointments: 0, unfinishedWork: 0, inspections: 0, savedItems: 0 },
  ]);
  for (const equipmentEnabled of [false, true]) {
    const breakdown = savedActivityTypeBreakdown(days, equipmentEnabled);
    const bars = recordedActivityBars(days, equipmentEnabled);
    const totals = summarizeSevenDayWorkload(days, equipmentEnabled);
    expect(breakdown.map((row) => row.savedItems))
      .toEqual(bars.map((row) => row.savedItems));
    expect(breakdown.reduce((sum, row) => sum + row.savedItems, 0))
      .toBe(totals.appointments + totals.unfinishedWork + totals.inspections);
  }
  expect(days).toEqual(before);
});

it("matches a separate type-sum oracle for 720 reversed, filtered, repeated and empty fictional days", () => {
  const days: DailyWorkload[] = Array.from({ length: 720 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
    appointments: i % 13 === 0 ? (i % 5) + 1 : 0,
    unfinishedWork: i % 7 === 0 ? 2 : 0,
    inspections: i % 11 === 0 ? 3 : 0,
  }));
  const repeated: DailyWorkload = {
    date: "2026-11-05", appointments: 0, unfinishedWork: 0, inspections: 2,
  };
  days.push(repeated, repeated);
  const original = structuredClone(days);
  for (const input of [
    days, [...days].reverse(), days.slice(-14),
    days.filter((_, i) => i % 8 === 0), [] as DailyWorkload[],
  ]) {
    const frozen = Object.freeze([...input]);
    for (const enabled of [false, true]) {
      const actual = savedActivityTypeBreakdown(frozen, enabled);
      expect(actual).toEqual(originalBreakdownOracle(frozen, enabled));
      expect(actual.map((row) => row.savedItems))
        .toEqual(recordedActivityBars(frozen, enabled).map((bar) => bar.savedItems));
      actual.forEach((row, i) => {
        expect(row.date).toBe(frozen[i].date);
        expect(row).not.toBe(frozen[i]);
        expect(row.savedItems)
          .toBe(row.appointments + row.unfinishedWork + row.inspections);
      });
    }
    expect(frozen).toEqual(input);
  }
  expect(days).toEqual(original);
});

it("uses the authorized business-local seven-day window through fall DST and leap day", () => {
  const records: WorkspaceRecord[] = [
    record("appointments", "fall", {
      title: "PRIVATE CUSTOMER", status: "Scheduled",
      start: "2026-11-01T09:30:00Z", end: "2026-11-01T10:00:00Z",
    }),
    record("tasks", "due", { title: "PRIVATE JOB", status: "Open", due: "2026-11-02" }),
    record("tasks", "foreign", { title: "FOREIGN PRIVATE WORK", status: "Open", due: "2026-11-01" }, FOREIGN),
    record("appointments", "archived", {
      title: "ARCHIVED PRIVATE VISIT", status: "Scheduled",
      start: "2026-11-01T08:30:00Z", end: "2026-11-01T09:00:00Z",
    }, ORG, true),
    record("equipment", "asset", { name: "PRIVATE EQUIPMENT" }),
    record("tasks", "leap", { title: "PRIVATE LEAP TASK", status: "Open", due: "2028-02-29" }),
  ];
  const states: EquipmentState[] = [equipment("asset", "2026-11-01")];
  const original = structuredClone({ records, states });
  const overview = summarizeDailyOperations({
    organizationId: ORG, records, equipmentStates: states,
  }, "America/Los_Angeles", "2026-10-31");
  const rows = savedActivityTypeBreakdown(
    sevenDayWorkload(overview, "America/Los_Angeles"), true,
  );
  expect(rows).toHaveLength(7);
  expect(rows[0]).toEqual({
    date: "2026-11-01", appointments: 1,
    unfinishedWork: 0, inspections: 1, savedItems: 2,
  });
  expect(rows[1]).toEqual({
    date: "2026-11-02", appointments: 0,
    unfinishedWork: 1, inspections: 0, savedItems: 1,
  });
  expect(savedActivityTypeBreakdown(
    sevenDayWorkload(overview, "America/Los_Angeles"), false,
  )[0].savedItems).toBe(1);
  const leap = summarizeDailyOperations({
    organizationId: ORG, records, equipmentStates: states,
  }, "America/Los_Angeles", "2028-02-26");
  expect(savedActivityTypeBreakdown(
    sevenDayWorkload(leap, "America/Los_Angeles"), false,
  )[2]).toEqual({
    date: "2028-02-29", appointments: 0,
    unfinishedWork: 1, inspections: 0, savedItems: 1,
  });
  expect({ records, states }).toEqual(original);
});
