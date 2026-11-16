import { expect, it } from "vitest";
import {
  busiestFocusedDay,
  busiestRecordedDay,
  earliestRecordedActivityDay,
  sevenDayWorkload,
  type DailyWorkload,
} from "../../src/core/daily-operations-workload";
import {
  isReviewableOperationsDate,
  OPERATIONS_DATE_MAX,
} from "../../src/core/daily-operations-dates";
import { summarizeDailyOperations } from "../../src/core/daily-operations";
import type { WorkspaceRecord } from "../../src/core/engine";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function record(
  id: string, due: string, organization_id = ORG,
  archived = false,
): WorkspaceRecord {
  return {
    id, entity: "tasks", organization_id, archived,
    revision: 1, config_revision: 1,
    created_at: "2100-12-01T00:00:00Z",
    updated_at: "2100-12-01T00:00:00Z",
    data: { title: "Fictional work " + id, status: "Open", due },
  };
}

it("keeps full saved peak counts visible even when their dates cannot be reviewed", () => {
  const records = [
    record("jan-first", "2101-01-01"),
    record("jan-second", "2101-01-01"),
    record("jan-third", "2101-01-04"),
    record("private", "2101-01-01", FOREIGN),
    record("archived", "2101-01-01", ORG, true),
  ];
  const before = structuredClone(records);
  const overview = summarizeDailyOperations(
    { organizationId: ORG, records, equipmentStates: [] },
    "UTC", OPERATIONS_DATE_MAX,
  );
  const week = sevenDayWorkload(overview, "UTC");
  expect(week).toHaveLength(7);
  expect(week[0].date).toBe("2101-01-01");
  const peak = busiestRecordedDay(week, false);
  const focusedPeak = busiestFocusedDay(week, false, "work");
  const earliest = earliestRecordedActivityDay(week, false);
  expect(peak).toEqual({
    date: "2101-01-01", recordedItems: 2, tiedDates: 1,
  });
  expect(focusedPeak).toEqual({
    date: "2101-01-01", matchingItems: 2, tiedDates: 1,
  });
  expect(earliest).toEqual({
    date: "2101-01-01", recordedItems: 2,
  });
  for (const candidate of [peak?.date, focusedPeak?.date, earliest?.date]) {
    expect(candidate).toBeDefined();
    expect(isReviewableOperationsDate(candidate!)).toBe(false);
  }
  expect(records).toEqual(before);
});

it("keeps peak and focused review dates usable when they are in range", () => {
  const rows: DailyWorkload[] = [
    { date: "2100-12-30", appointments: 3, unfinishedWork: 0, inspections: 0 },
    { date: "2100-12-31", appointments: 0, unfinishedWork: 4, inspections: 0 },
    { date: "2101-01-01", appointments: 0, unfinishedWork: 2, inspections: 0 },
  ];
  const peak = busiestRecordedDay(rows, false);
  const appointments = busiestFocusedDay(rows, false, "appointments");
  expect(peak?.date).toBe("2100-12-31");
  expect(appointments?.date).toBe("2100-12-30");
  expect(isReviewableOperationsDate(peak!.date)).toBe(true);
  expect(isReviewableOperationsDate(appointments!.date)).toBe(true);
  expect(isReviewableOperationsDate(rows[2].date)).toBe(false);
  expect(rows[0].appointments).toBe(3);
});
