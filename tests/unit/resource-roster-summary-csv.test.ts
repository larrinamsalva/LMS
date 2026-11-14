import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import type { ResourceMembershipCsvView } from "../../src/core/resource-membership-review-csv";
import { filteredRosterResourceSummaryCsv } from "../../src/core/resource-roster-summary-csv";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
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
const view: ResourceMembershipCsvView = {
  archivedResources: false, resourceSearch: "", resourceKind: "all",
  enrollment: "all", mode: "all", membershipStatus: "all",
  memberSearch: "", onlyMatchingResources: false,
  onlyWithoutMatchingResources: false, resourceSort: "directory",
  sort: "retained", date: "",
};
const records: WorkspaceRecord[] = [
  record("resources", "crew-a", { kind: "Crew", name: "Blue Crew", notes: "PRIVATE CREW" }),
  record("resources", "worker-b", { kind: "Worker", name: "East Worker" }),
  record("resources", "equipment-c", { kind: "Equipment", name: "Floor buffer" }),
  record("resources", "retired", { kind: "Crew", name: "Retired Crew" }, true),
  record("resources", "foreign", { kind: "Crew", name: "FOREIGN RESOURCE" },
    false, FOREIGN),
  record("employees", "person-a", {
    name: "Avery Example", email: "PRIVATE@EXAMPLE.TEST", phone: "555-0171",
  }),
  record("employees", "person-b", {
    name: "Morgan Example", skills: "PRIVATE SKILLS",
  }),
  record("resource-memberships", "first", {
    resource: "crew-a", employee: "person-a", title: "Morning setup",
    start: "2026-11-06T18:00:00Z", end: "2026-11-06T22:00:00Z",
    notes: "PRIVATE MEMBERSHIP NOTE",
  }),
  record("resource-memberships", "second", {
    resource: "crew-a", employee: "person-b", title: "Archived support",
    start: "2026-11-06T19:00:00Z", end: "2026-11-06T23:00:00Z",
  }, true),
  record("resource-memberships", "third", {
    resource: "worker-b", employee: "person-a", title: "Next day",
    start: "2026-11-07T18:00:00Z", end: "2026-11-07T22:00:00Z",
  }),
  record("resource-memberships", "retired-link", {
    resource: "retired", employee: "person-b", title: "Old roster",
    start: "2026-11-06T16:00:00Z", end: "2026-11-06T19:00:00Z",
  }, true),
  record("resource-memberships", "foreign-member", {
    resource: "crew-a", employee: "person-b", title: "FOREIGN PRIVATE LINK",
    start: "2026-11-06T18:00:00Z", end: "2026-11-06T22:00:00Z",
  }, false, FOREIGN),
  record("resource-memberships", "foreign-resource-link", {
    resource: "foreign", employee: "person-b", title: "FOREIGN ROSTER",
    start: "2026-11-06T18:00:00Z", end: "2026-11-06T22:00:00Z",
  }, false, FOREIGN),
];

function lines(v: ResourceMembershipCsvView, zone = "America/Los_Angeles") {
  return filteredRosterResourceSummaryCsv(records, ORG, zone, v)
    .trimEnd().split("\r\n");
}

it("exports authorized resources once each with retained and matched record counts", () => {
  const before = structuredClone(records);
  const all = lines(view);
  expect(all).toHaveLength(4);
  expect(all[0]).toContain('"All retained membership records"');
  expect(all[0]).toContain('"Matching current records"');
  expect(all[1]).toContain(
    '"Blue Crew","Crew","Current","Enrolled","2","2","1","1"',
  );
  expect(all[2]).toContain(
    '"East Worker","Worker","Current","Enrolled","1","1","1","0"',
  );
  expect(all[3]).toContain(
    '"Floor buffer","Equipment","Current","Not applicable","0","0","0","0"',
  );
  const csv = all.join("\r\n");
  for (const secret of [
    "PRIVATE", "FOREIGN", "Avery Example", "Morgan Example",
    "555-0171", "person-a", "person-b", "crew-a", "first", "second",
  ]) expect(csv).not.toContain(secret);
  expect(records).toEqual(before);
});

it("retains zero-match resource rows unless match-only is enabled", () => {
  const localDay = {
    ...view, mode: "overlapping-day" as const, date: "2026-11-06",
  };
  const all = lines(localDay);
  expect(all).toHaveLength(4);
  expect(all[0]).toContain('"Membership review day (business local)"');
  expect(all[1]).toContain(
    '"Blue Crew","Crew","Current","Enrolled","2","2","1","1"',
  );
  expect(all[2]).toContain(
    '"East Worker","Worker","Current","Enrolled","1","0","0","0"',
  );
  expect(all[3]).toContain(
    '"Floor buffer","Equipment","Current","Not applicable","0","0","0","0"',
  );
  const matching = lines({ ...localDay, onlyMatchingResources: true });
  expect(matching).toHaveLength(2);
  expect(matching[1]).toContain('"Blue Crew"');
  const noMatches = lines({
    ...localDay, memberSearch: "not present",
  });
  expect(noMatches).toHaveLength(4);
  expect(noMatches.slice(1).every((line) =>
    line.includes('"0","0","0"'),
  )).toBe(true);
  expect(lines({
    ...localDay, memberSearch: "not present", onlyMatchingResources: true,
  })).toHaveLength(1);
});

it("combines current/archived filters, names and sorted resource grouping", () => {
  const archived = lines({
    ...view, resourceSearch: "Blue", membershipStatus: "archived",
    memberSearch: "Morgan",
  });
  expect(archived).toHaveLength(2);
  expect(archived[1]).toContain(
    '"Blue Crew","Crew","Current","Enrolled","2","1","0","1"',
  );
  const current = lines({
    ...view, resourceSearch: "Blue", membershipStatus: "current",
    memberSearch: "Avery",
  });
  expect(current[1]).toContain(
    '"Blue Crew","Crew","Current","Enrolled","2","1","1","0"',
  );
  const fewest = lines({ ...view, resourceSort: "fewest" });
  expect(fewest[1]).toContain('"Floor buffer"');
  expect(fewest[2]).toContain('"East Worker"');
  expect(fewest[3]).toContain('"Blue Crew"');
  const most = lines({ ...view, resourceSort: "most" });
  expect(most[1]).toContain('"Blue Crew"');
  expect(most[2]).toContain('"East Worker"');
  expect(most[3]).toContain('"Floor buffer"');
  const retired = lines({ ...view, archivedResources: true });
  expect(retired).toHaveLength(2);
  expect(retired[1]).toContain(
    '"Retired Crew","Crew","Archived","Enrolled","1","1","0","1"',
  );
  // Irrelevant row-level sort does not change one-row-per-resource aggregates.
  expect(lines({ ...view, sort: "newest" })).toEqual(lines(view));
});

it("rejects bad days/zones and protects spreadsheet formula cells", () => {
  expect(() => lines({
    ...view, mode: "overlapping-day", date: "2026-02-30",
  })).toThrow(/valid membership review date/);
  expect(() => lines(view, "Not/AZone")).toThrow(/valid business time zone/);
  for (const search of [
    "PRIVATE@EXAMPLE.TEST", "555-0171", "person-a",
    "FOREIGN PRIVATE LINK", "PRIVATE MEMBERSHIP NOTE",
  ]) {
    const result = lines({ ...view, resourceSearch: "Blue", memberSearch: search });
    expect(result).toHaveLength(2);
    expect(result[1]).toContain('"Enrolled","2","0","0","0"');
  }
  const risky = [
    record("resources", "formula-resource", {
      name: '=HYPERLINK("https://example.test","evil")',
      kind: "Crew",
    }),
  ];
  const csv = filteredRosterResourceSummaryCsv(risky, ORG, "UTC", view);
  expect(csv).toContain('"\'=HYPERLINK(');
  expect(csv).not.toContain('"=HYPERLINK(');
});

it("respects DST local-day overlap while excluding the following midnight", () => {
  const fold = [
    record("resources", "fold", { name: "Fold Crew", kind: "Crew" }),
    ...[
      ["first", "2026-11-01T08:30:00Z", "2026-11-01T08:45:00Z"],
      ["second", "2026-11-01T09:30:00Z", "2026-11-01T09:45:00Z"],
      ["tomorrow", "2026-11-02T08:00:00Z", "2026-11-02T08:45:00Z"],
    ].map(([id, start, end]) => record(
      "resource-memberships", id, {
        resource: "fold", employee: "unknown", title: id, start, end,
      },
    )),
  ];
  const csv = filteredRosterResourceSummaryCsv(
    fold, ORG, "America/Los_Angeles", {
      ...view, mode: "overlapping-day", date: "2026-11-01",
    },
  );
  expect(csv).toContain('"Fold Crew","Crew","Current","Enrolled","3","2","2","0"');
});

it("exports exactly zero-match resources, preserving their historical enrollment", () => {
  const noMatch = lines({ ...view, onlyWithoutMatchingResources: true });
  expect(noMatch).toHaveLength(2);
  expect(noMatch[1]).toContain(
    '"Floor buffer","Equipment","Current","Not applicable","0","0","0","0"',
  );
  const archivedOnly = lines({
    ...view, membershipStatus: "archived",
    onlyWithoutMatchingResources: true,
  });
  expect(archivedOnly).toHaveLength(3);
  expect(archivedOnly[1]).toContain(
    '"East Worker","Worker","Current","Enrolled","1","0","0","0"',
  );
  expect(archivedOnly[2]).toContain('"Floor buffer"');
  const dayWithout = lines({
    ...view, mode: "overlapping-day", date: "2026-11-06",
    onlyWithoutMatchingResources: true, resourceSort: "fewest",
  });
  expect(dayWithout).toHaveLength(3);
  expect(dayWithout[1]).toContain('"East Worker"');
  expect(dayWithout[2]).toContain('"Floor buffer"');
  for (const row of [...noMatch, ...archivedOnly, ...dayWithout]) {
    expect(row).not.toContain("FOREIGN");
    expect(row).not.toContain("PRIVATE");
  }
});

it("adds self-describing filter metadata without exposing search terms or private identities", () => {
  const before = structuredClone(records);
  const filtered = lines({
    ...view,
    resourceSearch: "BLU",
    membershipStatus: "archived",
    memberSearch: "Morgan Example",
    resourceKind: "Crew",
    enrollment: "enrolled",
    onlyMatchingResources: true,
    resourceSort: "most",
  });
  expect(filtered).toHaveLength(2);
  expect(filtered[0]).toContain('"Membership record status filter"');
  expect(filtered[0]).toContain('"Member name/title search applied"');
  expect(filtered[0]).toContain('"Resource name search applied"');
  expect(filtered[0]).toContain('"Resource card selection"');
  expect(filtered[1]).toContain('"Blue Crew","Crew","Current","Enrolled"');
  expect(filtered[1]).toContain(
    '"Archived records only","Yes","Yes","Crew","Enrolled only",' +
    '"Matching resources only","Most matching first"',
  );
  expect(filtered.join("\r\n")).not.toContain("Morgan Example");
  expect(filtered.join("\r\n")).not.toContain("BLU");
  expect(filtered.join("\r\n")).not.toContain("PRIVATE");
  expect(records).toEqual(before);
});

it("describes no-match and default selections with stable vocabulary", () => {
  const all = lines(view);
  expect(all[1]).toContain(
    '"All retained records","No","No","All types",' +
    '"All enrollment types","All selected resources","Directory order"',
  );
  const gap = lines({
    ...view,
    membershipStatus: "archived",
    resourceKind: "Equipment",
    enrollment: "all",
    onlyWithoutMatchingResources: true,
    resourceSort: "fewest",
  });
  expect(gap).toHaveLength(2);
  expect(gap[1]).toContain('"Floor buffer"');
  expect(gap[1]).toContain(
    '"Archived records only","No","No","Equipment",' +
    '"All enrollment types","Resources without matches only",' +
    '"Fewest matching first"',
  );
  const noMatches = lines({
    ...view,
    memberSearch: "secret@example.test",
    onlyMatchingResources: true,
  });
  expect(noMatches).toHaveLength(1);
  expect(noMatches[0]).toContain('"Member name/title search applied"');
  expect(noMatches[0]).not.toContain("secret@example.test");
});
