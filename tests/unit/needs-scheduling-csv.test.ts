import { expect, it } from "vitest";
import { needsSchedulingCsv } from "../../src/core/needs-scheduling-csv";
import { summarizeDailyOperations } from "../../src/core/daily-operations";
import type { WorkspaceRecord } from "../../src/core/engine";

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

it("exports all five undated records, sorted, without assigning any deadlines", () => {
  const records = [
    record("tasks", "z", { title: "Zulu task", status: "Open" }),
    record("tasks", "a", { title: "Alpha, urgent", status: "In progress", due: "" }),
    record("tasks", "d", { title: "Delta task", status: "Open", due: "   " }),
    record("jobs", "l", { title: "Legacy cleanup", status: "Planned" }),
    record("tasks", "formula", {
      title: "=HYPERLINK(\"bad\")", status: "Open", due: null,
    }),
    record("tasks", "scheduled", { title: "Dated task", status: "Open", due: "2026-11-07" }),
    record("jobs", "done", { title: "Finished job", status: "Done" }),
    record("tasks", "cancel", { title: "Cancelled", status: "Cancelled" }),
    record("tasks", "archived", { title: "Archived", status: "Open" }, org, true),
    record("tasks", "foreign", { title: "Other business", status: "Open" }, other),
  ];
  const snapshot = { organizationId: org, records, equipmentStates: [] };
  const overview = summarizeDailyOperations(snapshot, "America/Los_Angeles", "2026-11-06");
  const csv = needsSchedulingCsv(overview, "America/Los_Angeles");
  const lines = csv.trimEnd().split("\r\n");
  expect(lines).toHaveLength(6); // Header + five, not truncated to four UI rows.
  expect(csv).toContain('"Reviewed on (not due date)"');
  expect(csv).toContain('"2026-11-06","Task","Alpha, urgent","In progress","","America/Los_Angeles"');
  expect(csv).toContain('"Cleaning job","Legacy cleanup","Planned","","America/Los_Angeles"');
  expect(csv).toContain('"\'=HYPERLINK(""bad"")"'); // Spreadsheet formula neutralized.
  expect(lines[1]).toContain("Alpha, urgent");
  for (const omitted of ["Dated task", "Finished job", "Cancelled",
    "Archived", "Other business"]) expect(csv).not.toContain('"' + omitted + '"');
  // Changing the review date does not convert unassigned work into due work.
  const later = summarizeDailyOperations(snapshot, "America/Los_Angeles", "2026-11-12");
  expect(later.needsScheduling).toHaveLength(5);
  expect(needsSchedulingCsv(later, "America/Los_Angeles"))
    .toContain('"2026-11-12","Task"');
});

it("exports only headers when nothing needs scheduling", () => {
  const summary = summarizeDailyOperations(
    { organizationId: org, records: [], equipmentStates: [] },
    "UTC", "2026-11-06",
  );
  expect(needsSchedulingCsv(summary, "UTC").trimEnd().split("\r\n")).toHaveLength(1);
});
