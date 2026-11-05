import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import type { EquipmentState } from "../../src/core/equipment";
import { summarizeDailyOperations } from "../../src/core/daily-operations";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function record(
  entity: string, id: string, data: WorkspaceRecord["data"],
  archived = false, organization_id = org,
): WorkspaceRecord {
  return {
    id, organization_id, entity, data, archived,
    revision: 1, config_revision: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}
function equipmentState(
  record_id: string, condition: EquipmentState["condition"],
  next_inspection: string | null, organization_id = org,
): EquipmentState {
  return {
    organization_id, record_id, revision: 1,
    asset_key: record_id, barcode_key: null,
    condition, maintenance: "Clear",
    work_id: null, technician_id: null,
    last_service: null, next_inspection,
  };
}
it("uses business-local day overlap even on DST changes, without leaking other organizations", () => {
  const appointments = [
    record("appointments", "night", {
      title: "Overnight work", start: "2026-11-02T06:30:00Z",
      end: "2026-11-02T09:30:00Z", status: "Scheduled",
    }),
    record("appointments", "before", {
      title: "Daytime work", start: "2026-11-01T08:00:00Z",
      end: "2026-11-01T09:00:00Z", status: "Completed",
    }),
    record("appointments", "cancelled", {
      title: "Cancelled", start: "2026-11-02T08:00:00Z",
      end: "2026-11-02T09:00:00Z", status: "Cancelled",
    }),
    record("appointments", "archived", {
      title: "Archived", start: "2026-11-02T08:00:00Z",
      end: "2026-11-02T09:00:00Z", status: "Scheduled",
    }, true),
    record("appointments", "foreign", {
      title: "Other business", start: "2026-11-02T08:00:00Z",
      end: "2026-11-02T09:00:00Z", status: "Scheduled",
    }, false, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
  ];
  const input = { organizationId: org, records: appointments, equipmentStates: [] };
  expect(summarizeDailyOperations(input, "America/Los_Angeles", "2026-11-01")
    .appointments.map((r) => r.id)).toEqual(["before", "night"]);
  expect(summarizeDailyOperations(input, "America/Los_Angeles", "2026-11-02")
    .appointments.map((r) => r.id)).toEqual(["night"]);
});
it("separates due from overdue unfinished jobs and tasks without inventing deadlines", () => {
  const records = [
    record("tasks", "today", { title: "Fix sink", status: "Open", due: "2026-11-05" }),
    record("jobs", "older", { title: "Deep clean", status: "Planned", date: "2026-11-04" }),
    record("tasks", "done", { title: "Done task", status: "Done", due: "2026-11-04" }),
    record("tasks", "undated", { title: "Optional deadline", status: "Open" }),
    record("jobs", "foreign", { title: "Other business", status: "Planned", date: "2026-11-05" }, false, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
  ];
  const summary = summarizeDailyOperations(
    { organizationId: org, records, equipmentStates: [] },
    "America/Los_Angeles", "2026-11-05",
  );
  expect(summary.dueToday.map((x) => x.record.id)).toEqual(["today"]);
  expect(summary.overdue.map((x) => x.record.id)).toEqual(["older"]);
  expect(summary.appointments).toEqual([]);
});
it("reports condition/inspection warnings, not retired, archived or foreign equipment", () => {
  const records = ["due", "repair", "safe", "retired", "archived"].map((id) =>
    record("equipment", id, { name: id }, id === "archived"),
  );
  records.push(record("equipment", "foreign", { name: "foreign" }, false, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"));
  const states = [
    equipmentState("due", "Serviceable", "2026-11-05"),
    equipmentState("repair", "Under maintenance", null),
    equipmentState("safe", "Serviceable", "2026-11-07"),
    equipmentState("retired", "Retired", null),
    equipmentState("archived", "Needs inspection", null),
    equipmentState("foreign", "Under maintenance", null, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
  ];
  const summary = summarizeDailyOperations(
    { organizationId: org, records, equipmentStates: states },
    "America/Los_Angeles", "2026-11-05",
  );
  expect(summary.equipment.map((x) => [x.record.id, x.reason]))
    .toEqual([["due", "Inspection due"], ["repair", "Under maintenance"]]);
});

it("keeps equally named equipment warnings separate by saved asset ID", () => {
  const equipment = [
    record("equipment", "asset-1", { name: "Fictional scrubber" }),
    record("equipment", "asset-2", { name: "Fictional scrubber" }),
    record("equipment", "foreign", { name: "Fictional scrubber" }, false,
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
  ];
  const states = [
    equipmentState("asset-1", "Needs inspection", null),
    equipmentState("asset-2", "Needs inspection", null),
    equipmentState("foreign", "Needs inspection", null,
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
  ];
  const summary = summarizeDailyOperations(
    { organizationId: org, records: equipment, equipmentStates: states },
    "America/Los_Angeles", "2026-11-05",
  );
  expect(summary.equipment.map((item) => item.record.id)).toEqual(["asset-1", "asset-2"]);
});

it("keeps similarly titled appointments distinct by ID and excludes foreign, archived and cancelled ones", () => {
  const records = [
    record("appointments", "first", {
      title: "Fictional morning visit", start: "2026-11-06T17:00:00Z",
      end: "2026-11-06T18:00:00Z", status: "Scheduled",
    }),
    record("appointments", "second", {
      title: "Fictional morning visit", start: "2026-11-06T19:00:00Z",
      end: "2026-11-06T20:00:00Z", status: "Scheduled",
    }),
    record("appointments", "cancelled", {
      title: "Fictional morning visit", start: "2026-11-06T20:00:00Z",
      end: "2026-11-06T21:00:00Z", status: "Cancelled",
    }),
    record("appointments", "archived", {
      title: "Fictional morning visit", start: "2026-11-06T21:00:00Z",
      end: "2026-11-06T22:00:00Z", status: "Scheduled",
    }, true),
    record("appointments", "foreign", {
      title: "Fictional morning visit", start: "2026-11-06T22:00:00Z",
      end: "2026-11-06T23:00:00Z", status: "Scheduled",
    }, false, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
  ];
  const overview = summarizeDailyOperations({
    organizationId: org, records, equipmentStates: [],
  }, "America/Los_Angeles", "2026-11-06");
  expect(overview.appointments.map((record) => record.id)).toEqual(["first", "second"]);
});
