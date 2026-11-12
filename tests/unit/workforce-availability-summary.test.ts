import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import { summarizeAvailabilityPeriodTypes } from "../../src/core/workforce-availability-summary";

function record(id: string, entity: string, kind: string): WorkspaceRecord {
  return {
    id, entity, organization_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    archived: false, data: { title: "Private period " + id, kind },
    revision: 1, config_revision: 1,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  } as WorkspaceRecord;
}

it("counts each recorded availability period separately, not employee headcount", () => {
  const selectedDay = [
    record("one", "availability", "Working hours"),
    record("two", "availability", "Working hours"),
    record("three", "availability", "Day off"),
    record("four", "availability", "Vacation"),
    record("five", "availability", "Unavailable"),
    record("wrong-entity", "appointments", "Working hours"),
    record("unknown-type", "availability", "Other"),
  ];
  const before = structuredClone(selectedDay);
  expect(summarizeAvailabilityPeriodTypes(selectedDay)).toEqual({
    workingHours: 2,
    daysOff: 1,
    vacations: 1,
    unavailable: 1,
    total: 5,
  });
  expect(selectedDay).toEqual(before);
});

it("returns a clear zero summary for a day without recorded periods", () => {
  expect(summarizeAvailabilityPeriodTypes([])).toEqual({
    workingHours: 0,
    daysOff: 0,
    vacations: 0,
    unavailable: 0,
    total: 0,
  });
});

it("summaries disclose no titles, employee identities, raw IDs or notes", () => {
  const input = [record("sensitive-id", "availability", "Vacation")];
  input[0].data.notes = "PRIVATE NOTE";
  input[0].data.employee = "private-person";
  const output = JSON.stringify(summarizeAvailabilityPeriodTypes(input));
  for (const secret of ["sensitive-id", "Private period", "private-person", "PRIVATE NOTE"]) {
    expect(output).not.toContain(secret);
  }
});
