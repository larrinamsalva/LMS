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
    id, entity, data, organization_id, archived,
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

// Independently preserved #180 equipment implementation: one authorized
// record lookup, one authorized state subset, but TWO separate flatMap
// passes followed by their original independent presentation sorts.
function previousEquipmentViews(
  allRecords: readonly WorkspaceRecord[],
  allStates: readonly EquipmentState[],
  org: string, date: string, upcomingThrough: string,
): {
  equipment: EquipmentAttention[];
  upcomingEquipmentInspections: UpcomingEquipmentInspection[];
} {
  const authorizedRecords = allRecords.filter(
    (item) => item.organization_id === org && !item.archived,
  );
  const equipmentById = new Map<string, WorkspaceRecord>();
  for (const item of authorizedRecords) {
    if (item.entity === "equipment" && !equipmentById.has(item.id)) {
      equipmentById.set(item.id, item);
    }
  }
  const authorizedStates = allStates.filter(
    (item) => item.organization_id === org,
  );
  const equipment = authorizedStates
    .flatMap((item): EquipmentAttention[] => {
      const match = equipmentById.get(item.record_id);
      if (!match || item.condition === "Retired") return [];
      const reason = item.condition !== "Serviceable"
        ? item.condition
        : item.next_inspection &&
          String(item.next_inspection).slice(0, 10) <= date
          ? "Inspection due" : "";
      return reason ? [{ record: match, reason }] : [];
    })
    .sort((a, b) =>
      String(a.record.data.name).localeCompare(String(b.record.data.name)),
    );
  const upcomingEquipmentInspections = authorizedStates
    .flatMap((item): UpcomingEquipmentInspection[] => {
      const match = equipmentById.get(item.record_id);
      if (!match || item.condition !== "Serviceable" ||
          !item.next_inspection) return [];
      const due = String(item.next_inspection).slice(0, 10);
      return due > date && due <= upcomingThrough
        ? [{ record: match, due }] : [];
    })
    .sort((a, b) =>
      a.due.localeCompare(b.due) ||
      String(a.record.data.name).localeCompare(String(b.record.data.name)) ||
      a.record.id.localeCompare(b.record.id),
    );
  return { equipment, upcomingEquipmentInspections };
}

function assertRows<T extends { record: WorkspaceRecord }>(
  actual: readonly T[], expected: readonly T[],
) {
  expect(actual).toHaveLength(expected.length);
  expect(actual).toEqual(expected);
  actual.forEach((row, index) => {
    expect(row.record).toBe(expected[index].record);
  });
}

it("preserves both equipment panels over 720 fictional states and five dates", () => {
  const conditions: EquipmentState["condition"][] = [
    "Serviceable", "Needs inspection", "Under maintenance",
    "Out of service", "Retired",
  ];
  const dates: Array<string | null> = [
    "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-12",
    "2026-11-13", "2026-03-08", "2028-02-29", null,
  ];
  const names = [
    "Fictional Scrubber", "Fictional Scrubber",
    "Carpet Extractor", "Floor Buffer", "İstanbul Service Tool",
  ];
  const records: WorkspaceRecord[] = Array.from({ length: 240 }, (_, i) =>
    record("equipment", "asset-" + i, {
      name: names[i % names.length], asset_id: "asset-number-" + i,
      notes: "PRIVATE ASSET NOTES",
    }, i % 31 === 0 ? FOREIGN : ORG, i % 23 === 0),
  );
  records.push(
    record("equipment", "asset-7", { name: "Later duplicate ignored" }),
    record("equipment", "asset-7", { name: "FOREIGN PRIVATE NAME" }, FOREIGN),
    record("tasks", "asset-7", { title: "Not equipment" }),
    record("equipment", "asset-4", { name: "Archived equipment" }, ORG, true),
  );
  const states: EquipmentState[] = Array.from({ length: 720 }, (_, i) =>
    state("asset-" + (i % 253), conditions[i % conditions.length],
      dates[i % dates.length], i % 17 === 0 ? FOREIGN : ORG),
  );
  const same = state("asset-7", "Serviceable", "2026-11-06");
  states.push(
    same, same,
    state("asset-7", "Needs inspection", null),
    state("asset-7", "Retired", "2026-11-06"),
    state("asset-7", "Serviceable", "2026-11-06", FOREIGN),
  );
  const before = structuredClone({ records, states });
  for (const zone of ["UTC", "America/Los_Angeles", "America/New_York"]) {
    for (const date of [
      "2026-11-04", "2026-11-05", "2026-11-06",
      "2026-03-07", "2028-02-26",
    ]) {
      const overview = summarizeDailyOperations(
        { organizationId: ORG, records, equipmentStates: states }, zone, date,
      );
      const previous = previousEquipmentViews(
        records, states, ORG, date, overview.upcomingThrough,
      );
      assertRows(overview.equipment, previous.equipment);
      assertRows(
        overview.upcomingEquipmentInspections,
        previous.upcomingEquipmentInspections,
      );
      for (const row of [
        ...overview.equipment, ...overview.upcomingEquipmentInspections,
      ]) {
        expect(row.record.organization_id).toBe(ORG);
        expect(row.record.archived).toBe(false);
        expect(row.record.entity).toBe("equipment");
      }
    }
  }
  expect({ records, states }).toEqual(before);
});

it("retains exact warning reasons, date boundaries and duplicate occurrences", () => {
  const first = record("equipment", "same", { name: "Same asset" });
  const later = record("equipment", "same", { name: "Later ignored" });
  const foreign = record("equipment", "same", { name: "FOREIGN ASSET" }, FOREIGN);
  const records = [foreign, first, later];
  const alert = state("same", "Needs inspection", null);
  const states = [
    alert, alert,
    state("same", "Serviceable", "2026-11-05"),
    state("same", "Serviceable", "2026-11-06"),
    state("same", "Serviceable", "2026-11-12"),
    state("same", "Serviceable", "2026-11-13"),
    state("same", "Retired", "2026-11-06"),
    state("same", "Serviceable", "2026-11-06", FOREIGN),
  ];
  const overview = summarizeDailyOperations(
    { organizationId: ORG, records, equipmentStates: states },
    "UTC", "2026-11-05",
  );
  const previous = previousEquipmentViews(
    records, states, ORG, "2026-11-05", overview.upcomingThrough,
  );
  assertRows(overview.equipment, previous.equipment);
  assertRows(
    overview.upcomingEquipmentInspections,
    previous.upcomingEquipmentInspections,
  );
  expect(overview.equipment.map((row) => row.reason)).toEqual([
    "Needs inspection", "Needs inspection", "Inspection due",
  ]);
  expect(overview.upcomingEquipmentInspections.map((row) => row.due))
    .toEqual(["2026-11-06", "2026-11-12"]);
  expect(overview.equipment.every((row) => row.record === first)).toBe(true);
});

it("reclassifies fresh summaries after condition, date and organization edits", () => {
  const local = record("equipment", "asset", { name: "Local tool" });
  const foreign = record("equipment", "asset", { name: "Foreign tool" }, FOREIGN);
  const localState = state("asset", "Serviceable", "2026-11-06");
  const foreignState = state("asset", "Under maintenance", null, FOREIGN);
  const records = [local, foreign];
  const states = [localState, foreignState];
  const verify = (organizationId: string) => {
    const overview = summarizeDailyOperations({
      organizationId, records, equipmentStates: states,
    }, "America/Los_Angeles", "2026-11-05");
    const previous = previousEquipmentViews(
      records, states, organizationId, "2026-11-05",
      overview.upcomingThrough,
    );
    assertRows(overview.equipment, previous.equipment);
    assertRows(
      overview.upcomingEquipmentInspections,
      previous.upcomingEquipmentInspections,
    );
    return overview;
  };
  expect(verify(ORG).upcomingEquipmentInspections).toHaveLength(1);
  expect(verify(FOREIGN).equipment).toHaveLength(1);
  localState.condition = "Needs inspection";
  expect(verify(ORG).equipment).toHaveLength(1);
  expect(verify(ORG).upcomingEquipmentInspections).toEqual([]);
  localState.condition = "Serviceable";
  localState.next_inspection = "2026-11-04";
  expect(verify(ORG).equipment[0].reason).toBe("Inspection due");
  expect(verify(ORG).upcomingEquipmentInspections).toEqual([]);
  foreignState.organization_id = ORG;
  expect(verify(FOREIGN).equipment).toEqual([]);
  expect(verify(ORG).equipment).toHaveLength(2);
});
