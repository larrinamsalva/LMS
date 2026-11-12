import { expect, it } from "vitest";
import type { StaffAssignment } from "../../src/core/workforce";
import {
  filterStaffAssignmentHistoryByStartDate,
  staffAssignmentStartDateRangeError,
} from "../../src/core/workforce-assignment-history";

function assignment(start: string): StaffAssignment {
  return {
    organization_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    appointment_id: start,
    appointment_revision: 1, employee_id: "worker",
    resource_id: "crew", membership_id: "membership",
    membership_revision: 1,
    member_start: "2026-01-01T00:00:00Z",
    member_end: "2029-01-01T00:00:00Z",
    employee_name: "Fictional Worker", employee_role: "Cleaner",
    employee_skills: "",
    starts_at: start, ends_at: start,
    active: true,
  };
}

it("interprets inclusive date ranges by business-local start, not UTC date", () => {
  // 07:30Z is still November 6 in Los Angeles; 08:30Z is November 7.
  const assignments = [
    assignment("2026-11-07T07:30:00Z"),
    assignment("2026-11-07T08:30:00Z"),
    assignment("2026-11-08T08:30:00Z"),
  ];
  const before = structuredClone(assignments);
  expect(filterStaffAssignmentHistoryByStartDate(
    assignments, "America/Los_Angeles", "2026-11-06", "2026-11-06",
  )).toEqual([assignments[0]]);
  expect(filterStaffAssignmentHistoryByStartDate(
    assignments, "America/Los_Angeles", "2026-11-07", "",
  )).toEqual(assignments.slice(1));
  expect(filterStaffAssignmentHistoryByStartDate(
    assignments, "America/Los_Angeles", "", "2026-11-07",
  )).toEqual(assignments.slice(0, 2));
  expect(filterStaffAssignmentHistoryByStartDate(
    assignments, "UTC", "2026-11-07", "2026-11-07",
  )).toEqual(assignments.slice(0, 2));
  const unbounded = filterStaffAssignmentHistoryByStartDate(
    assignments, "America/Los_Angeles", "", "",
  );
  unbounded.reverse();
  expect(assignments).toEqual(before);
});

it("uses calendar days across a spring-forward DST boundary and leap day", () => {
  const spring = [
    assignment("2026-03-08T04:30:00Z"), // Mar 7 23:30 New York
    assignment("2026-03-08T07:30:00Z"), // Mar 8 03:30 New York
  ];
  expect(filterStaffAssignmentHistoryByStartDate(
    spring, "America/New_York", "2026-03-08", "2026-03-08",
  )).toEqual([spring[1]]);
  const leap = [assignment("2028-02-29T12:00:00Z")];
  expect(filterStaffAssignmentHistoryByStartDate(
    leap, "UTC", "2028-02-29", "2028-02-29",
  )).toEqual(leap);
});

it("refuses reversed, impossible or partial bounds rather than guessing", () => {
  const one = [assignment("2026-11-06T10:00:00Z")];
  expect(staffAssignmentStartDateRangeError("", "")).toBeNull();
  expect(staffAssignmentStartDateRangeError("2026-11-06", "2026-11-06")).toBeNull();
  expect(staffAssignmentStartDateRangeError("2026-11-09", "2026-11-06"))
    .toMatch(/on or before/);
  for (const bad of ["2026-02-30", "2026-11", "2026-13-01", "tomorrow"]) {
    expect(staffAssignmentStartDateRangeError(bad, "")).toMatch(/valid/);
    expect(filterStaffAssignmentHistoryByStartDate(
      one, "UTC", bad, "",
    )).toEqual([]);
  }
  expect(filterStaffAssignmentHistoryByStartDate(
    one, "UTC", "2026-11-09", "2026-11-06",
  )).toEqual([]);
  expect(filterStaffAssignmentHistoryByStartDate(
    [assignment("not-an-instant")], "UTC", "2026-11-01", "",
  )).toEqual([]);
});

it("filters only the supplied authorized snapshots and never adds details", () => {
  const authorized = [assignment("2026-11-06T10:00:00Z")];
  const found = filterStaffAssignmentHistoryByStartDate(
    authorized, "UTC", "2026-11-06", "2026-11-06",
  );
  expect(found).toEqual(authorized);
  expect(found[0]).toBe(authorized[0]);
  expect(filterStaffAssignmentHistoryByStartDate(
    authorized, "UTC", "2026-12-01", "",
  )).toEqual([]);
});
