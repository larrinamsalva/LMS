import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import {
  summarizeMatchingRosterMemberships,
  orderRosterResourcesByMatchingCount,
  resourcesWithoutMatchingRosterMemberships,
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


it("stably orders resource cards by matching roster record count, never headcount", () => {
  const extra = record("resources", "crew-empty", {
    kind: "Crew", name: "Empty Crew",
  });
  const source = [resources[1], extra, resources[0], resources[2]];
  const original = structuredClone({ source, memberships, linked });
  const ids = (sort: "directory" | "most" | "fewest", v = day) =>
    orderRosterResourcesByMatchingCount(
      source, memberships, linked, ORG, v, sort,
    ).map((r) => r.id);
  expect(ids("directory")).toEqual(["worker-b", "crew-empty", "crew-a"]);
  expect(ids("most")).toEqual(["crew-a", "worker-b", "crew-empty"]);
  expect(ids("fewest")).toEqual(["worker-b", "crew-empty", "crew-a"]);
  // Same matching count preserves the directory's previous order.
  expect(ids("most", { ...day, status: "current" })).toEqual([
    "crew-a", "worker-b", "crew-empty",
  ]);
  expect(ids("fewest", { ...day, mode: "all" })).toEqual([
    "crew-empty", "worker-b", "crew-a",
  ]);
  expect(ids("most", { ...day, mode: "all" })).toEqual([
    "crew-a", "worker-b", "crew-empty",
  ]);
  expect(ids("most", { ...day, search: "Morgan" })).toEqual([
    "crew-a", "worker-b", "crew-empty",
  ]);
  expect(ids("fewest", { ...day, search: "Morgan" })).toEqual([
    "worker-b", "crew-empty", "crew-a",
  ]);
  // An invalid selected date yields all zero counts and stable order.
  expect(ids("most", { ...day, date: "2026-02-30" })).toEqual([
    "worker-b", "crew-empty", "crew-a",
  ]);
  expect({ source, memberships, linked }).toEqual(original);
});

it("keeps stable ties and ignores foreign matches or private linked search terms", () => {
  const rows = [
    resources[1],
    resources[0],
    resources[2],
  ];
  const order = (sort: "most" | "fewest", v: MatchingRosterResourceView) =>
    orderRosterResourcesByMatchingCount(
      rows, memberships, linked, ORG, v, sort,
    ).map((r) => r.id);
  // On all-history current status each local resource has one record.
  expect(order("most", {
    ...day, mode: "all", status: "current",
  })).toEqual(["worker-b", "crew-a"]);
  expect(order("fewest", {
    ...day, mode: "all", status: "current",
  })).toEqual(["worker-b", "crew-a"]);
  for (const query of ["FOREIGN PRIVATE", "secret@example.test", "555-1234"]) {
    expect(order("most", {
      ...day, search: query,
    })).toEqual(["worker-b", "crew-a"]);
  }
});

it("per-resource matching current/archived breakdown agrees with overview totals under all roster filters", () => {
  const selections = [resources[0], resources[1]];
  const inputSnapshot = structuredClone({ selections, memberships, linked });
  const scenarios: Array<{
    view: MatchingRosterResourceView;
    blue: [number, number];
    worker: [number, number];
  }> = [
    { view: { ...day, mode: "all" }, blue: [1, 1], worker: [1, 0] },
    { view: day, blue: [1, 1], worker: [0, 0] },
    { view: { ...day, status: "archived" }, blue: [0, 1], worker: [0, 0] },
    { view: { ...day, status: "current" }, blue: [1, 0], worker: [0, 0] },
    { view: { ...day, search: "Morgan" }, blue: [0, 1], worker: [0, 0] },
    { view: { ...day, date: "2026-11-08" }, blue: [0, 0], worker: [0, 0] },
  ];
  for (const scenario of scenarios) {
    const one = (resource: WorkspaceRecord) =>
      summarizeMatchingRosterMemberships(
        [resource, resources[2]], memberships, linked, ORG, scenario.view,
      );
    const blue = one(selections[0]);
    const worker = one(selections[1]);
    expect([blue.currentMemberships, blue.archivedMemberships])
      .toEqual(scenario.blue);
    expect([worker.currentMemberships, worker.archivedMemberships])
      .toEqual(scenario.worker);
    expect(blue.matchingMemberships).toBe(scenario.blue[0] + scenario.blue[1]);
    expect(worker.matchingMemberships).toBe(
      scenario.worker[0] + scenario.worker[1],
    );
    const all = summarizeMatchingRosterMemberships(
      selections, memberships, linked, ORG, scenario.view,
    );
    expect(all.currentMemberships)
      .toBe(blue.currentMemberships + worker.currentMemberships);
    expect(all.archivedMemberships)
      .toBe(blue.archivedMemberships + worker.archivedMemberships);
  }
  expect({ selections, memberships, linked }).toEqual(inputSnapshot);
});


it("selects only current-organization resources with zero matching retained roster rows", () => {
  const mixed = [resources[1], resources[2], resources[0]];
  const before = structuredClone({ mixed, memberships, linked });
  const ids = (view: MatchingRosterResourceView) =>
    resourcesWithoutMatchingRosterMemberships(
      mixed, memberships, linked, ORG, view,
    ).map((r) => r.id);
  expect(ids(day)).toEqual(["worker-b"]);
  expect(ids({ ...day, mode: "all" })).toEqual([]);
  expect(ids({ ...day, status: "current" })).toEqual(["worker-b"]);
  expect(ids({ ...day, status: "archived" })).toEqual(["worker-b"]);
  expect(ids({ ...day, search: "Morgan" })).toEqual(["worker-b"]);
  expect(ids({ ...day, search: "FOREIGN PRIVATE" }))
    .toEqual(["worker-b", "crew-a"]);
  expect(ids({ ...day, search: "555-1234" }))
    .toEqual(["worker-b", "crew-a"]);
  expect(ids({ ...day, date: "2026-11-08" }))
    .toEqual(["worker-b", "crew-a"]);
  expect(ids({ ...day, date: "2026-02-30" }))
    .toEqual(["worker-b", "crew-a"]);
  expect({ mixed, memberships, linked }).toEqual(before);
});
