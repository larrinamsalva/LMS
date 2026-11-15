import { expect, it } from "vitest";
import type { StaffAssignment } from "../../src/core/workforce";
import { localDate } from "../../src/core/time";
import {
  filterStaffAssignmentHistoryByStartDate,
  staffAssignmentStartDateRangeError,
} from "../../src/core/workforce-assignment-history";

function assignment(id: number, start: string | Date): StaffAssignment {
  return {
    organization_id: id % 19 === 0
      ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    appointment_id: "appointment-" + id,
    appointment_revision: id % 5 + 1,
    employee_id: "employee-" + id,
    resource_id: "resource-" + (id % 20),
    membership_id: "membership-" + id,
    membership_revision: 1,
    member_start: "2026-01-01T00:00:00Z",
    member_end: "2028-12-31T00:00:00Z",
    employee_name: "Fictional Worker " + id,
    employee_role: "Crew",
    employee_skills: "PRIVATE SKILLS",
    starts_at: start,
    ends_at: "2026-11-08T09:00:00Z",
    active: id % 3 !== 0,
  };
}

// Independent verbatim previous implementation from merged #162.
// The original reparses the saved start instant on every assignment.
function previousFilter(
  assignments: readonly StaffAssignment[],
  zone: string,
  fromDate: string,
  throughDate: string,
): StaffAssignment[] {
  if (staffAssignmentStartDateRangeError(fromDate, throughDate)) return [];
  if (!fromDate && !throughDate) return [...assignments];
  return assignments.filter((assignment) => {
    try {
      const startDay = localDate(
        new Date(assignment.starts_at).toISOString(), zone,
      );
      return (!fromDate || startDay >= fromDate) &&
        (!throughDate || startDay <= throughDate);
    } catch {
      // Malformed retained start dates cannot be assigned a guessed day.
      return false;
    }
  });
}

it("preserves exact retained revision selection with 720 fictional starts and multiple local-date ranges", () => {
  const times = [
    "2026-11-01T08:30:00Z", // 01:30 before the autumn DST fold
    "2026-11-01T09:30:00Z", // 01:30 after the autumn DST fold
    "2026-03-08T09:30:00Z", // before the spring jump
    "2026-03-08T10:30:00Z", // after the spring jump
    "2026-11-07T07:30:00Z", // 23:30 previous Pacific day
    "2026-11-07T08:30:00Z",
    "2028-02-29T12:00:00Z", // leap day
    "invalid-saved-instant",
    "",
    "2026-11-01T09:30:00+00:00",
  ];
  const entries = Array.from({ length: 720 }, (_, i) => assignment(
    i, i % 41 === 0
      ? new Date("2026-11-01T09:30:00Z")
      : i % 43 === 0
        ? new Date("invalid")
        : times[i % times.length],
  ));
  const repeated = assignment(900, "2026-11-07T08:30:00Z");
  entries.push(repeated, repeated, assignment(901, repeated.starts_at));
  const referenceOrder = [...entries];
  const zones = ["UTC", "America/Los_Angeles", "America/New_York"];
  const ranges: Array<readonly [string, string]> = [
    ["", ""],
    ["2026-11-01", "2026-11-01"],
    ["2026-11-01", ""],
    ["", "2026-11-01"],
    ["2026-11-06", "2026-11-07"],
    ["2026-11-07", "2026-11-07"],
    ["2026-03-08", "2026-03-08"],
    ["2028-02-29", "2028-02-29"],
    ["2026-01-01", "2028-12-31"],
    ["2026-12-01", "2026-11-06"], // reversed interval
    ["2026-02-30", ""], // impossible local calendar date
    ["2026-11", ""], // incomplete date
  ];
  for (const zone of zones) {
    for (const [from, through] of ranges) {
      const expected = previousFilter(entries, zone, from, through);
      const actual = filterStaffAssignmentHistoryByStartDate(
        entries, zone, from, through,
      );
      expect(actual).toEqual(expected);
      expect(actual.length).toBe(expected.length);
      for (let i = 0; i < actual.length; i++) {
        // Preserve exact record references, duplicate occurrences and order.
        expect(actual[i]).toBe(expected[i]);
      }
    }
  }
  expect(entries).toEqual(referenceOrder);
});

it("never retains stale results for mutable Date objects or a different display zone", () => {
  const mutableStart = new Date("2026-11-07T07:30:00Z");
  const entry = assignment(1, mutableStart);
  const values = [entry, entry, assignment(2, "2026-11-07T07:30:00Z")];
  const inRange = (zone: string, from: string, through: string) =>
    filterStaffAssignmentHistoryByStartDate(values, zone, from, through);
  expect(inRange("America/Los_Angeles", "2026-11-06", "2026-11-06"))
    .toEqual(previousFilter(values, "America/Los_Angeles", "2026-11-06", "2026-11-06"));
  mutableStart.setTime(Date.parse("2026-11-07T08:30:00Z"));
  expect(inRange("America/Los_Angeles", "2026-11-07", "2026-11-07"))
    .toEqual(previousFilter(values, "America/Los_Angeles", "2026-11-07", "2026-11-07"));
  expect(inRange("UTC", "2026-11-07", "2026-11-07"))
    .toEqual(previousFilter(values, "UTC", "2026-11-07", "2026-11-07"));
  mutableStart.setTime(Number.NaN);
  expect(inRange("UTC", "2026-11-07", "2026-11-07"))
    .toEqual(previousFilter(values, "UTC", "2026-11-07", "2026-11-07"));
});

it("preserves invalid-zone handling and unbounded copy behavior", () => {
  const entries = [
    assignment(10, "2026-11-06T10:00:00Z"),
    assignment(11, "invalid-saved-instant"),
  ];
  const noBounds = filterStaffAssignmentHistoryByStartDate(
    entries, "Not/AZone", "", "",
  );
  expect(noBounds).toEqual(entries);
  expect(noBounds).not.toBe(entries);
  expect(filterStaffAssignmentHistoryByStartDate(
    entries, "Not/AZone", "2026-11-06", "",
  )).toEqual(previousFilter(entries, "Not/AZone", "2026-11-06", ""));
  expect(filterStaffAssignmentHistoryByStartDate(
    entries, "UTC", "2026-13-01", "",
  )).toEqual([]);
});
