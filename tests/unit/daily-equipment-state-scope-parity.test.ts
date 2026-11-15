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
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
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

// Independent reference copied from merged, five-green LMS #176:
// build the equipment lookup once, then filter *all equipment states*
// separately for each view. #177 must preserve both ordered row arrays.
function previousEquipmentViews(
  allRecords: readonly WorkspaceRecord[],
  states: readonly EquipmentState[],
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
  const equipmentById = new Map<string, WorkspaceRecord>();
  for (const item of records) {
    if (item.entity === "equipment" && !equipmentById.has(item.id)) {
      equipmentById.set(item.id, item);
    }
  }
  const equipment = states
    .filter((item) => item.organization_id === organizationId)
    .flatMap((item): EquipmentAttention[] => {
      const found = equipmentById.get(item.record_id);
      if (!found || item.condition === "Retired") return [];
      const reason = item.condition !== "Serviceable"
        ? item.condition
        : item.next_inspection &&
            String(item.next_inspection).slice(0, 10) <= date
          ? "Inspection due" : "";
      return reason ? [{ record: found, reason }] : [];
    })
    .sort((a, b) =>
      String(a.record.data.name).localeCompare(String(b.record.data.name)),
    );
  const upcomingEquipmentInspections = states
    .filter((item) => item.organization_id === organizationId)
    .flatMap((item): UpcomingEquipmentInspection[] => {
      const found = equipmentById.get(item.record_id);
      if (!found || item.condition !== "Serviceable" ||
          !item.next_inspection) return [];
      const due = String(item.next_inspection).slice(0, 10);
      return due > date && due <= upcomingThrough
        ? [{ record: found, due }] : [];
    })
    .sort((a, b) =>
      a.due.localeCompare(b.due) ||
      String(a.record.data.name).localeCompare(String(b.record.data.name)) ||
      a.record.id.localeCompare(b.record.id),
    );
  return { equipment, upcomingEquipmentInspections };
}

function assertSameRows<T extends { record: WorkspaceRecord }>(
  actual: readonly T[], expected: readonly T[],
): void {
  expect(actual).toHaveLength(expected.length);
  expect(actual).toEqual(expected);
  actual.forEach((item, i) => expect(item.record).toBe(expected[i].record));
}

it("keeps both equipment views identical for 720 fictional equipment states", () => {
  const conditions: EquipmentState["condition"][] = [
    "Serviceable", "Needs inspection", "Under maintenance",
    "Out of service", "Retired",
  ];
  const dates: Array<string | null> = [
    "2026-11-01", "2026-11-05", "2026-11-06",
    "2026-11-12", "2026-11-13", "2026-03-08",
    "2028-02-29", null,
  ];
  const names = [
    "Blue Scrubber", "Blue Scrubber", "Floor Buffer",
    "Night Extractor", "İSTANBUL Equipment", "MÜNCHEN Crew",
  ];
  const records: WorkspaceRecord[] = Array.from(
    { length: 240 }, (_, i) =>
      record("equipment", "asset-" + i, {
        name: names[i % names.length],
        asset_id: "fictional-" + i,
        notes: "PRIVATE EQUIPMENT NOTES",
      }, i % 31 === 0 ? FOREIGN : ORG, i % 23 === 0),
  );
  records.push(
    record("equipment", "asset-7", { name: "Duplicate name ignored" }),
    record("equipment", "asset-7", { name: "FOREIGN PRIVATE NAME" }, FOREIGN),
    record("tasks", "asset-7", { name: "Unrelated task" }),
    record("equipment", "asset-4", { name: "Archived duplicate" }, ORG, true),
  );
  const states: EquipmentState[] = Array.from(
    { length: 720 }, (_, i) => state(
      "asset-" + (i % 251),
      conditions[i % conditions.length],
      dates[i % dates.length],
      i % 17 === 0 ? FOREIGN : ORG,
    ),
  );
  const same = state("asset-7", "Serviceable", "2026-11-06");
  states.push(same, same,
    state("asset-7", "Needs inspection", null),
    state("asset-7", "Retired", "2026-11-06"),
    state("asset-7", "Serviceable", "2026-11-06", FOREIGN),
  );
  const original = structuredClone({ records, states });
  for (const zone of ["UTC", "America/Los_Angeles", "America/New_York"]) {
    for (const date of [
      "2026-11-01", "2026-11-05", "2026-11-06",
      "2026-03-07", "2028-02-26",
    ]) {
      const overview = summarizeDailyOperations({
        organizationId: ORG, records, equipmentStates: states,
      }, zone, date);
      const previous = previousEquipmentViews(
        records, states, ORG, date, overview.upcomingThrough,
      );
      assertSameRows(overview.equipment, previous.equipment);
      assertSameRows(
        overview.upcomingEquipmentInspections,
        previous.upcomingEquipmentInspections,
      );
      for (const row of [
        ...overview.equipment, ...overview.upcomingEquipmentInspections,
      ]) {
        expect(row.record.organization_id).toBe(ORG);
        expect(row.record.archived).toBe(false);
      }
    }
  }
  expect({ records, states }).toEqual(original);
});

it("keeps duplicate state occurrences and first matching equipment record", () => {
  const first = record("equipment", "duplicate", { name: "First asset" });
  const second = record("equipment", "duplicate", { name: "Second asset" });
  const foreign = record("equipment", "duplicate", {
    name: "FOREIGN PRIVATE ASSET",
  }, FOREIGN);
  const retired = state("duplicate", "Retired", "2026-11-06");
  const alert = state("duplicate", "Needs inspection", null);
  const upcoming = state("duplicate", "Serviceable", "2026-11-06");
  const records = [foreign, first, second];
  const states = [
    retired, alert, alert, upcoming,
    state("duplicate", "Needs inspection", null, FOREIGN),
  ];
  const overview = summarizeDailyOperations({
    organizationId: ORG, records, equipmentStates: states,
  }, "UTC", "2026-11-05");
  const previous = previousEquipmentViews(
    records, states, ORG, "2026-11-05", overview.upcomingThrough,
  );
  assertSameRows(overview.equipment, previous.equipment);
  assertSameRows(overview.upcomingEquipmentInspections,
    previous.upcomingEquipmentInspections);
  expect(overview.equipment).toHaveLength(2);
  expect(overview.equipment[0].record).toBe(first);
  expect(overview.equipment[1].record).toBe(first);
  expect(overview.upcomingEquipmentInspections[0].record).toBe(first);
});

it("rebuilds scoped states per summary after edits or organization changes", () => {
  const local = record("equipment", "asset", { name: "Local asset" });
  const foreign = record("equipment", "asset", { name: "Foreign asset" }, FOREIGN);
  const localState = state("asset", "Serviceable", "2026-11-06");
  const foreignState = state("asset", "Under maintenance", null, FOREIGN);
  const records = [local, foreign];
  const states = [localState, foreignState];
  const verify = (organizationId: string) => {
    const overview = summarizeDailyOperations({
      organizationId, records, equipmentStates: states,
    }, "UTC", "2026-11-05");
    const previous = previousEquipmentViews(
      records, states, organizationId, "2026-11-05",
      overview.upcomingThrough,
    );
    assertSameRows(overview.equipment, previous.equipment);
    assertSameRows(overview.upcomingEquipmentInspections,
      previous.upcomingEquipmentInspections);
    return overview;
  };
  expect(verify(ORG).upcomingEquipmentInspections).toHaveLength(1);
  expect(verify(FOREIGN).equipment).toHaveLength(1);
  localState.condition = "Needs inspection";
  expect(verify(ORG).equipment).toHaveLength(1);
  expect(verify(ORG).upcomingEquipmentInspections).toEqual([]);
  foreignState.organization_id = ORG;
  expect(verify(FOREIGN).equipment).toEqual([]);
  expect(verify(ORG).equipment).toHaveLength(2);
});
