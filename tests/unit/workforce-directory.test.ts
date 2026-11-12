import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import { filterEmployeeDirectory } from "../../src/core/workforce-directory";

function record(
  id: string,
  name: string,
  role: string,
  skills: string,
  status: "Active" | "Inactive",
  archived = false,
  entity = "employees",
): WorkspaceRecord {
  return {
    id,
    organization_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    entity,
    archived,
    data: {
      name, role, skills, status,
      email: "private@example.com", phone: "555-1111",
    },
    revision: 1,
    config_revision: 1,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };
}

const employees = [
  record("a", "Avery Example", "Cleaning specialist", "Floor care, rooms", "Active"),
  record("b", "Morgan Example", "Supervisor", "Scheduling, Quality", "Active"),
  record("c", "Casey Example", "Maintenance tech", "Inspections", "Inactive"),
  record("d", "Retired Example", "Old role", "Repairs", "Inactive", true),
  record("e", "Non-employee", "Other", "Other", "Active", false, "resources"),
];

it("searches employee name, role and skills, case-insensitively", () => {
  expect(filterEmployeeDirectory(employees, false, " AVErY ").map((r) => r.id))
    .toEqual(["a"]);
  expect(filterEmployeeDirectory(employees, false, "SUPERVISOR").map((r) => r.id))
    .toEqual(["b"]);
  expect(filterEmployeeDirectory(employees, false, "  inspection ").map((r) => r.id))
    .toEqual(["c"]);
  expect(filterEmployeeDirectory(employees, false, "not-found")).toEqual([]);
  expect(filterEmployeeDirectory(employees, false, "example").map((r) => r.id))
    .toEqual(["a", "b", "c"]);
});

it("filters explicit employee statuses within the archived/current view", () => {
  expect(filterEmployeeDirectory(employees, false, "", "all").map((r) => r.id))
    .toEqual(["a", "b", "c"]);
  expect(filterEmployeeDirectory(employees, false, "", "active").map((r) => r.id))
    .toEqual(["a", "b"]);
  expect(filterEmployeeDirectory(employees, false, "", "inactive").map((r) => r.id))
    .toEqual(["c"]);
  expect(filterEmployeeDirectory(employees, true, "", "all").map((r) => r.id))
    .toEqual(["d"]);
  expect(filterEmployeeDirectory(employees, true, "repair", "inactive").map((r) => r.id))
    .toEqual(["d"]);
  expect(filterEmployeeDirectory(employees, true, "", "active")).toEqual([]);
});

it("does not search contact fields or modify source profiles", () => {
  const before = structuredClone(employees);
  expect(filterEmployeeDirectory(employees, false, "private@example.com")).toEqual([]);
  expect(filterEmployeeDirectory(employees, false, "555-1111")).toEqual([]);
  const filtered = filterEmployeeDirectory(employees, false, "", "active");
  filtered.reverse();
  expect(employees).toEqual(before);
});
