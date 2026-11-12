import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import { filterAvailabilityPeriods } from "../../src/core/workforce-availability-filter";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function rec(
  id: string, entity: string, data: Record<string, unknown>,
  organization_id = ORG,
): WorkspaceRecord {
  return {
    id, entity, organization_id, data, archived: false, revision: 1,
    config_revision: 1, created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  } as WorkspaceRecord;
}

const employees = [
  rec("employee-a", "employees", {
    name: "Avery Cleaner", email: "private@example.com", phone: "555-3333",
  }),
  rec("crew-b", "resources", { name: "Night Crew" }),
  rec("employee-c", "employees", { name: "Other org worker" }, OTHER),
];
const periods = [
  rec("period-one", "availability", {
    title: "Morning shift", kind: "Working hours", employee: "employee-a",
    notes: "Sensitive note not searchable",
  }),
  rec("period-two", "availability", {
    title: "Planned leave", kind: "Vacation", resource: "crew-b",
  }),
  rec("period-three", "availability", {
    title: "Weekend break", kind: "Day off", employee: "employee-a",
  }),
  rec("period-four", "availability", {
    title: "Other subject", kind: "Unavailable", employee: "employee-c",
  }),
  rec("period-five", "appointments", {
    title: "Not an availability period", kind: "Working hours",
  }),
];

it("filters selected-day periods by exact kind without mutating the originals", () => {
  const before = structuredClone(periods);
  expect(filterAvailabilityPeriods(periods, employees, "Working hours", "")
    .map((r) => r.id)).toEqual(["period-one"]);
  expect(filterAvailabilityPeriods(periods, employees, "Vacation", "")
    .map((r) => r.id)).toEqual(["period-two"]);
  expect(filterAvailabilityPeriods(periods, employees, "Day off", "")
    .map((r) => r.id)).toEqual(["period-three"]);
  expect(filterAvailabilityPeriods(periods, employees, "Unavailable", "")
    .map((r) => r.id)).toEqual(["period-four"]);
  const all = filterAvailabilityPeriods(periods, employees, "all", "");
  expect(all.map((r) => r.id)).toEqual([
    "period-one", "period-two", "period-three", "period-four",
  ]);
  all.reverse();
  expect(periods).toEqual(before);
});

it("matches title or linked employee/resource name, case-insensitively", () => {
  expect(filterAvailabilityPeriods(periods, employees, "all", " mORNIng ")
    .map((r) => r.id)).toEqual(["period-one"]);
  expect(filterAvailabilityPeriods(periods, employees, "all", "AVERY")
    .map((r) => r.id)).toEqual(["period-one", "period-three"]);
  expect(filterAvailabilityPeriods(periods, employees, "Vacation", " nIGHT ")
    .map((r) => r.id)).toEqual(["period-two"]);
  expect(filterAvailabilityPeriods(periods, employees, "Day off", "leave"))
    .toEqual([]);
});

it("never searches notes, contacts, raw IDs or foreign linked names", () => {
  for (const query of [
    "Sensitive note", "private@example.com", "555-3333",
    "period-one", "employee-a", "Other org worker",
  ]) {
    expect(filterAvailabilityPeriods(periods, employees, "all", query))
      .toEqual([]);
  }
  expect(filterAvailabilityPeriods(periods, employees, "all", "Other subject")
    .map((r) => r.id)).toEqual(["period-four"]);
  expect(filterAvailabilityPeriods(periods, employees, "all", "No match"))
    .toEqual([]);
});
