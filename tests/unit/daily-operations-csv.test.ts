import { expect, it } from "vitest";
import { csvSafeCell, dailyOperationsCsv } from "../../src/core/daily-operations-csv";
import { summarizeDailyOperations } from "../../src/core/daily-operations";
import type { WorkspaceRecord } from "../../src/core/engine";
import type { EquipmentState } from "../../src/core/equipment";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function record(
  entity: string, id: string, data: WorkspaceRecord["data"],
  organization_id = org, archived = false,
): WorkspaceRecord {
  return {
    id, entity, data, organization_id, archived,
    revision: 1, config_revision: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}
function equipment(record_id: string, organization_id = org): EquipmentState {
  return {
    organization_id, record_id, revision: 1,
    asset_key: record_id, barcode_key: null,
    condition: "Needs inspection", maintenance: "Clear",
    work_id: null, technician_id: null, last_service: null,
    next_inspection: null,
  };
}

it("quotes commas, quotes and line breaks; neutralizes formulas after leading whitespace", () => {
  expect(csvSafeCell('A "quoted", name')).toBe('"A ""quoted"", name"');
  expect(csvSafeCell("row 1\nrow 2")).toBe('"row 1\nrow 2"');
  expect(csvSafeCell("=SUM(A1:A2)")).toBe('"\'=SUM(A1:A2)"');
  expect(csvSafeCell(" \t+cmd")).toBe('"\' \t+cmd"');
  expect(csvSafeCell("-4")).toBe('"\'-4"');
  expect(csvSafeCell("@SUM(1)")).toBe('"\'@SUM(1)"');
  expect(csvSafeCell("\n=1+2")).toBe('"\'\n=1+2"');
});

it("exports every current-business record with local time, but excludes foreign, cancelled, archived and completed work", () => {
  const records = [
    record("appointments", "visit", {
      title: "Fictional visit", status: "Scheduled",
      start: "2026-11-06T18:30:00Z", end: "2026-11-06T19:30:00Z",
    }),
    record("appointments", "cancel", {
      title: "Cancelled booking", status: "Cancelled",
      start: "2026-11-06T18:30:00Z", end: "2026-11-06T19:30:00Z",
    }),
    record("appointments", "foreign-appt", {
      title: "Foreign booking", status: "Scheduled",
      start: "2026-11-06T18:30:00Z", end: "2026-11-06T19:30:00Z",
    }, other),
    record("jobs", "overdue", {
      title: "Fictional old job", date: "2026-11-05", status: "Planned",
    }),
    record("tasks", "today", {
      title: "=HYPERLINK(\"bad\")", due: "2026-11-06", status: "Open",
    }),
    record("jobs", "finished", {
      title: "Completed job", date: "2026-11-05", status: "Done",
    }),
    record("tasks", "other-task", {
      title: "Foreign work", due: "2026-11-06", status: "Open",
    }, other),
    record("equipment", "asset", { name: "Fictional scrubber" }),
    record("equipment", "other-asset", { name: "Foreign equipment" }, other),
    record("equipment", "archived-asset", { name: "Archived equipment" }, org, true),
  ];
  const equipmentStates = [
    equipment("asset"), equipment("other-asset", other),
    equipment("archived-asset"),
  ];
  const overview = summarizeDailyOperations(
    { organizationId: org, records, equipmentStates },
    "America/Los_Angeles", "2026-11-06",
  );
  const csv = dailyOperationsCsv(overview, "America/Los_Angeles", true);
  const lines = csv.trimEnd().split("\r\n");
  expect(lines).toHaveLength(5);
  expect(csv).toContain('"Fictional visit"');
  expect(csv).toContain('"2026-11-06 10:30-08:00"');
  expect(csv).toContain('"Overdue work","Fictional old job"');
  expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
  expect(csv).toContain('"Equipment attention","Fictional scrubber"');
  for (const excluded of [
    "Foreign booking", "Foreign work", "Foreign equipment",
    "Cancelled booking", "Completed job", "Archived equipment",
  ]) expect(csv).not.toContain(excluded);
  const noEquipment = dailyOperationsCsv(overview, "America/Los_Angeles", false);
  expect(noEquipment).not.toContain("Fictional scrubber");
  expect(noEquipment.split("\r\n").length).toBe(5);
});

it("exports the header even for an empty fictional day", () => {
  const overview = summarizeDailyOperations(
    { organizationId: org, records: [], equipmentStates: [] },
    "UTC", "2026-11-06",
  );
  expect(dailyOperationsCsv(overview, "UTC", true).trimEnd().split("\r\n"))
    .toHaveLength(1);
});
