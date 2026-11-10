import { expect, it } from "vitest";
import { summarizeDailyOperations } from "../../src/core/daily-operations";
import { sevenDayWorkloadCsv, visibleWorkloadCsv } from "../../src/core/seven-day-workload-csv";
import { sevenDayWorkload, filterWorkloadDaysByCalendarDay, orderWorkloadDays } from "../../src/core/daily-operations-workload";
import type { WorkspaceRecord } from "../../src/core/engine";
import type { EquipmentState } from "../../src/core/equipment";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function record(
  entity: string, id: string, data: WorkspaceRecord["data"],
  organization_id = org, archived = false,
): WorkspaceRecord {
  return {
    entity, id, data, organization_id, archived, revision: 1, config_revision: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}
function equipmentState(
  record_id: string, next_inspection: string,
  organization_id = org,
): EquipmentState {
  return {
    record_id, organization_id, revision: 1,
    asset_key: record_id, barcode_key: null, condition: "Serviceable",
    maintenance: "Clear", work_id: null, technician_id: null,
    last_service: null, next_inspection,
  };
}

it("exports seven business-local dates and a reconciled totals row", () => {
  const records = [
    record("appointments", "visit", {
      title: "Fictional house visit", status: "Scheduled",
      start: "2026-11-06T18:30:00Z", end: "2026-11-06T19:30:00Z",
    }),
    record("appointments", "cancelled", {
      title: "Cancelled booking", status: "Cancelled",
      start: "2026-11-06T20:00:00Z", end: "2026-11-06T21:00:00Z",
    }),
    record("tasks", "task", {
      title: "Fictional repairs", due: "2026-11-09", status: "Open",
    }),
    record("tasks", "undated", { title: "Missing due date", status: "Open" }),
    record("tasks", "finished", {
      title: "Finished work", due: "2026-11-09", status: "Done",
    }),
    record("tasks", "foreign-work", {
      title: "Foreign task", due: "2026-11-09", status: "Open",
    }, other),
    record("equipment", "tool", { name: "Floor buffer" }),
    record("equipment", "foreign-tool", { name: "Foreign buffer" }, other),
    record("equipment", "archived", { name: "Archived buffer" }, org, true),
  ];
  const equipmentStates = [
    equipmentState("tool", "2026-11-07"),
    equipmentState("foreign-tool", "2026-11-07", other),
    equipmentState("archived", "2026-11-07"),
  ];
  const summary = summarizeDailyOperations({
    organizationId: org, records, equipmentStates,
  }, "America/Los_Angeles", "2026-11-05");
  const csv = sevenDayWorkloadCsv(summary, "America/Los_Angeles", true);
  const rows = csv.trimEnd().split("\r\n");
  expect(rows).toHaveLength(9); // Header + exactly seven dates + TOTAL.
  expect(rows[0]).toContain('"Equipment inspections due"');
  expect(rows[1]).toBe(
    '"2026-11-05","2026-11-12","2026-11-06","1","0","0","Yes","America/Los_Angeles"',
  );
  expect(rows[2]).toBe(
    '"2026-11-05","2026-11-12","2026-11-07","0","0","1","Yes","America/Los_Angeles"',
  );
  expect(rows[4]).toBe(
    '"2026-11-05","2026-11-12","2026-11-09","0","1","0","Yes","America/Los_Angeles"',
  );
  expect(rows[8]).toBe(
    '"2026-11-05","2026-11-12","TOTAL (7 days)","1","1","1","3 of 7 days","America/Los_Angeles"',
  );
  for (const omitted of [
    "Fictional house visit", "Fictional repairs", "Foreign task",
    "Floor buffer", "Cancelled booking", "Missing due date",
  ]) expect(csv).not.toContain(omitted);
});

it("omits disabled equipment and treats inspection-only dates as inactive", () => {
  const summary = summarizeDailyOperations({
    organizationId: org,
    records: [record("equipment", "tool", { name: "Fictional tool" })],
    equipmentStates: [equipmentState("tool", "2026-11-07")],
  }, "America/Los_Angeles", "2026-11-05");
  const csv = sevenDayWorkloadCsv(summary, "America/Los_Angeles", false);
  const rows = csv.trimEnd().split("\r\n");
  expect(rows).toHaveLength(9);
  expect(rows[0]).not.toContain("Equipment inspections due");
  expect(rows[2]).toBe(
    '"2026-11-05","2026-11-12","2026-11-07","0","0","No","America/Los_Angeles"',
  );
  expect(rows[8]).toContain('"0 of 7 days"');
  expect(rows[8]).not.toContain('"1","');
});

it("keeps leap-day and daylight-saving windows calendar-correct", () => {
  const empty = summarizeDailyOperations({
    organizationId: org, records: [], equipmentStates: [],
  }, "America/Los_Angeles", "2028-02-26");
  const leap = sevenDayWorkloadCsv(empty, "America/Los_Angeles", true);
  expect(leap).toContain('"2028-02-29"');
  expect(leap).toContain('"2028-03-04"');
  expect(leap.trimEnd().split("\r\n")[8]).toContain('"0 of 7 days"');
  const fall = summarizeDailyOperations({
    organizationId: org, records: [], equipmentStates: [],
  }, "America/Los_Angeles", "2026-10-31");
  const csv = sevenDayWorkloadCsv(fall, "America/Los_Angeles", false);
  expect(csv).toContain('"2026-11-01"');
  expect(csv.trimEnd().split("\r\n")).toHaveLength(9);
});


it("exports only displayed weekend cards, preserving their order and full-week export", () => {
  const summary = summarizeDailyOperations({
    organizationId: org,
    records: [
      record("appointments", "weekday-visit", {
        title: "Private weekday name", status: "Scheduled",
        start: "2026-11-06T18:30:00Z", end: "2026-11-06T19:30:00Z",
      }),
      record("appointments", "weekend-visit", {
        title: "Private weekend name", status: "Scheduled",
        start: "2026-11-07T18:30:00Z", end: "2026-11-07T19:30:00Z",
      }),
      record("tasks", "weekend-work", {
        title: "Private task name", due: "2026-11-08", status: "Open",
      }),
      record("equipment", "tool", { name: "Private buffer" }),
    ],
    equipmentStates: [equipmentState("tool", "2026-11-07")],
  }, "America/Los_Angeles", "2026-11-05");
  const original = sevenDayWorkloadCsv(summary, "America/Los_Angeles", true);
  const week = sevenDayWorkload(summary, "America/Los_Angeles");
  const weekend = filterWorkloadDaysByCalendarDay(week, "weekends");
  const unsorted = [...weekend];
  const visible = orderWorkloadDays(weekend, true, "most-recorded");
  const csv = visibleWorkloadCsv(summary, "America/Los_Angeles", true, visible);
  const rows = csv.trimEnd().split("\r\n");
  expect(rows).toHaveLength(4); // Header + Saturday + Sunday + visible TOTAL.
  expect(rows[0]).toContain('"Visible business-local date"');
  expect(rows[0]).toContain('"Equipment inspections due"');
  expect(rows[1]).toContain('"2026-11-07","1","0","1"');
  expect(rows[2]).toContain('"2026-11-08","0","1","0"');
  expect(rows[3]).toContain('"TOTAL (visible 2 dates)","1","1","1"');
  expect(rows[3]).toContain('"2 of 2 visible dates"');
  for (const name of [
    "Private weekday name", "Private weekend name", "Private task name",
    "Private buffer",
  ]) expect(csv).not.toContain(name);
  expect(visible).toEqual(unsorted); // Source order remains stable.
  expect(sevenDayWorkloadCsv(summary, "America/Los_Angeles", true)).toBe(original);
  expect(original.trimEnd().split("\r\n")).toHaveLength(9);
});

it("exports empty filtered sets, ignores injected or stale counts and omits disabled equipment", () => {
  const summary = summarizeDailyOperations({
    organizationId: org,
    records: [record("equipment", "tool", { name: "Private asset" })],
    equipmentStates: [equipmentState("tool", "2026-11-07")],
  }, "America/Los_Angeles", "2026-11-05");
  const empty = visibleWorkloadCsv(summary, "America/Los_Angeles", true, []);
  expect(empty.trimEnd().split("\r\n")).toHaveLength(2);
  expect(empty).toContain('"TOTAL (visible 0 dates)"');
  expect(empty).toContain('"0 of 0 visible dates"');
  const fake = [
    { date: "2026-11-07", appointments: 999, unfinishedWork: 888, inspections: 777 },
    { date: "2026-11-07", appointments: 111, unfinishedWork: 111, inspections: 111 },
    { date: "2040-01-01", appointments: 5, unfinishedWork: 5, inspections: 5 },
  ];
  const withoutEquipment = visibleWorkloadCsv(
    summary, "America/Los_Angeles", false, fake,
  );
  const rows = withoutEquipment.trimEnd().split("\r\n");
  expect(rows).toHaveLength(3);
  expect(rows[0]).not.toContain("Equipment inspections due");
  expect(rows[1]).toContain('"2026-11-07","0","0","No"');
  expect(rows[2]).toContain('"TOTAL (visible 1 dates)","0","0"');
  expect(withoutEquipment).not.toContain("999");
  expect(withoutEquipment).not.toContain("2040");
  expect(withoutEquipment).not.toContain("Private asset");
});
