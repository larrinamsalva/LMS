import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import type { StaffAssignment } from "../../src/core/workforce";
import {
  filterStaffAssignmentHistory,
  orderStaffAssignmentHistory,
} from "../../src/core/workforce-assignment-history";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function assignment(
  appointment: string, resource: string, starts_at: string,
  employee = "Avery Example",
): StaffAssignment {
  return {
    organization_id: ORG,
    appointment_id: appointment, appointment_revision: 1,
    employee_id: "person", resource_id: resource,
    membership_id: "membership", membership_revision: 1,
    member_start: "2026-01-01T00:00:00Z",
    member_end: "2028-01-01T00:00:00Z",
    employee_name: employee, employee_role: "Cleaning specialist",
    employee_skills: "NOT SEARCHABLE",
    starts_at, ends_at: starts_at, active: true,
  };
}
function record(
  id: string, entity: string, name: string, organization_id = ORG,
): WorkspaceRecord {
  return {
    id, entity, organization_id, archived: false,
    data: { name, title: name, notes: "PRIVATE DETAIL" },
    revision: 1, config_revision: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

it("matches only authorized resource names, combined with snapshot search", () => {
  const rows = [
    assignment("appt-a", "crew-a", "2026-11-06T10:00:00Z"),
    assignment("appt-b", "crew-b", "2026-11-07T10:00:00Z", "Morgan Example"),
    assignment("appt-c", "crew-other", "2026-11-08T10:00:00Z", "Taylor Example"),
  ];
  const records = [
    record("crew-a", "resources", "Blue Cleaning Crew"),
    record("crew-b", "resources", "Maintenance Worker"),
    record("crew-other", "resources", "FOREIGN PRIVATE RESOURCE", OTHER),
    record("appt-a", "appointments", "First visit"),
    record("appt-b", "appointments", "Second visit"),
    record("private-worker", "employees", "NOT A RESOURCE"),
  ];
  const before = structuredClone(rows);
  expect(filterStaffAssignmentHistory(rows, records, "all", " blue cleaning ")
    .map((row) => row.appointment_id)).toEqual(["appt-a"]);
  expect(filterStaffAssignmentHistory(rows, records, "all", "maintenance")
    .map((row) => row.appointment_id)).toEqual(["appt-b"]);
  expect(filterStaffAssignmentHistory(rows, records, "all", "PRIVATE RESOURCE"))
    .toEqual([]);
  expect(filterStaffAssignmentHistory(rows, records, "all", "NOT A RESOURCE"))
    .toEqual([]);
  expect(filterStaffAssignmentHistory(rows, records, "all", "crew-a"))
    .toEqual([]);
  expect(filterStaffAssignmentHistory(rows, records, "all", "PRIVATE DETAIL"))
    .toEqual([]);
  expect(filterStaffAssignmentHistory(rows, records, "all", "Avery"))
    .toEqual([rows[0]]);
  expect(rows).toEqual(before);
});

it("sorts retained snapshots by exact scheduled start instant and preserves ties", () => {
  const rows = [
    assignment("earliest", "crew", "2026-11-06T10:00:00Z"),
    assignment("latest", "crew", "2026-11-08T10:00:00Z"),
    assignment("tie-a", "crew", "2026-11-07T18:00:00Z"),
    assignment("tie-b", "crew", "2026-11-07T10:00:00-08:00"),
  ];
  const original = structuredClone(rows);
  expect(orderStaffAssignmentHistory(rows, "retained")
    .map((row) => row.appointment_id))
    .toEqual(["earliest", "latest", "tie-a", "tie-b"]);
  expect(orderStaffAssignmentHistory(rows, "newest")
    .map((row) => row.appointment_id))
    .toEqual(["latest", "tie-a", "tie-b", "earliest"]);
  expect(orderStaffAssignmentHistory(rows, "oldest")
    .map((row) => row.appointment_id))
    .toEqual(["earliest", "tie-a", "tie-b", "latest"]);
  const newest = orderStaffAssignmentHistory(rows, "newest");
  newest.reverse();
  expect(rows).toEqual(original);
});

it("leaves malformed retained start times last in both sort directions", () => {
  const rows = [
    assignment("invalid", "crew", "invalid-time"),
    assignment("old", "crew", "2026-11-01T00:00:00Z"),
    assignment("new", "crew", "2026-11-20T00:00:00Z"),
  ];
  expect(orderStaffAssignmentHistory(rows, "newest")
    .map((row) => row.appointment_id)).toEqual(["new", "old", "invalid"]);
  expect(orderStaffAssignmentHistory(rows, "oldest")
    .map((row) => row.appointment_id)).toEqual(["old", "new", "invalid"]);
  expect(orderStaffAssignmentHistory([], "newest")).toEqual([]);
});
