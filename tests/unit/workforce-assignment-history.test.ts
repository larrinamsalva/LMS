import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import type { StaffAssignment } from "../../src/core/workforce";
import {
  filterStaffAssignmentHistory,
  staffAssignmentHistoryCounts,
  visibleStaffAssignmentHistory,
  STAFF_HISTORY_PAGE_SIZE,
} from "../../src/core/workforce-assignment-history";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function entry(
  employee_name: string,
  active: boolean,
  appointment_id: string,
): StaffAssignment {
  return {
    organization_id: ORG,
    appointment_id,
    appointment_revision: 1,
    employee_id: "private-worker-id",
    resource_id: "private-resource-id",
    membership_id: "private-membership-id",
    membership_revision: 1,
    member_start: "2026-11-01T00:00:00Z",
    member_end: "2026-12-01T00:00:00Z",
    employee_name,
    employee_role: "Cleaning specialist",
    employee_skills: "PRIVATE SKILL",
    starts_at: "2026-11-06T10:00:00Z",
    ends_at: "2026-11-06T11:00:00Z",
    active,
  };
}
function appointment(
  id: string, title: string, organization_id = ORG,
): WorkspaceRecord {
  return {
    id, organization_id, entity: "appointments",
    data: { title, notes: "PRIVATE APPOINTMENT NOTE" },
    archived: false, revision: 1, config_revision: 1,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };
}
const rows: StaffAssignment[] = [
  entry("Avery Crew Example", true, "appointment-clean"),
  entry("Morgan Crew Example", false, "appointment-foreign"),
  entry("Taylor Example", false, "appointment-clean"),
];
const records = [
  appointment("appointment-clean", "Maple House clean"),
  appointment("appointment-foreign", "Foreign confidential job", OTHER),
  appointment("employee-foo", "Not an appointment"),
];

it("filters retained assignment revisions by state, snapshot employee or role, and authorized appointment title", () => {
  const original = structuredClone(rows);
  expect(filterStaffAssignmentHistory(rows, records, "all", "").length).toBe(3);
  expect(filterStaffAssignmentHistory(rows, records, "reserved", "")
    .map((r) => r.employee_name)).toEqual(["Avery Crew Example"]);
  expect(filterStaffAssignmentHistory(rows, records, "released", "")
    .map((r) => r.employee_name)).toEqual(["Morgan Crew Example", "Taylor Example"]);
  expect(filterStaffAssignmentHistory(rows, records, "all", " AVERY ")
    .map((r) => r.employee_name)).toEqual(["Avery Crew Example"]);
  expect(filterStaffAssignmentHistory(rows, records, "released", "cleaning")
    .map((r) => r.employee_name)).toEqual(["Morgan Crew Example", "Taylor Example"]);
  expect(filterStaffAssignmentHistory(rows, records, "all", "MAPLE")
    .map((r) => r.employee_name)).toEqual(["Avery Crew Example", "Taylor Example"]);
  expect(filterStaffAssignmentHistory(rows, records, "reserved", "Morgan"))
    .toEqual([]);
  expect(rows).toEqual(original);
});

it("never searches foreign appointment titles, record IDs, private skills or appointment notes", () => {
  for (const query of [
    "Foreign confidential", "private-worker-id", "private-resource-id",
    "PRIVATE SKILL", "PRIVATE APPOINTMENT NOTE", "appointment-clean",
  ]) {
    expect(filterStaffAssignmentHistory(rows, records, "all", query)).toEqual([]);
  }
  expect(filterStaffAssignmentHistory(rows, records, "all", "Morgan")
    .map((r) => r.employee_name)).toEqual(["Morgan Crew Example"]);
});

it("keeps snapshot counts separate from unique people, capacity or paging", () => {
  expect(staffAssignmentHistoryCounts(rows)).toEqual({
    total: 3, reserved: 1, released: 2,
  });
  expect(staffAssignmentHistoryCounts([])).toEqual({
    total: 0, reserved: 0, released: 0,
  });
  const expanded = Array.from({ length: 23 }, (_, index) => entry(
    "Example " + index, index % 2 === 0, "appointment-clean",
  ));
  expect(visibleStaffAssignmentHistory(expanded, 1)).toHaveLength(
    STAFF_HISTORY_PAGE_SIZE,
  );
  expect(visibleStaffAssignmentHistory(expanded, 20)).toHaveLength(20);
  expect(visibleStaffAssignmentHistory(expanded, 30)).toHaveLength(23);
  expect(visibleStaffAssignmentHistory(expanded, Number.NaN))
    .toHaveLength(STAFF_HISTORY_PAGE_SIZE);
  const original = [...expanded];
  visibleStaffAssignmentHistory(expanded, 20).reverse();
  expect(expanded).toEqual(original);
  expect(staffAssignmentHistoryCounts(expanded).total).toBe(23);
});
