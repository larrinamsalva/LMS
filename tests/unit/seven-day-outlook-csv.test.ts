import { expect, it } from "vitest";
import { sevenDayOutlookCsv } from "../../src/core/seven-day-outlook-csv";
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

it("exports future jobs and appointments in business-local order without other businesses' data", () => {
  const records = [
    record("appointments", "visit", {
      title: "Fictional inspection", status: "Scheduled",
      start: "2026-11-06T18:30:00Z", end: "2026-11-06T19:30:00Z",
    }),
    record("jobs", "early", {
      title: "Fictional deep clean", status: "Planned", date: "2026-11-06",
    }),
    record("tasks", "formula", {
      title: "=HYPERLINK(\"bad\")", status: "Open", due: "2026-11-07",
    }),
    record("appointments", "last", {
      title: "Fictional last-day booking", status: "Scheduled",
      start: "2026-11-13T07:30:00Z", end: "2026-11-13T08:00:00Z",
    }),
    record("jobs", "today", {
      title: "Today's job", status: "Planned", date: "2026-11-05",
    }),
    record("jobs", "overdue", {
      title: "Overdue job", status: "Planned", date: "2026-11-04",
    }),
    record("jobs", "done", {
      title: "Finished job", status: "Done", date: "2026-11-07",
    }),
    record("appointments", "cancel", {
      title: "Cancelled visit", status: "Cancelled",
      start: "2026-11-06T20:00:00Z", end: "2026-11-06T21:00:00Z",
    }),
    record("appointments", "archived", {
      title: "Archived visit", status: "Scheduled",
      start: "2026-11-06T20:00:00Z", end: "2026-11-06T21:00:00Z",
    }, org, true),
    record("appointments", "foreign", {
      title: "Other business visit", status: "Scheduled",
      start: "2026-11-06T20:00:00Z", end: "2026-11-06T21:00:00Z",
    }, other),
    record("jobs", "foreign-job", {
      title: "Other business job", status: "Planned", date: "2026-11-07",
    }, other),
  ];
  const summary = summarizeDailyOperations(
    { organizationId: org, records, equipmentStates: [] },
    "America/Los_Angeles", "2026-11-05",
  );
  const csv = sevenDayOutlookCsv(summary, "America/Los_Angeles");
  const lines = csv.trimEnd().split("\r\n");
  expect(lines).toHaveLength(5);
  expect(csv).toContain('"2026-11-05","2026-11-12"');
  expect(csv).toContain('"Appointment","Fictional inspection","2026-11-06 10:30-08:00"');
  expect(csv).toContain('"Cleaning job","Fictional deep clean","2026-11-06"');
  expect(csv).toContain('"Task","\'=HYPERLINK(""bad"")"');
  expect(lines[1]).toContain("Fictional deep clean");
  expect(lines[2]).toContain("Fictional inspection");
  for (const omitted of [
    "Today's job", "Overdue job", "Finished job", "Cancelled visit",
    "Archived visit", "Other business visit", "Other business job",
  ]) expect(csv).not.toContain(omitted);
});

it("includes the seventh future day and leaves an empty outlook as a header-only CSV", () => {
  const records = [
    record("appointments", "last", {
      title: "Final day appointment", status: "Scheduled",
      start: "2026-11-13T07:30:00Z", end: "2026-11-13T08:00:00Z",
    }),
    record("tasks", "edge", {
      title: "Last day task", status: "Open", due: "2026-11-12",
    }),
    record("tasks", "outside", {
      title: "Eighth day", status: "Open", due: "2026-11-13",
    }),
  ];
  const result = summarizeDailyOperations(
    { organizationId: org, records, equipmentStates: [] },
    "America/Los_Angeles", "2026-11-05",
  );
  const csv = sevenDayOutlookCsv(result, "America/Los_Angeles");
  expect(csv).toContain("Final day appointment");
  expect(csv).toContain("Last day task");
  expect(csv).not.toContain("Eighth day");
  const empty = summarizeDailyOperations({
    organizationId: org, records: [], equipmentStates: [],
  }, "UTC", "2026-11-05");
  expect(sevenDayOutlookCsv(empty, "UTC").trimEnd().split("\r\n")).toHaveLength(1);
});

it("uses business-local calendar times through the daylight-saving transition", () => {
  const records = [
    record("appointments", "fall", {
      title: "DST weekend visit", status: "Scheduled",
      start: "2026-11-01T09:30:00Z", end: "2026-11-01T10:30:00Z",
    }),
  ];
  const summary = summarizeDailyOperations({
    organizationId: org, records, equipmentStates: [],
  }, "America/Los_Angeles", "2026-10-31");
  const csv = sevenDayOutlookCsv(summary, "America/Los_Angeles");
  expect(csv).toContain("2026-11-01 01:30-08:00");
  expect(csv).toContain("DST weekend visit");
});
