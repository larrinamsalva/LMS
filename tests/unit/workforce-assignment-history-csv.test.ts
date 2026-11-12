import { expect, it } from "vitest";
import type { StaffAssignment } from "../../src/core/workforce";
import type { WorkspaceRecord } from "../../src/core/engine";
import {
  staffAssignmentHistoryCsv, type StaffAssignmentCsvView,
} from "../../src/core/workforce-assignment-history-csv";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const baseView: StaffAssignmentCsvView = {
  status: "all", search: "", fromDate: "", throughDate: "", sort: "retained",
};
function assignment(
  id: string, start: string, active: boolean, organization_id = ORG,
  employee_name = "Avery Example",
): StaffAssignment {
  return {
    organization_id, appointment_id: id,
    appointment_revision: 3, employee_id: "private-person-id",
    resource_id: "crew-" + id, membership_id: "private-membership-id",
    membership_revision: 2,
    member_start: "2026-01-01T00:00:00Z",
    member_end: "2028-01-01T00:00:00Z",
    employee_name, employee_role: "Cleaning worker",
    employee_skills: "PRIVATE SKILLS",
    starts_at: start, ends_at: start, active,
  };
}
function record(id: string, entity: string, title: string, organization_id = ORG): WorkspaceRecord {
  return {
    id, entity, organization_id, archived: false,
    data: {
      title, name: title, email: "PRIVATE@EXAMPLE.ORG", notes: "PRIVATE NOTES",
    },
    revision: 1, config_revision: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}
const rows = [
  assignment("job-one", "2026-11-07T07:30:00Z", true),
  assignment("job-two", "2026-11-07T08:30:00Z", false, ORG, "Morgan Example"),
  assignment("job-foreign", "2026-11-07T08:30:00Z", true, OTHER, "FOREIGN EMPLOYEE"),
];
const records = [
  record("job-one", "appointments", "Maple House"),
  record("crew-job-one", "resources", "Blue Crew"),
  record("job-two", "appointments", "Hilltop Cabin"),
  record("crew-job-two", "resources", "Solo Worker"),
  record("job-foreign", "appointments", "FOREIGN APPOINTMENT", OTHER),
  record("crew-job-foreign", "resources", "FOREIGN RESOURCE", OTHER),
];

it("exports all authorized matching rows with privacy-safe, spreadsheet-safe fields", () => {
  const before = structuredClone(rows);
  const csv = staffAssignmentHistoryCsv(
    rows, records, ORG, "America/Los_Angeles", baseView,
  );
  const lines = csv.trimEnd().split("\r\n");
  expect(lines).toHaveLength(3);
  expect(lines[0]).toContain('"Employee name (retained)"');
  expect(lines[0]).toContain('"Business time zone"');
  expect(lines[1]).toContain('"Avery Example","Cleaning worker","Reserved","Maple House","Blue Crew"');
  expect(lines[2]).toContain('"Morgan Example","Cleaning worker","Released","Hilltop Cabin","Solo Worker"');
  expect(lines[1]).toContain('"America/Los_Angeles"');
  for (const forbidden of [
    "FOREIGN", "private-person-id", "private-membership-id",
    "PRIVATE SKILLS", "PRIVATE NOTES", "PRIVATE@EXAMPLE.ORG",
    "job-one", "crew-job-one",
  ]) expect(csv).not.toContain(forbidden);
  expect(rows).toEqual(before);
});

it("reapplies date/status/search/sort consistently rather than trusting UI subset", () => {
  const novemberSix = staffAssignmentHistoryCsv(
    rows, records, ORG, "America/Los_Angeles", {
      ...baseView, fromDate: "2026-11-06", throughDate: "2026-11-06",
      search: "blue crew",
      status: "reserved",
    },
  );
  expect(novemberSix).toContain("Avery Example");
  expect(novemberSix).not.toContain("Morgan Example");
  const novemberSeven = staffAssignmentHistoryCsv(
    rows, records, ORG, "America/Los_Angeles", {
      ...baseView, fromDate: "2026-11-07", status: "released",
    },
  );
  expect(novemberSeven).toContain("Morgan Example");
  expect(novemberSeven).not.toContain("Avery Example");
  const reversed = staffAssignmentHistoryCsv(
    rows, records, ORG, "America/Los_Angeles", { ...baseView, sort: "newest" },
  );
  expect(reversed.indexOf("Morgan Example")).toBeLessThan(reversed.indexOf("Avery Example"));
  expect(() => staffAssignmentHistoryCsv(
    rows, records, ORG, "UTC", {
      ...baseView, fromDate: "2026-11-08", throughDate: "2026-11-07",
    },
  )).toThrow(/Correct the assignment date range/);
});

it("exports all matches beyond first-ten pagination and safe empty header-only sets", () => {
  const many = Array.from({ length: 17 }, (_, i) =>
    assignment("visit-" + i, "2026-11-07T12:00:00Z", true, ORG, "Person " + i),
  );
  const csv = staffAssignmentHistoryCsv(many, [], ORG, "UTC", baseView);
  expect(csv.trimEnd().split("\r\n")).toHaveLength(18);
  expect(csv).toContain('"Person 16"');
  expect(csv).not.toContain("visit-16");
  const empty = staffAssignmentHistoryCsv(many, [], ORG, "UTC", {
    ...baseView, search: "no such person",
  });
  expect(empty.trimEnd().split("\r\n")).toHaveLength(1);
});

it("quotes unsafe spreadsheet formulas in retained names and linked titles", () => {
  const malicious = [assignment(
    "poisoned", "2026-11-06T10:00:00Z", true, ORG, "=HYPERLINK(\"unsafe\")",
  )];
  const links = [
    record("poisoned", "appointments", " +SUM(1,2)"),
    record("crew-poisoned", "resources", "@cmd"),
  ];
  const csv = staffAssignmentHistoryCsv(malicious, links, ORG, "UTC", baseView);
  expect(csv).toContain('"'=HYPERLINK(""unsafe"")"');
  expect(csv).toContain('"' +SUM(1,2)"');
  expect(csv).toContain('"'@cmd"');
});
