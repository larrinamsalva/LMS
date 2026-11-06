import { expect, it } from "vitest";
import { summarizeDailyOperations } from "../../src/core/daily-operations";
import { upcomingInspectionsCsv } from "../../src/core/upcoming-equipment-inspections-csv";
import type { WorkspaceRecord } from "../../src/core/engine";
import type { EquipmentState } from "../../src/core/equipment";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function record(
  id: string, name: string, organization_id = org, archived = false,
): WorkspaceRecord {
  return {
    id, entity: "equipment", organization_id, archived,
    revision: 1, config_revision: 1,
    data: { name, asset_id: "ASSET-" + id },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}
function equipmentState(
  record_id: string, condition: EquipmentState["condition"],
  next_inspection: string | null, organization_id = org,
): EquipmentState {
  return {
    organization_id, record_id, revision: 1, asset_key: record_id,
    barcode_key: null, condition, maintenance: "Clear",
    work_id: null, technician_id: null, last_service: null, next_inspection,
  };
}

it("exports every upcoming inspection beyond four on business-local days 1–7", () => {
  const records = [
    record("1", "Early scrubber"),
    record("2", "Midweek polisher"),
    record("3", "=HYPERLINK(\"unsafe\")"),
    record("4", "Friday vacuum"),
    record("5", "Last-day carpet cleaner"),
    record("today", "Due today"),
    record("overdue", "Already overdue"),
    record("beyond", "Out of window"),
    record("broken", "Needs repair"),
    record("retired", "Retired item"),
    record("archived", "Archived item", org, true),
    record("foreign", "Other company's item", other),
  ];
  const equipmentStates = [
    equipmentState("1", "Serviceable", "2026-11-06"),
    equipmentState("2", "Serviceable", "2026-11-08"),
    equipmentState("3", "Serviceable", "2026-11-09"),
    equipmentState("4", "Serviceable", "2026-11-10"),
    equipmentState("5", "Serviceable", "2026-11-12"),
    equipmentState("today", "Serviceable", "2026-11-05"),
    equipmentState("overdue", "Serviceable", "2026-11-04"),
    equipmentState("beyond", "Serviceable", "2026-11-13"),
    equipmentState("broken", "Out of service", "2026-11-07"),
    equipmentState("retired", "Retired", "2026-11-09"),
    equipmentState("archived", "Serviceable", "2026-11-08"),
    equipmentState("foreign", "Serviceable", "2026-11-06", other),
  ];
  const summary = summarizeDailyOperations(
    { organizationId: org, records, equipmentStates },
    "America/Los_Angeles", "2026-11-05",
  );
  const csv = upcomingInspectionsCsv(summary, "America/Los_Angeles");
  const lines = csv.trimEnd().split("\r\n");
  expect(lines).toHaveLength(6);
  expect(csv).toContain('"2026-11-05","2026-11-12"');
  expect(csv).toContain('"Early scrubber","ASSET-1","2026-11-06","Serviceable"');
  expect(csv).toContain('"Last-day carpet cleaner","ASSET-5","2026-11-12"');
  expect(csv).toContain('"\'=HYPERLINK(""unsafe"")"'); // Spreadsheet formula neutralized.
  expect(lines[1]).toContain("Early scrubber");
  expect(lines[5]).toContain("Last-day carpet cleaner");
  for (const excluded of [
    "Due today", "Already overdue", "Out of window", "Needs repair",
    "Retired item", "Archived item", "Other company's item",
  ]) expect(csv).not.toContain(excluded);
  expect(csv).not.toContain("serial");
  expect(csv).not.toContain("purchase_cost");
});

it("returns a header-only file when there are no scheduled future inspections", () => {
  const result = summarizeDailyOperations(
    {
      organizationId: org,
      records: [record("old", "Past due tool")],
      equipmentStates: [equipmentState("old", "Serviceable", "2026-11-05")],
    },
    "America/Los_Angeles", "2026-11-05",
  );
  const csv = upcomingInspectionsCsv(result, "America/Los_Angeles");
  expect(csv.trimEnd().split("\r\n")).toHaveLength(1);
  expect(csv).toContain('"Next inspection date"');
  expect(csv).not.toContain("Past due tool");
});

it("respects the selected date and the seven-calendar-day window through DST", () => {
  const records = [record("dst", "After clock change")];
  const equipmentStates = [equipmentState("dst", "Serviceable", "2026-11-02")];
  const first = summarizeDailyOperations(
    { organizationId: org, records, equipmentStates },
    "America/Los_Angeles", "2026-10-31",
  );
  expect(upcomingInspectionsCsv(first, "America/Los_Angeles"))
    .toContain('"2026-11-02"');
  const later = summarizeDailyOperations(
    { organizationId: org, records, equipmentStates },
    "America/Los_Angeles", "2026-11-02",
  );
  expect(upcomingInspectionsCsv(later, "America/Los_Angeles"))
    .not.toContain("After clock change");
});
