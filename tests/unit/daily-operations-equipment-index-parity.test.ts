import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import type { EquipmentState } from "../../src/core/equipment";
import {
  summarizeDailyOperations,
  type EquipmentAttention,
  type UpcomingEquipmentInspection,
} from "../../src/core/daily-operations";

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

function state(
  record_id: string,
  condition: EquipmentState["condition"],
  next_inspection: string | null,
  organization_id = ORG,
): EquipmentState {
  return {
    organization_id, record_id, revision: 1,
    asset_key: record_id, barcode_key: null,
    condition, maintenance: "Clear",
    work_id: null, technician_id: null,
    last_service: null, next_inspection,
  };
}

// Independent copy of the equipment/inspection logic from merged five-green
// LMS #175. Deliberately scans authorized records with .find() PER state,
// preserving the original first-record-wins rule for duplicate record IDs.
function previousEquipmentViews(
  allRecords: readonly WorkspaceRecord[],
  allStates: readonly EquipmentState[],
  organizationId: string,
  date: string,
  upcomingThrough: string,
): {
  equipment: EquipmentAttention[];
  upcomingEquipmentInspections: UpcomingEquipmentInspection[];
} {
  const records = allRecords.filter(
    (r) => r.organization_id === organizationId && !r.archived,
  );
  const equipment = allStates
    .filter((s) => s.organization_id === organizationId)
    .flatMap((s): EquipmentAttention[] => {
      const item = records.find(
        (r) => r.entity === "equipment" && r.id === s.record_id,
      );
      if (!item || s.condition === "Retired") return [];
      const reason = s.condition !== "Serviceable"
        ? s.condition
        : s.next_inspection && String(s.next_inspection).slice(0, 10) <= date
          ? "Inspection due" : "";
      return reason ? [{ record: item, reason }] : [];
    })
    .sort((a, b) =>
      String(a.record.data.name).localeCompare(String(b.record.data.name)),
    );
  const upcomingEquipmentInspections = allStates
    .filter((s) => s.organization_id === organizationId)
    .flatMap((s): UpcomingEquipmentInspection[] => {
      const item = records.find(
        (r) => r.entity === "equipment" && r.id === s.record_id,
      );
      if (!item || s.condition !== "Serviceable" || !s.next_inspection) {
        return [];
      }
      const due = String(s.next_inspection).slice(0, 10);
      return due > date && due <= upcomingThrough ? [{ record: item, due }] : [];
    })
    .sort((a, b) =>
      a.due.localeCompare(b.due) ||
      String(a.record.data.name).localeCompare(String(b.record.data.name)) ||
      a.record.id.localeCompare(b.record.id),
    );
  return { equipment, upcomingEquipmentInspections };
}

function checkSameRecords<T extends { record: WorkspaceRecord }>(
  actual: readonly T[], expected: readonly T[],
) {
  expect(actual).toEqual(expected);
  expect(actual).toHaveLength(expected.length);
  actual.forEach((row, i) => expect(row.record).toBe(expected[i].record));
}

it("preserves exact equipment and upcoming inspection views across 720 fictional states", () => {
  const names: Array<string | number> = [
    "Fictional Scrubber", "Fictional Scrubber", "Carpet Extractor",
    "Floor Polisher", "Vacuum", "İSTANBUL Equipment", 42, "",
  ];
  const records: WorkspaceRecord[] = Array.from({ length: 240 }, (_, i) =>
    record("equipment", "asset-" + i, {
      name: names[i % names.length],
      asset_id: "fictional-" + i,
      notes: "PRIVATE EQUIPMENT NOTE",
    }, i % 31 === 0 ? FOREIGN : ORG, i % 23 === 0),
  );
  records.push(
    record("equipment", "asset-7", { name: "Duplicate ignored name" }),
    record("equipment", "asset-7", { name: "Foreign private asset" }, FOREIGN),
    record("tasks", "asset-7", { name: "Wrong entity" }),
    record("equipment", "asset-4", { name: "Archived duplicate" }, ORG, true),
    record("equipment", "asset-4", { name: "Current duplicate" }),
  );
  const conditions: EquipmentState["condition"][] = [
    "Serviceable", "Serviceable", "Needs inspection",
    "Under maintenance", "Out of service", "Retired",
  ];
  const inspections: Array<string | null> = [
    "2026-11-04", "2026-11-05", "2026-11-06",
    "2026-11-12", "2026-11-13", "2026-03-08",
    "2028-02-29", null,
  ];
  const states: EquipmentState[] = Array.from({ length: 720 }, (_, i) =>
    state("asset-" + (i % 252), conditions[i % conditions.length],
      inspections[i % inspections.length], i % 17 === 0 ? FOREIGN : ORG),
  );
  const repeated = state("asset-7", "Serviceable", "2026-11-06");
  states.push(repeated, repeated,
    state("asset-7", "Needs inspection", "2026-11-06"),
    state("asset-7", "Retired", "2026-11-06"),
    state("asset-7", "Serviceable", "2026-11-06", FOREIGN));
  const original = structuredClone({ records, states });
  for (const zone of ["UTC", "America/Los_Angeles", "America/New_York"]) {
    for (const date of [
      "2026-11-04", "2026-11-05", "2026-11-06",
      "2026-03-07", "2028-02-26",
    ]) {
      const summary = summarizeDailyOperations({
        organizationId: ORG, records, equipmentStates: states,
      }, zone, date);
      const previous = previousEquipmentViews(
        records, states, ORG, date, summary.upcomingThrough,
      );
      checkSameRecords(summary.equipment, previous.equipment);
      checkSameRecords(summary.upcomingEquipmentInspections,
        previous.upcomingEquipmentInspections);
      for (const item of [
        ...summary.equipment, ...summary.upcomingEquipmentInspections,
      ]) {
        expect(item.record.organization_id).toBe(ORG);
        expect(item.record.archived).toBe(false);
        expect(item.record.entity).toBe("equipment");
      }
    }
  }
  expect({ records, states }).toEqual(original);
});

it("keeps the first authorized, non-archived matching equipment revision and duplicates", () => {
  const archived = record("equipment", "same", { name: "Archived" },
    ORG, true);
  const foreign = record("equipment", "same", { name: "Foreign" }, FOREIGN);
  const wrongEntity = record("tasks", "same", { name: "Task not equipment" });
  const first = record("equipment", "same", { name: "First active asset" });
  const second = record("equipment", "same", { name: "Ignored newer revision" });
  const records = [archived, foreign, wrongEntity, first, second];
  const repeated = state("same", "Needs inspection", null);
  const future = state("same", "Serviceable", "2026-11-06");
  const states = [
    repeated, repeated, future,
    state("same", "Needs inspection", null, FOREIGN),
  ];
  const result = summarizeDailyOperations({
    organizationId: ORG, records, equipmentStates: states,
  }, "UTC", "2026-11-05");
  const expected = previousEquipmentViews(records, states, ORG,
    "2026-11-05", result.upcomingThrough);
  checkSameRecords(result.equipment, expected.equipment);
  checkSameRecords(result.upcomingEquipmentInspections,
    expected.upcomingEquipmentInspections);
  expect(result.equipment).toHaveLength(2);
  expect(result.equipment[0].record).toBe(first);
  expect(result.equipment[1].record).toBe(first);
  expect(result.upcomingEquipmentInspections).toHaveLength(1);
  expect(result.upcomingEquipmentInspections[0].record).toBe(first);
});

it("rebuilds the equipment lookup for each summary, including later record edits", () => {
  const first = record("equipment", "asset", { name: "First asset" });
  const second = record("equipment", "asset", { name: "Second asset" });
  const records = [first, second];
  const inspection = state("asset", "Serviceable", "2026-11-06");
  const states = [inspection];
  const check = (date: string) => {
    const actual = summarizeDailyOperations({
      organizationId: ORG, records, equipmentStates: states,
    }, "UTC", date);
    const expected = previousEquipmentViews(
      records, states, ORG, date, actual.upcomingThrough,
    );
    checkSameRecords(actual.equipment, expected.equipment);
    checkSameRecords(actual.upcomingEquipmentInspections,
      expected.upcomingEquipmentInspections);
    return actual;
  };
  expect(check("2026-11-05").upcomingEquipmentInspections[0].record).toBe(first);
  first.archived = true;
  expect(check("2026-11-05").upcomingEquipmentInspections[0].record).toBe(second);
  inspection.next_inspection = "2026-11-04";
  expect(check("2026-11-05").equipment[0].record).toBe(second);
  expect(check("2026-11-05").upcomingEquipmentInspections).toEqual([]);
  inspection.condition = "Retired";
  expect(check("2026-11-05").equipment).toEqual([]);
});
