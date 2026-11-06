import { expect, it } from "vitest";
import { summarizeDailyOperations } from "../../src/core/daily-operations";
import { sevenDayWorkload } from "../../src/core/daily-operations-workload";
import type { WorkspaceRecord } from "../../src/core/engine";

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
    { date: "2026-11-06", appointments: 1, unfinishedWork: 2 },
    { date: "2026-11-07", appointments: 0, unfinishedWork: 0 },
    { date: "2026-11-08", appointments: 0, unfinishedWork: 0 },
    { date: "2026-11-09", appointments: 0, unfinishedWork: 0 },
    { date: "2026-11-10", appointments: 0, unfinishedWork: 0 },
    { date: "2026-11-11", appointments: 0, unfinishedWork: 0 },
    { date: "2026-11-12", appointments: 1, unfinishedWork: 1 },
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
    date: "2026-11-01", appointments: 2, unfinishedWork: 0,
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
