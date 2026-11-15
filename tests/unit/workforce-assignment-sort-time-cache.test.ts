import { expect, it } from "vitest";
import type { StaffAssignment } from "../../src/core/workforce";
import { orderStaffAssignmentHistory } from "../../src/core/workforce-assignment-history";

function assignment(index: number, start: string | Date): StaffAssignment {
  return {
    organization_id: index % 19 === 0
      ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    appointment_id: "appointment-" + index,
    appointment_revision: 1 + (index % 5),
    employee_id: "employee-" + index,
    resource_id: "resource-" + (index % 37),
    membership_id: "membership-" + index,
    membership_revision: 1,
    member_start: "2026-01-01T00:00:00Z",
    member_end: "2028-01-01T00:00:00Z",
    employee_name: "Fictional Worker " + index,
    employee_role: "Crew",
    employee_skills: "PRIVATE SKILLS",
    starts_at: start,
    ends_at: start,
    active: index % 3 !== 0,
  };
}

// Independent reference copied from the five-green, merged #163 baseline.
// It reparses every scheduled start, including repeated string values.
function previousOrder(
  entries: readonly StaffAssignment[],
  sort: "retained" | "oldest" | "newest",
): StaffAssignment[] {
  if (sort === "retained") return [...entries];
  const millis = (value: string | Date) => {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
  };
  return entries.map((entry, index) => ({
    entry, index, time: millis(entry.starts_at),
  })).sort((a, b) =>
    (a.time === null ? (b.time === null ? 0 : 1)
      : b.time === null ? -1
        : sort === "newest" ? b.time - a.time : a.time - b.time) ||
    a.index - b.index,
  ).map(({ entry }) => entry);
}

it("preserves the exact reference order for 720 fictional historical assignment revisions", () => {
  const times = [
    "2026-11-01T08:30:00Z",
    "2026-11-01T09:30:00Z",
    "2026-11-06T18:00:00Z",
    "2026-11-06T18:00:00+00:00",
    "2026-11-07T07:30:00Z",
    "2026-11-07T08:30:00Z",
    "2028-02-29T12:00:00Z",
    "not-a-time",
    "",
    "2026-12-24T22:00:00Z",
  ];
  const entries: StaffAssignment[] = [];
  for (let i = 0; i < 720; i++) {
    const start: string | Date = i % 37 === 0
      ? new Date("2026-11-01T09:30:00Z")
      : i % 41 === 0
        ? new Date("invalid")
        : times[i % times.length];
    entries.push(assignment(i, start));
  }
  const repeated = assignment(910, "2026-11-06T18:00:00Z");
  entries.push(repeated, repeated, assignment(911, repeated.starts_at));
  const originalOrder = [...entries];
  for (const sort of ["retained", "oldest", "newest"] as const) {
    const expected = previousOrder(entries, sort);
    const actual = orderStaffAssignmentHistory(entries, sort);
    expect(actual).toEqual(expected);
    expect(actual).toHaveLength(expected.length);
    for (let i = 0; i < actual.length; i++) {
      // Exact references preserve repeated object instances and stable ties.
      expect(actual[i]).toBe(expected[i]);
    }
    expect(actual).not.toBe(entries);
  }
  expect(entries).toEqual(originalOrder);
});

it("keeps malformed times last, ties stable and DST-fold instants distinct", () => {
  const entries = [
    assignment(0, "invalid"),
    assignment(1, "2026-11-01T09:30:00Z"),
    assignment(2, "2026-11-01T08:30:00Z"),
    assignment(3, "2026-11-01T09:30:00+00:00"),
    assignment(4, ""),
    assignment(5, new Date("2026-11-01T08:30:00Z")),
    assignment(6, new Date("invalid")),
  ];
  const old = orderStaffAssignmentHistory(entries, "oldest");
  const newest = orderStaffAssignmentHistory(entries, "newest");
  expect(old.map((a) => a.appointment_id)).toEqual([
    "appointment-2", "appointment-5", "appointment-1", "appointment-3",
    "appointment-0", "appointment-4", "appointment-6",
  ]);
  expect(newest.map((a) => a.appointment_id)).toEqual([
    "appointment-1", "appointment-3", "appointment-2", "appointment-5",
    "appointment-0", "appointment-4", "appointment-6",
  ]);
  expect(old).toEqual(previousOrder(entries, "oldest"));
  expect(newest).toEqual(previousOrder(entries, "newest"));
});

it("does not cache mutable Date objects or leak results across calls", () => {
  const mutable = new Date("2026-11-07T07:30:00Z");
  const entries = [
    assignment(0, mutable),
    assignment(1, "2026-11-07T07:30:00Z"),
    assignment(2, "2026-11-07T08:30:00Z"),
  ];
  const compare = () => {
    for (const sort of ["oldest", "newest"] as const) {
      const result = orderStaffAssignmentHistory(entries, sort);
      const reference = previousOrder(entries, sort);
      expect(result).toEqual(reference);
      result.forEach((value, index) => expect(value).toBe(reference[index]));
    }
  };
  compare();
  mutable.setTime(Date.parse("2026-11-07T09:30:00Z"));
  compare();
  mutable.setTime(Number.NaN);
  compare();
  // The retained-order fast path does not attempt to parse malformed dates.
  const unchanged = orderStaffAssignmentHistory(entries, "retained");
  expect(unchanged).toEqual(entries);
  expect(unchanged).not.toBe(entries);
});
