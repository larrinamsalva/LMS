import { expect, it } from "vitest";
import { summarizeDailyOperations } from "../../src/core/daily-operations";
import { sevenDayWorkload, summarizeSevenDayWorkload, visibleWorkloadDays } from "../../src/core/daily-operations-workload";
import type { WorkspaceRecord } from "../../src/core/engine";
import type { EquipmentState } from "../../src/core/equipment";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const foreign = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
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

it("groups the entire seven-day queue by business-local date, including empty days", () => {
  const records = [
    record("appointments", "first", {
      title: "Fictional visit", status: "Scheduled",
      start: "2026-11-06T18:30:00Z", end: "2026-11-06T19:30:00Z",
    }),
    record("appointments", "last", {
      title: "Last-day inspection", status: "Scheduled",
      start: "2026-11-13T07:30:00Z", end: "2026-11-13T08:00:00Z",
    }),
    record("appointments", "eighth", {
      title: "Beyond range", status: "Scheduled",
      start: "2026-11-13T08:00:00Z", end: "2026-11-13T09:00:00Z",
    }),
    record("appointments", "cancelled", {
      title: "Cancelled", status: "Cancelled",
      start: "2026-11-09T18:30:00Z", end: "2026-11-09T19:30:00Z",
    }),
    record("appointments", "other", {
      title: "Foreign", status: "Scheduled",
      start: "2026-11-09T18:30:00Z", end: "2026-11-09T19:30:00Z",
    }, foreign),
    record("jobs", "job", { title: "Deep clean", date: "2026-11-06", status: "Planned" }),
    record("tasks", "task", { title: "Repair sink", due: "2026-11-06", status: "Open" }),
    record("tasks", "late", { title: "Last day", due: "2026-11-12", status: "Open" }),
    record("tasks", "undated", { title: "No date", status: "Open" }),
    record("jobs", "completed", { title: "Finished", date: "2026-11-06", status: "Done" }),
    record("jobs", "archived", { title: "Archived", date: "2026-11-06", status: "Planned" }, org, true),
    record("tasks", "foreign-work", { title: "Other business", due: "2026-11-06", status: "Open" }, foreign),
    record("tasks", "overdue", { title: "Prior day", due: "2026-11-04", status: "Open" }),
  ];
  const overview = summarizeDailyOperations(
    { organizationId: org, records, equipmentStates: [] },
    "America/Los_Angeles", "2026-11-05",
  );
  expect(sevenDayWorkload(overview, "America/Los_Angeles")).toEqual([
    { date: "2026-11-06", appointments: 1, unfinishedWork: 2, inspections: 0 },
    { date: "2026-11-07", appointments: 0, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-08", appointments: 0, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-09", appointments: 0, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-10", appointments: 0, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-11", appointments: 0, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-12", appointments: 1, unfinishedWork: 1, inspections: 0 },
  ]);
  expect(overview.needsScheduling).toHaveLength(1);
});

it("keeps two repeated local clock-hour bookings on the same DST day", () => {
  const records = [
    record("appointments", "first", {
      title: "First 1:30", status: "Scheduled",
      start: "2026-11-01T08:30:00Z", end: "2026-11-01T09:00:00Z",
    }),
    record("appointments", "second", {
      title: "Second 1:30", status: "Scheduled",
      start: "2026-11-01T09:30:00Z", end: "2026-11-01T10:00:00Z",
    }),
  ];
  const overview = summarizeDailyOperations(
    { organizationId: org, records, equipmentStates: [] },
    "America/Los_Angeles", "2026-10-31",
  );
  const days = sevenDayWorkload(overview, "America/Los_Angeles");
  expect(days).toHaveLength(7);
  expect(days[0]).toEqual({
    date: "2026-11-01", appointments: 2, unfinishedWork: 0, inspections: 0,
  });
});

it("advances across leap day as calendar dates without inventing activity", () => {
  const overview = summarizeDailyOperations(
    { organizationId: org, records: [], equipmentStates: [] },
    "America/Los_Angeles", "2028-02-26",
  );
  const days = sevenDayWorkload(overview, "America/Los_Angeles");
  expect(days.map((d) => d.date)).toEqual([
    "2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01",
    "2028-03-02", "2028-03-03", "2028-03-04",
  ]);
  expect(days.every((d) => d.appointments === 0 && d.unfinishedWork === 0)).toBe(true);
});

function equipment(
  record_id: string, condition: EquipmentState["condition"],
  next_inspection: string | null, organization_id = org,
): EquipmentState {
  return {
    organization_id, record_id, revision: 1,
    asset_key: record_id, barcode_key: null,
    condition, maintenance: "Clear",
    work_id: null, technician_id: null, last_service: null, next_inspection,
  };
}

it("adds inspection counts to the correct dates without counting unsafe, archived or foreign assets", () => {
  const records = [
    record("equipment", "first", { name: "Floor scrubber" }),
    record("equipment", "second", { name: "Carpet extractor" }),
    record("equipment", "last", { name: "Final day tool" }),
    record("equipment", "today", { name: "Inspection due today" }),
    record("equipment", "overdue", { name: "Overdue asset" }),
    record("equipment", "outside", { name: "Eighth-day equipment" }),
    record("equipment", "broken", { name: "Out of service tool" }),
    record("equipment", "retired", { name: "Retired tool" }),
    record("equipment", "archived", { name: "Archived tool" }, org, true),
    record("equipment", "foreign", { name: "Other business tool" }, foreign),
  ];
  const equipmentStates = [
    equipment("first", "Serviceable", "2026-11-06"),
    equipment("second", "Serviceable", "2026-11-06"),
    equipment("last", "Serviceable", "2026-11-12"),
    equipment("today", "Serviceable", "2026-11-05"),
    equipment("overdue", "Serviceable", "2026-11-04"),
    equipment("outside", "Serviceable", "2026-11-13"),
    equipment("broken", "Out of service", "2026-11-06"),
    equipment("retired", "Retired", "2026-11-06"),
    equipment("archived", "Serviceable", "2026-11-06"),
    equipment("foreign", "Serviceable", "2026-11-06", foreign),
  ];
  const source = { organizationId: org, records, equipmentStates };
  const summary = summarizeDailyOperations(source, "America/Los_Angeles", "2026-11-05");
  const days = sevenDayWorkload(summary, "America/Los_Angeles");
  expect(days).toHaveLength(7);
  expect(days.map(({ inspections }) => inspections)).toEqual([2, 0, 0, 0, 0, 0, 1]);
  expect(days[0]).toEqual({
    date: "2026-11-06", appointments: 0, unfinishedWork: 0, inspections: 2,
  });
  // A date becoming "today" moves its inspection out of the future queue,
  // but does not write back to the saved equipment record.
  const next = sevenDayWorkload(
    summarizeDailyOperations(source, "America/Los_Angeles", "2026-11-06"),
    "America/Los_Angeles",
  );
  expect(next[0].inspections).toBe(0);
  expect(next[6].inspections).toBe(1); // Nov 13 enters the seven-day window.
});

it("counts a saved leap-day inspection on February 29", () => {
  const summary = summarizeDailyOperations({
    organizationId: org,
    records: [record("equipment", "leap", { name: "Leap day inspection" })],
    equipmentStates: [equipment("leap", "Serviceable", "2028-02-29")],
  }, "America/Los_Angeles", "2028-02-26");
  const days = sevenDayWorkload(summary, "America/Los_Angeles");
  expect(days.find(({ date }) => date === "2028-02-29")?.inspections).toBe(1);
});

it("rolls up a week of saved activity without treating individual bookings as capacity", () => {
  const days = [
    { date: "2026-11-06", appointments: 2, unfinishedWork: 3, inspections: 0 },
    { date: "2026-11-07", appointments: 0, unfinishedWork: 0, inspections: 2 },
    { date: "2026-11-08", appointments: 1, unfinishedWork: 0, inspections: 1 },
    { date: "2026-11-09", appointments: 0, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-10", appointments: 0, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-11", appointments: 0, unfinishedWork: 1, inspections: 0 },
    { date: "2026-11-12", appointments: 0, unfinishedWork: 0, inspections: 0 },
  ];
  expect(summarizeSevenDayWorkload(days, true)).toEqual({
    appointments: 3, unfinishedWork: 4, inspections: 3,
    daysWithActivity: 4, daysInWindow: 7,
  });
  // Disabled Equipment & Tools must neither expose inspections nor turn
  // equipment-only days into "days with activity".
  expect(summarizeSevenDayWorkload(days, false)).toEqual({
    appointments: 3, unfinishedWork: 4, inspections: 0,
    daysWithActivity: 3, daysInWindow: 7,
  });
  expect(days[1].inspections).toBe(2); // No mutation of the source dates.
});

it("shows zero work and zero active days when the business has no dated items", () => {
  const overview = summarizeDailyOperations(
    { organizationId: org, records: [], equipmentStates: [] },
    "America/Los_Angeles", "2028-02-26",
  );
  const result = summarizeSevenDayWorkload(
    sevenDayWorkload(overview, "America/Los_Angeles"), true,
  );
  expect(result).toEqual({
    appointments: 0, unfinishedWork: 0, inspections: 0,
    daysWithActivity: 0, daysInWindow: 7,
  });
});

it("filters only dated activity while preserving seven-day totals and original order", () => {
  const days = [
    { date: "2026-11-06", appointments: 0, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-07", appointments: 0, unfinishedWork: 0, inspections: 2 },
    { date: "2026-11-08", appointments: 1, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-09", appointments: 0, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-10", appointments: 0, unfinishedWork: 3, inspections: 0 },
    { date: "2026-11-11", appointments: 0, unfinishedWork: 0, inspections: 1 },
    { date: "2026-11-12", appointments: 0, unfinishedWork: 0, inspections: 0 },
  ];
  const whole = visibleWorkloadDays(days, true, false);
  expect(whole).toEqual(days);
  expect(whole).not.toBe(days);
  const enabled = visibleWorkloadDays(days, true, true);
  expect(enabled.map((day) => day.date)).toEqual([
    "2026-11-07", "2026-11-08", "2026-11-10", "2026-11-11",
  ]);
  const disabled = visibleWorkloadDays(days, false, true);
  expect(disabled.map((day) => day.date)).toEqual([
    "2026-11-08", "2026-11-10",
  ]);
  expect(enabled.length).toBe(summarizeSevenDayWorkload(days, true).daysWithActivity);
  expect(disabled.length).toBe(summarizeSevenDayWorkload(days, false).daysWithActivity);
  expect(days[1].inspections).toBe(2); // no changes to source records
});

it("has a reversible empty active-day view and includes leap/DST calendar days", () => {
  const leap = summarizeDailyOperations(
    { organizationId: org, records: [], equipmentStates: [] },
    "America/Los_Angeles", "2028-02-26",
  );
  const dates = sevenDayWorkload(leap, "America/Los_Angeles");
  expect(visibleWorkloadDays(dates, true, true)).toEqual([]);
  expect(visibleWorkloadDays(dates, true, false)).toHaveLength(7);
  expect(dates.some(({ date }) => date === "2028-02-29")).toBe(true);
  const fall = summarizeDailyOperations(
    { organizationId: org, records: [], equipmentStates: [] },
    "America/Los_Angeles", "2026-10-31",
  );
  expect(visibleWorkloadDays(
    sevenDayWorkload(fall, "America/Los_Angeles"), false, false,
  )).toHaveLength(7);
});
