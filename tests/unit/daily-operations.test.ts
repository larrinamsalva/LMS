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

it("previews only unfinished work due in the following seven calendar days", () => {
  const records = [
    record("jobs", "today", { title: "Today", date: "2026-11-05", status: "Planned" }),
    record("tasks", "first", { title: "First upcoming", due: "2026-11-06", status: "Open" }),
    record("jobs", "middle", { title: "Middle upcoming", date: "2026-11-09", status: "In progress" }),
    record("tasks", "seventh", { title: "Seventh day", due: "2026-11-12", status: "Open" }),
    record("tasks", "eighth", { title: "Eighth day", due: "2026-11-13", status: "Open" }),
    record("jobs", "overdue", { title: "Overdue", date: "2026-11-04", status: "Planned" }),
    record("jobs", "done", { title: "Completed", date: "2026-11-06", status: "Done" }),
    record("tasks", "cancel", { title: "Cancelled", due: "2026-11-07", status: "Cancelled" }),
    record("tasks", "undated", { title: "Unscheduled", status: "Open" }),
    record("tasks", "archived", { title: "Archived", due: "2026-11-06", status: "Open" }, true),
    record("tasks", "foreign", { title: "Other business", due: "2026-11-06", status: "Open" }, false, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
  ];
  const summary = summarizeDailyOperations(
    { organizationId: org, records, equipmentStates: [] },
    "America/Los_Angeles", "2026-11-05",
  );
  expect(summary.upcomingThrough).toBe("2026-11-12");
  expect(summary.upcoming.map(({ record }) => record.id)).toEqual([
    "first", "middle", "seventh",
  ]);
  expect(summary.dueToday.map(({ record }) => record.id)).toEqual(["today"]);
  expect(summary.overdue.map(({ record }) => record.id)).toEqual(["overdue"]);
});

it("counts calendar dates across leap days and DST without overlapping today", () => {
  const records = [
    record("tasks", "leap", { title: "Leap day work", status: "Open", due: "2028-02-29" }),
    record("tasks", "edge", { title: "Last included", status: "Open", due: "2028-03-04" }),
    record("tasks", "beyond", { title: "Out of range", status: "Open", due: "2028-03-05" }),
  ];
  const summary = summarizeDailyOperations(
    { organizationId: org, records, equipmentStates: [] },
    "America/Los_Angeles", "2028-02-26",
  );
  expect(summary.upcomingThrough).toBe("2028-03-04");
  expect(summary.upcoming.map(({ record }) => record.id)).toEqual(["leap", "edge"]);
  const dst = summarizeDailyOperations(
    { organizationId: org, records: [
      record("tasks", "after-dst", { title: "After DST", due: "2026-11-03", status: "Open" }),
    ], equipmentStates: [] },
    "America/Los_Angeles", "2026-10-31",
  );
  expect(dst.upcomingThrough).toBe("2026-11-07");
  expect(dst.upcoming.map(({ record }) => record.id)).toEqual(["after-dst"]);
});

it("lists future appointments starting on days +1 through +7 in business time, separate from current day", () => {
  const records = [
    record("appointments", "today", {
      title: "Today", status: "Scheduled",
      start: "2026-11-06T06:30:00Z", end: "2026-11-06T08:00:00Z",
    }),
    record("appointments", "first", {
      title: "First future visit", status: "Scheduled",
      start: "2026-11-06T08:00:00Z", end: "2026-11-06T09:00:00Z",
    }),
    record("appointments", "seventh", {
      title: "Last included visit", status: "Scheduled",
      start: "2026-11-13T07:30:00Z", end: "2026-11-13T08:00:00Z",
    }),
    record("appointments", "eighth", {
      title: "Too far", status: "Scheduled",
      start: "2026-11-13T08:00:00Z", end: "2026-11-13T09:00:00Z",
    }),
    record("appointments", "cancelled", {
      title: "Cancelled", status: "Cancelled",
      start: "2026-11-09T18:00:00Z", end: "2026-11-09T19:00:00Z",
    }),
    record("appointments", "archived", {
      title: "Archived", status: "Scheduled",
      start: "2026-11-09T18:00:00Z", end: "2026-11-09T19:00:00Z",
    }, true),
    record("appointments", "foreign", {
      title: "Different business", status: "Scheduled",
      start: "2026-11-09T18:00:00Z", end: "2026-11-09T19:00:00Z",
    }, false, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
  ];
  const result = summarizeDailyOperations(
    { organizationId: org, records, equipmentStates: [] },
    "America/Los_Angeles", "2026-11-05",
  );
  expect(result.upcomingThrough).toBe("2026-11-12");
  expect(result.upcomingAppointments.map((r) => r.id)).toEqual(["first", "seventh"]);
  expect(result.appointments.map((r) => r.id)).toEqual(["today"]);
});

it("handles spring-forward next-week appointment starts using local day boundaries", () => {
  const records = [
    record("appointments", "before", {
      title: "Selected-day booking", status: "Scheduled",
      start: "2026-03-08T07:30:00Z", end: "2026-03-08T08:30:00Z",
    }),
    record("appointments", "spring", {
      title: "Morning after spring-forward", status: "Scheduled",
      start: "2026-03-08T10:15:00Z", end: "2026-03-08T11:15:00Z",
    }),
    record("appointments", "seventh", {
      title: "Last day", status: "Scheduled",
      start: "2026-03-15T06:00:00Z", end: "2026-03-15T07:00:00Z",
    }),
    record("appointments", "too-late", {
      title: "Beyond seventh day", status: "Scheduled",
      start: "2026-03-15T07:00:00Z", end: "2026-03-15T08:00:00Z",
    }),
  ];
  const result = summarizeDailyOperations(
    { organizationId: org, records, equipmentStates: [] },
    "America/Los_Angeles", "2026-03-07",
  );
  expect(result.upcomingAppointments.map((r) => r.id)).toEqual(["spring", "seventh"]);
});
 
it("surfaces date-free active tasks without assigning deadlines or mixing them into dated views", () => {
  const records = [
    record("tasks", "zulu", { title: "Zulu task", status: "Open" }),
    record("tasks", "alpha", { title: "Alpha task", status: "In progress", due: "" }),
    record("tasks", "spaces", { title: "Spaces task", status: "Open", due: "   " }),
    record("jobs", "legacy", { title: "Legacy job", status: "Planned" }),
    record("tasks", "dated", { title: "Dated task", due: "2026-11-06", status: "Open" }),
    record("tasks", "finished", { title: "Finished task", status: "Done" }),
    record("tasks", "cancelled", { title: "Cancelled task", status: "Cancelled" }),
    record("tasks", "archived", { title: "Archived task", status: "Open" }, true),
    record("tasks", "foreign", { title: "Foreign task", status: "Open" }, false,
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
  ];
  const snap = { organizationId: org, records, equipmentStates: [] };
  const result = summarizeDailyOperations(snap, "America/Los_Angeles", "2026-11-05");
  expect(result.needsScheduling.map((r) => r.id))
    .toEqual(["alpha", "legacy", "spaces", "zulu"]);
  expect(result.dueToday).toEqual([]);
  expect(result.overdue).toEqual([]);
  expect(result.upcoming.map(({ record }) => record.id)).toEqual(["dated"]);
  const later = summarizeDailyOperations(snap, "America/Los_Angeles", "2026-11-07");
  expect(later.needsScheduling.map((r) => r.id))
    .toEqual(["alpha", "legacy", "spaces", "zulu"]);
  expect(later.overdue.map(({ record }) => record.id)).toEqual(["dated"]);
});
