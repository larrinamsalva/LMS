import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import {
  summarizeMatchingRosterMemberships,
  type MatchingRosterResourceView,
} from "../../src/core/resource-membership-review";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function record(
  entity: string, id: string, data: WorkspaceRecord["data"],
  archived = false, organization_id = ORG,
): WorkspaceRecord {
  return {
    entity, id, data, archived, organization_id,
    revision: 1, config_revision: 1,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };
}
const resources: WorkspaceRecord[] = [
  record("resources", "crew-a", { kind: "Crew", name: "Blue Crew" }),
  record("resources", "worker-b", { kind: "Worker", name: "Morning Worker" }),
  record("resources", "foreign-crew", { kind: "Crew", name: "PRIVATE FOREIGN" },
    false, OTHER),
];
const memberships: WorkspaceRecord[] = [
  record("resource-memberships", "current-a", {
    resource: "crew-a", employee: "employee-a", title: "Morning setup",
    start: "2026-11-06T08:00:00Z", end: "2026-11-06T12:00:00Z",
  }),
  record("resource-memberships", "archived-a", {
    resource: "crew-a", employee: "employee-b", title: "Historic help",
    start: "2026-11-06T10:00:00Z", end: "2026-11-06T14:00:00Z",
  }, true),
  record("resource-memberships", "current-b", {
    resource: "worker-b", employee: "employee-b", title: "Next-day setup",
    start: "2026-11-07T08:00:00Z", end: "2026-11-07T12:00:00Z",
  }),
  record("resource-memberships", "foreign-same-id", {
    resource: "crew-a", employee: "foreign-person", title: "FOREIGN PRIVATE",
    start: "2026-11-06T08:00:00Z", end: "2026-11-06T12:00:00Z",
  }, false, OTHER),
  record("resource-memberships", "foreign-resource-row", {
    resource: "foreign-crew", employee: "employee-b", title: "FOREIGN SHIFT",
    start: "2026-11-06T08:00:00Z", end: "2026-11-06T12:00:00Z",
  }, false, OTHER),
];
const linked: WorkspaceRecord[] = [
  record("employees", "employee-a", {
    name: "Avery Example", phone: "555-1234",
  }),
  record("employees", "employee-b", { name: "Morgan Example" }),
  record("employees", "foreign-person", {
    name: "FOREIGN PRIVATE", email: "secret@example.test",
  }, false, OTHER),
];
const day: MatchingRosterResourceView = {
  mode: "overlapping-day", date: "2026-11-06", zone: "UTC",
  status: "all", search: "",
};

it("counts only authorized filtered resource cards and matching retained membership records", () => {
  const before = structuredClone({ resources, memberships, linked });
  const result = summarizeMatchingRosterMemberships(
    resources, memberships, linked, ORG, day,
  );
  expect(result).toEqual({
    directoryResources: 2,
    matchingResources: 1,
    matchingMemberships: 2,
    currentMemberships: 1,
    archivedMemberships: 1,
  });
  expect(summarizeMatchingRosterMemberships(
    resources, memberships, linked, ORG,
    { ...day, mode: "all", date: "" },
  )).toEqual({
    directoryResources: 2,
    matchingResources: 2,
    matchingMemberships: 3,
    currentMemberships: 2,
    archivedMemberships: 1,
  });
  expect({ resources, memberships, linked }).toEqual(before);
});

it("combines day, membership archive-state, title and same-org employee search", () => {
  const overview = (view: MatchingRosterResourceView) =>
    summarizeMatchingRosterMemberships(
      resources, memberships, linked, ORG, view,
    );
  expect(overview({ ...day, status: "archived" })).toMatchObject({
    matchingResources: 1, matchingMemberships: 1,
    currentMemberships: 0, archivedMemberships: 1,
  });
  expect(overview({ ...day, status: "current" })).toMatchObject({
    matchingResources: 1, matchingMemberships: 1,
    currentMemberships: 1, archivedMemberships: 0,
  });
  expect(overview({ ...day, search: "  mORgan " })).toMatchObject({
    matchingResources: 1, matchingMemberships: 1,
    currentMemberships: 0, archivedMemberships: 1,
  });
  expect(overview({ ...day, search: "morning SETUP" })).toMatchObject({
    matchingResources: 1, matchingMemberships: 1,
    currentMemberships: 1, archivedMemberships: 0,
  });
  for (const search of ["FOREIGN PRIVATE", "555-1234", "secret@example.test"]) {
    expect(overview({ ...day, search })).toMatchObject({
      directoryResources: 2, matchingResources: 0,
      matchingMemberships: 0, currentMemberships: 0,
      archivedMemberships: 0,
    });
  }
  expect(overview({ ...day, date: "2026-11-08" })).toMatchObject({
    directoryResources: 2, matchingResources: 0,
    matchingMemberships: 0,
  });
  expect(overview({ ...day, date: "2026-02-30" })).toMatchObject({
    directoryResources: 2, matchingResources: 0,
    matchingMemberships: 0,
  });
});

it("counts only the caller-selected directory resources, without changing any stored record", () => {
  const selection = [resources[0], resources[2]];
  const result = summarizeMatchingRosterMemberships(
    selection, memberships, linked, ORG, {
      ...day, mode: "all",
    },
  );
  expect(result).toEqual({
    directoryResources: 1,
    matchingResources: 1,
    matchingMemberships: 2,
    currentMemberships: 1,
    archivedMemberships: 1,
  });
  expect(selection).toHaveLength(2);
});
