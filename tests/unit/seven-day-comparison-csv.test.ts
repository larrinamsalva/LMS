import { expect, it } from "vitest";
import { summarizeDailyOperations } from "../../src/core/daily-operations";
import { sevenDayComparisonCsv } from "../../src/core/seven-day-comparison-csv";
import { sevenDayWorkload } from "../../src/core/daily-operations-workload";
import type { WorkspaceRecord } from "../../src/core/engine";
import type { EquipmentState } from "../../src/core/equipment";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const foreign = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function record(entity: string, id: string, data: WorkspaceRecord["data"],
  organization_id = org): WorkspaceRecord {
  return {
    entity, id, data, organization_id, archived: false, revision: 1,
    config_revision: 1, created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}
function state(record_id: string, next_inspection: string): EquipmentState {
  return {
    record_id, organization_id: org, revision: 1,
    asset_key: record_id, barcode_key: null, condition: "Serviceable",
    maintenance: "Clear", work_id: null, technician_id: null,
    last_service: null, next_inspection,
  };
}

it("exports only aggregate counts and correct previous/current signed differences", () => {
  const workspace = {
    organizationId: org,
    records: [
      record("appointments", "prev", {
        title: "Private previous client", status: "Scheduled",
        start: "2026-11-01T18:00:00Z", end: "2026-11-01T19:00:00Z",
      }),
      record("appointments", "current", {
        title: "Private current client", status: "Scheduled",
        start: "2026-11-07T18:00:00Z", end: "2026-11-07T19:00:00Z",
      }),
      record("tasks", "work", { title: "Private task", due: "2026-11-08", status: "Open" }),
      record("appointments", "foreign", {
        title: "Foreign client", status: "Scheduled",
        start: "2026-11-07T18:00:00Z", end: "2026-11-07T19:00:00Z",
      }, foreign),
      record("equipment", "tool", { name: "Private floor machine" }),
    ],
    equipmentStates: [state("tool", "2026-11-08")],
  };
  const current = summarizeDailyOperations(workspace, "America/Los_Angeles", "2026-11-06");
  const previous = summarizeDailyOperations(workspace, "America/Los_Angeles", "2026-10-30");
  const csv = sevenDayComparisonCsv(current, previous, "America/Los_Angeles", true, "previous");
  const rows = csv.trimEnd().split("\r\n");
  expect(rows).toHaveLength(5);
  expect(rows[0]).toContain('"Change to current"');
  expect(rows[1]).toBe(
    '"Appointment starts","2026-11-07 through 2026-11-13",' +
    '"2026-10-31 through 2026-11-06","previous","1","1","0","America/Los_Angeles"',
  );
  expect(rows[2]).toContain('"Unfinished work due"');
  expect(rows[2]).toContain('"1","0","1"');
  expect(rows[3]).toContain('"Equipment inspections"');
  expect(rows[3]).toContain('"1","0","1"');
  expect(rows[4]).toContain('"Days with saved activity"');
  for (const privateText of [
    "Private previous client", "Private current client",
    "Private task", "Foreign client", "Private floor machine",
  ]) expect(csv).not.toContain(privateText);
});

it("exports following count changes, without disabled equipment columns", () => {
  const workspace = {
    organizationId: org,
    records: [
      record("appointments", "current", {
        title: "Private current client", status: "Scheduled",
        start: "2026-11-07T18:00:00Z", end: "2026-11-07T19:00:00Z",
      }),
      record("appointments", "later", {
        title: "Private future client", status: "Scheduled",
        start: "2026-11-14T18:00:00Z", end: "2026-11-14T19:00:00Z",
      }),
      record("tasks", "future", { title: "Private upcoming job", due: "2026-11-15", status: "Open" }),
    ],
    equipmentStates: [],
  };
  const current = summarizeDailyOperations(workspace, "America/Los_Angeles", "2026-11-06");
  const following = summarizeDailyOperations(workspace, "America/Los_Angeles", "2026-11-13");
  const csv = sevenDayComparisonCsv(current, following, "America/Los_Angeles", false, "following");
  const rows = csv.trimEnd().split("\r\n");
  expect(rows).toHaveLength(4);
  expect(rows[0]).toContain('"Change to following"');
  expect(csv).toContain('"2026-11-14 through 2026-11-20"');
  expect(rows[1]).toContain('"1","1","0"');
  expect(rows[2]).toContain('"0","1","1"');
  expect(csv).not.toContain("Equipment inspections");
  expect(csv).not.toContain("Private future client");
  expect(csv).not.toContain("Private upcoming job");
  expect(() => sevenDayComparisonCsv(
    current, current, "America/Los_Angeles", false, "previous",
  )).toThrow("adjacent seven-day window");
});

it("handles zero records and leap-day business-local windows", () => {
  const workspace = { organizationId: org, records: [], equipmentStates: [] };
  const current = summarizeDailyOperations(workspace, "America/Los_Angeles", "2028-02-26");
  const previous = summarizeDailyOperations(workspace, "America/Los_Angeles", "2028-02-19");
  const csv = sevenDayComparisonCsv(current, previous, "America/Los_Angeles", false, "previous");
  // The aggregate CSV carries ranges, not an individual row for leap day.
  expect(csv).toContain("2028-02-27 through 2028-03-04");
  expect(sevenDayWorkload(current, "America/Los_Angeles").map((day) => day.date))
    .toContain("2028-02-29");
  expect(csv.trimEnd().split("\r\n")).toHaveLength(4);
  expect(csv).not.toContain("Equipment inspections");
  expect(csv).toContain('"0","0","0"');
});
