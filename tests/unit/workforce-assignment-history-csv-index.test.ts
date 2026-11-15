import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import type { StaffAssignment } from "../../src/core/workforce";
import { csvSafeCell } from "../../src/core/daily-operations-csv";
import { displayTime } from "../../src/core/time";
import {
  filterStaffAssignmentHistory,
  filterStaffAssignmentHistoryByStartDate,
  orderStaffAssignmentHistory,
  staffAssignmentStartDateRangeError,
} from "../../src/core/workforce-assignment-history";
import {
  staffAssignmentHistoryCsv,
  type StaffAssignmentCsvView,
} from "../../src/core/workforce-assignment-history-csv";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const defaultView: StaffAssignmentCsvView = {
  status: "all", search: "", fromDate: "", throughDate: "", sort: "retained",
};

function record(
  id: string, entity: string, data: WorkspaceRecord["data"],
  organization_id = ORG, archived = false,
): WorkspaceRecord {
  return {
    id, entity, data, organization_id, archived,
    revision: 1, config_revision: 1,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };
}

function assignment(i: number, organization_id = ORG): StaffAssignment {
  const day = i % 3 === 0 ? "2026-11-05T09:00:00Z"
    : i % 3 === 1 ? "2026-11-06T09:00:00Z"
    : "2026-11-07T09:00:00Z";
  return {
    organization_id,
    appointment_id: "appointment-" + (i % 240),
    appointment_revision: i % 5 + 1,
    resource_id: "resource-" + (i % 230),
    employee_id: "private-employee-" + i,
    membership_id: "private-membership-" + i,
    membership_revision: 1,
    member_start: "2026-01-01T00:00:00Z",
    member_end: "2026-12-31T23:00:00Z",
    employee_name: "Fictional Worker " + i,
    employee_role: i % 4 === 0 ? "Lead" : "Crew",
    employee_skills: "PRIVATE SKILLS " + i,
    starts_at: day, ends_at: day,
    active: i % 3 !== 0,
  };
}

// Independent pre-optimization exporter: canonical organization boundary,
// complete filter pipeline and TWO repeated scoped .find() calls per output row.
function previousCsv(
  assignments: readonly StaffAssignment[],
  records: readonly WorkspaceRecord[],
  organizationId: string,
  zone: string,
  view: StaffAssignmentCsvView,
): string {
  if (staffAssignmentStartDateRangeError(view.fromDate, view.throughDate)) {
    throw new Error("Correct the assignment date range before exporting.");
  }
  const scoped = assignments.filter((a) => a.organization_id === organizationId);
  const scopedRecords = records.filter((r) => r.organization_id === organizationId);
  const selected = orderStaffAssignmentHistory(
    filterStaffAssignmentHistoryByStartDate(
      filterStaffAssignmentHistory(scoped, scopedRecords, view.status, view.search),
      zone, view.fromDate, view.throughDate,
    ), view.sort,
  );
  const linkedName = (id: string, entity: string, field: "title" | "name") => {
    const found = scopedRecords.find((r) => r.entity === entity && r.id === id);
    const value = found?.data[field];
    return typeof value === "string" ? value : "";
  };
  const formatted = (start: string | Date) => {
    try { return displayTime(new Date(start).toISOString(), zone); }
    catch { return ""; }
  };
  const header = [
    "Employee name (retained)", "Employee role (retained)",
    "Assignment status", "Appointment title", "Worker or crew",
    "Scheduled start (business local)", "Scheduled end (business local)",
    "Appointment revision", "Membership revision", "Business time zone",
  ];
  const rows = selected.map((a) => [
    a.employee_name, a.employee_role, a.active ? "Reserved" : "Released",
    linkedName(a.appointment_id, "appointments", "title"),
    linkedName(a.resource_id, "resources", "name"),
    formatted(a.starts_at), formatted(a.ends_at),
    String(a.appointment_revision), String(a.membership_revision), zone,
  ]);
  return [header, ...rows]
    .map((row) => row.map(csvSafeCell).join(","))
    .join("\r\n") + "\r\n";
}

it("exports identical CSVs to the old per-row lookup across 720 fictional revisions and all view combinations", () => {
  const assignments: StaffAssignment[] = [];
  const records: WorkspaceRecord[] = [];
  for (let i = 0; i < 720; i++) {
    const organization = i % 19 === 0 ? FOREIGN : ORG;
    assignments.push(assignment(i, organization));
    records.push(record("appointment-" + i, "appointments", {
      title: i % 17 === 0 ? "=SUM(1,2)" : "Appointment " + i,
      notes: "PRIVATE APPOINTMENT NOTES " + i,
    }, organization, i % 9 === 0));
    records.push(record("resource-" + i, "resources", {
      name: i % 23 === 0 ? "@UNSAFE" : "Crew " + i,
      phone: "PRIVATE PHONE " + i,
    }, organization, i % 11 === 0));
    if (i % 31 === 0) {
      records.unshift(record("appointment-" + i, "appointments", {
        title: "FOREIGN PRIVATE " + i,
      }, organization === ORG ? FOREIGN : ORG));
    }
  }
  // Entity/organization ID collisions cannot supply titles/names.
  records.push(record("appointment-1", "contacts", {
    name: "Private Contact", title: "Private Title",
  }));
  records.push(record("resource-1", "resources", {
    name: "FOREIGN RESOURCE",
  }, FOREIGN));
  // The earliest record's invalid display label takes priority over duplicates.
  records.unshift(record("appointment-4", "appointments", { title: 42 }));
  records.push(record("appointment-4", "appointments", { title: "Ignored Duplicate" }));
  records.unshift(record("resource-7", "resources", { name: 42 }));
  records.push(record("resource-7", "resources", { name: "Ignored Resource" }));
  const snapshot = structuredClone({ assignments, records });

  const views: StaffAssignmentCsvView[] = [
    defaultView,
    { ...defaultView, sort: "newest" },
    { ...defaultView, sort: "oldest" },
    { ...defaultView, status: "reserved" },
    { ...defaultView, status: "released", search: "crew" },
    { ...defaultView, search: "appointment" },
    { ...defaultView, search: "PRIVATE" },
    { ...defaultView, search: "worker 23" },
    { ...defaultView, search: "nonexistent" },
    { ...defaultView, fromDate: "2026-11-06", throughDate: "2026-11-06" },
    { ...defaultView, fromDate: "2026-11-07", sort: "newest" },
    { ...defaultView, throughDate: "2026-11-05", status: "reserved" },
    { ...defaultView, search: "lead", status: "released", sort: "oldest" },
  ];
  for (const view of views) {
    expect(staffAssignmentHistoryCsv(
      assignments, records, ORG, "America/Los_Angeles", view,
    )).toBe(previousCsv(
      assignments, records, ORG, "America/Los_Angeles", view,
    ));
  }
  expect({ assignments, records }).toEqual(snapshot);
});

it("honors first-record-wins across malformed local labels, entity collisions, and foreign IDs", () => {
  const assignments = [
    { ...assignment(0), appointment_id: "shared", resource_id: "shared" },
    { ...assignment(1), appointment_id: "valid", resource_id: "valid" },
    { ...assignment(2, FOREIGN), appointment_id: "shared", resource_id: "shared" },
  ];
  const records = [
    record("shared", "appointments", { title: "Foreign title" }, FOREIGN),
    record("shared", "resources", { name: "Foreign name" }, FOREIGN),
    record("shared", "appointments", { title: 123, notes: "SECRET" }),
    record("shared", "appointments", { title: "Must not export" }),
    record("shared", "resources", { name: 123 }),
    record("shared", "resources", { name: "Must not export resource" }),
    record("valid", "appointments", { title: "Visible appointment" }),
    record("valid", "resources", { name: "Visible crew" }),
    record("valid", "contacts", { name: "Private contact" }),
  ];
  const actual = staffAssignmentHistoryCsv(assignments, records, ORG, "UTC", defaultView);
  expect(actual).toBe(previousCsv(assignments, records, ORG, "UTC", defaultView));
  expect(actual).toContain('"Visible appointment","Visible crew"');
  for (const secret of [
    "Foreign title", "Foreign name", "Must not export",
    "SECRET", "Private contact",
  ]) expect(actual).not.toContain(secret);
});

it("keeps invalid ranges blocked and empty exports header-only", () => {
  const invalid = { ...defaultView, fromDate: "2026-11-07", throughDate: "2026-11-06" };
  expect(() => staffAssignmentHistoryCsv([], [], ORG, "UTC", invalid))
    .toThrow("Correct the assignment date range before exporting.");
  expect(staffAssignmentHistoryCsv([], [], ORG, "UTC", defaultView))
    .toBe(previousCsv([], [], ORG, "UTC", defaultView));
});


it("preserves CSV bytes for 720 repeated scheduled times, malformed starts, Date values and view filters", () => {
  const times = [
    "2026-11-01T08:30:00Z",
    "2026-11-01T09:30:00Z",
    "2026-11-06T18:00:00Z",
    "2026-11-07T07:30:00Z",
    "2026-11-07T08:30:00Z",
    "invalid-retained-instant",
    "",
  ];
  const assignments: StaffAssignment[] = [];
  const records: WorkspaceRecord[] = [
    record("appointment-common", "appointments", { title: "Shared Example" }),
    record("resource-common", "resources", { name: "Crew Example" }),
    record("appointment-common", "appointments", {
      title: "FOREIGN TITLE",
    }, FOREIGN),
    record("resource-common", "resources", {
      name: "FOREIGN CREW",
    }, FOREIGN),
  ];
  for (let i = 0; i < 720; i++) {
    const a = assignment(i, i % 23 === 0 ? FOREIGN : ORG);
    a.appointment_id = "appointment-common";
    a.resource_id = "resource-common";
    // Revisions frequently reuse the same wall-clock shifts. A Date object
    // is intentionally left mutable and must not enter the string cache.
    a.starts_at = i % 31 === 0
      ? new Date("2026-11-06T18:00:00Z")
      : times[i % times.length];
    a.ends_at = i % 37 === 0
      ? new Date("invalid")
      : i % 29 === 0
        ? new Date("2026-11-07T08:30:00Z")
        : times[(i + 2) % times.length];
    assignments.push(a);
  }
  const original = assignments.map((entry) => ({
    ...entry,
    starts_at: entry.starts_at instanceof Date
      ? new Date(entry.starts_at) : entry.starts_at,
    ends_at: entry.ends_at instanceof Date
      ? new Date(entry.ends_at) : entry.ends_at,
  }));
  const views: StaffAssignmentCsvView[] = [
    defaultView,
    { ...defaultView, sort: "oldest" },
    { ...defaultView, sort: "newest" },
    { ...defaultView, status: "reserved" },
    { ...defaultView, status: "released" },
    { ...defaultView, search: "Crew Example" },
    { ...defaultView, search: "Fictional Worker 12" },
    { ...defaultView, search: "not present" },
    { ...defaultView, fromDate: "2026-11-01", throughDate: "2026-11-01" },
    { ...defaultView, fromDate: "2026-11-06", throughDate: "2026-11-07",
      sort: "oldest" },
  ];
  for (const zone of ["UTC", "America/Los_Angeles"]) {
    for (const view of views) {
      const actual = staffAssignmentHistoryCsv(
        assignments, records, ORG, zone, view,
      );
      expect(actual).toBe(previousCsv(
        assignments, records, ORG, zone, view,
      ));
    }
  }
  const csv = staffAssignmentHistoryCsv(
    assignments, records, ORG, "UTC", defaultView,
  );
  for (const forbidden of ["FOREIGN TITLE", "FOREIGN CREW",
    "PRIVATE SKILLS", "private-employee-", "private-membership-"]) {
    expect(csv).not.toContain(forbidden);
  }
  expect(assignments).toEqual(original);
});

it("keeps invalid string times blank and separates repeated UTC DST-fold instants", () => {
  const rows = [
    { ...assignment(0), starts_at: "2026-11-01T08:30:00Z",
      ends_at: "2026-11-01T08:30:00Z" },
    { ...assignment(1), starts_at: "2026-11-01T09:30:00Z",
      ends_at: "2026-11-01T09:30:00Z" },
    { ...assignment(2), starts_at: "invalid-retained-instant",
      ends_at: "invalid-retained-instant" },
    { ...assignment(3), starts_at: new Date("2026-11-01T09:30:00Z"),
      ends_at: new Date("invalid") },
  ];
  const csv = staffAssignmentHistoryCsv(
    rows, [], ORG, "America/Los_Angeles", defaultView,
  );
  expect(csv).toBe(previousCsv(
    rows, [], ORG, "America/Los_Angeles", defaultView,
  ));
  // displayTime includes the UTC offset to disambiguate the two 01:30 hours.
  expect(csv).toContain("2026-11-01 01:30-07:00");
  expect(csv).toContain("2026-11-01 01:30-08:00");
  expect(csv).toContain('""');
  expect(csv.trimEnd().split("\r\n")).toHaveLength(5);
});

it("does not reuse cached labels between separate exports or invalid date ranges", () => {
  const a = [assignment(0)];
  const utc = staffAssignmentHistoryCsv(a, [], ORG, "UTC", defaultView);
  const pacific = staffAssignmentHistoryCsv(
    a, [], ORG, "America/Los_Angeles", defaultView,
  );
  expect(utc).toBe(previousCsv(a, [], ORG, "UTC", defaultView));
  expect(pacific).toBe(previousCsv(a, [], ORG, "America/Los_Angeles", defaultView));
  expect(utc).not.toBe(pacific);
  const invalid = { ...defaultView, fromDate: "2026-11-07",
    throughDate: "2026-11-06" };
  expect(() => staffAssignmentHistoryCsv(a, [], ORG, "UTC", invalid))
    .toThrow("Correct the assignment date range before exporting.");
});
