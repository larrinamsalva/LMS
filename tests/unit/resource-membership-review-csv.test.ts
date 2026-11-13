import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import {
  filteredResourceMembershipsCsv,
  type ResourceMembershipCsvView,
} from "../../src/core/resource-membership-review-csv";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function record(
  entity: string, id: string, data: WorkspaceRecord["data"],
  archived = false, organization_id = ORG,
): WorkspaceRecord {
  return {
    id, entity, data, archived, organization_id, revision: 1,
    config_revision: 1, created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };
}
const view: ResourceMembershipCsvView = {
  archivedResources: false, resourceSearch: "", resourceKind: "all",
  enrollment: "all", mode: "all", membershipStatus: "all",
  sort: "retained", resourceSort: "directory", memberSearch: "",
  onlyMatchingResources: false, date: "",
};
const records: WorkspaceRecord[] = [
  record("resources", "crew-a", {
    name: "Blue Crew", kind: "Crew", notes: "PRIVATE CREW NOTE",
  }),
  record("resources", "worker-b", { name: "East Worker", kind: "Worker" }),
  record("resources", "machine", { name: "Floor buffer", kind: "Equipment" }),
  record("resources", "retired", { name: "Retired Crew", kind: "Crew" }, true),
  record("employees", "employee-a", {
    name: "Avery Example", email: "PRIVATE@EXAMPLE.COM",
    phone: "555-0123", skills: "PRIVATE SKILLS",
  }),
  record("employees", "employee-b", { name: "Morgan Example" }),
  record("employees", "foreign-person", { name: "FOREIGN PRIVATE PERSON" }, false, OTHER),
  record("resource-memberships", "first", {
    title: "Morning roster", resource: "crew-a", employee: "employee-a",
    start: "2026-11-06T18:00:00Z", end: "2026-11-06T22:00:00Z",
    notes: "PRIVATE MEMBERSHIP NOTE",
  }),
  record("resource-memberships", "late", {
    title: "Archived past membership", resource: "crew-a", employee: "employee-b",
    start: "2026-11-03T16:00:00Z", end: "2026-11-03T18:00:00Z",
  }, true),
  record("resource-memberships", "worker-link", {
    title: "East shift", resource: "worker-b", employee: "employee-a",
    start: "2026-11-06T18:00:00Z", end: "2026-11-06T20:00:00Z",
  }),
  record("resource-memberships", "retired-link", {
    title: "Retired shift", resource: "retired", employee: "employee-b",
    start: "2026-11-06T16:00:00Z", end: "2026-11-06T20:00:00Z",
  }, true),
  record("resource-memberships", "foreign-membership", {
    title: "FOREIGN MEMBERSHIP", resource: "crew-a", employee: "foreign-person",
    start: "2026-11-06T18:00:00Z", end: "2026-11-06T20:00:00Z",
  }, false, OTHER),
  record("resources", "foreign-crew", {
    name: "FOREIGN RESOURCE", kind: "Crew",
  }, false, OTHER),
  record("resource-memberships", "foreign-resource-member", {
    title: "FOREIGN RESOURCE MEMBER", resource: "foreign-crew",
    employee: "employee-a", start: "2026-11-06T18:00:00Z",
    end: "2026-11-06T20:00:00Z",
  }, false, OTHER),
];

it("exports only authorized retained resource membership entries, including archived rows", () => {
  const before = structuredClone(records);
  const csv = filteredResourceMembershipsCsv(
    records, ORG, "America/Los_Angeles", view,
  );
  const lines = csv.trimEnd().split("\r\n");
  expect(lines).toHaveLength(4); // Header + 2 Blue Crew entries + East Worker
  expect(lines[0]).toContain('"Resource name"');
  expect(lines[0]).toContain('"Employee name"');
  expect(lines[1]).toContain('"Blue Crew","Crew","Current","Enrolled","Morning roster","Avery Example","Current"');
  expect(lines[2]).toContain('"Blue Crew","Crew","Current","Enrolled","Archived past membership","Morgan Example","Archived"');
  expect(lines[3]).toContain('"East Worker","Worker","Current","Enrolled","East shift","Avery Example","Current"');
  for (const secret of [
    "FOREIGN", "PRIVATE", "555-0123", "first", "late", "worker-link",
    "crew-a", "employee-a", "membership-id", "Floor buffer",
  ]) expect(csv).not.toContain(secret);
  expect(records).toEqual(before);
});

it("reapplies resource filters and selected local day before exporting", () => {
  const selected = filteredResourceMembershipsCsv(
    records, ORG, "America/Los_Angeles", {
      ...view, resourceSearch: " blue ", resourceKind: "Crew",
      enrollment: "enrolled", mode: "overlapping-day", date: "2026-11-06",
    },
  );
  const lines = selected.trimEnd().split("\r\n");
  expect(lines).toHaveLength(2);
  expect(selected).toContain('"Overlapping selected day","2026-11-06","Blue Crew"');
  expect(selected).toContain('"Morning roster"');
  expect(selected).not.toContain("Archived past membership");
  expect(selected).not.toContain("East Worker");
  expect(selected).toContain('"2026-11-06T10:00"');
  expect(selected).toContain('"2026-11-06T18:00:00Z"');

  const archive = filteredResourceMembershipsCsv(
    records, ORG, "UTC", { ...view, archivedResources: true },
  );
  expect(archive).toContain('"Retired Crew","Crew","Archived"');
  expect(archive).not.toContain("Blue Crew");
  const equipmentOnly = filteredResourceMembershipsCsv(
    records, ORG, "UTC", { ...view, resourceKind: "Equipment" },
  );
  expect(equipmentOnly.trimEnd().split("\r\n")).toHaveLength(1);
  const noMatch = filteredResourceMembershipsCsv(
    records, ORG, "UTC", { ...view, resourceSearch: "does not exist" },
  );
  expect(noMatch.trimEnd().split("\r\n")).toHaveLength(1);
});

it("retains true local-day midnight and DST fold overlap semantics", () => {
  const fold = [
    record("resources", "fold-crew", { name: "Fold Crew", kind: "Crew" }),
    record("resource-memberships", "first-fold", {
      resource: "fold-crew", employee: "unknown",
      title: "First fold", start: "2026-11-01T08:30:00Z",
      end: "2026-11-01T08:40:00Z",
    }),
    record("resource-memberships", "second-fold", {
      resource: "fold-crew", employee: "unknown",
      title: "Second fold", start: "2026-11-01T09:30:00Z",
      end: "2026-11-01T09:40:00Z",
    }),
    record("resource-memberships", "next-day", {
      resource: "fold-crew", employee: "unknown", title: "Tomorrow",
      start: "2026-11-02T08:00:00Z", end: "2026-11-02T08:40:00Z",
    }),
  ];
  const csv = filteredResourceMembershipsCsv(
    fold, ORG, "America/Los_Angeles", {
      ...view, mode: "overlapping-day", date: "2026-11-01",
    },
  );
  expect(csv.trimEnd().split("\r\n")).toHaveLength(3);
  expect(csv).toContain("First fold");
  expect(csv).toContain("Second fold");
  expect(csv).not.toContain("Tomorrow");
  expect(csv).toContain('"2026-11-01T08:30:00Z"');
  expect(csv).toContain('"2026-11-01T09:30:00Z"');
  // Both distinct UTC instants have the same local 01:30 wall time.
  expect(csv.match(/2026-11-01T01:30/g)).toHaveLength(2);
});

it("refuses invalid selected days, neutralizes formulas, never leaks foreign linked employee names", () => {
  expect(() => filteredResourceMembershipsCsv(
    records, ORG, "UTC", {
      ...view, mode: "overlapping-day", date: "2026-02-30",
    },
  )).toThrow(/valid membership review date/);
  expect(() => filteredResourceMembershipsCsv(
    records, ORG, "Not/AZone", view,
  )).toThrow(/valid business time zone/);
  const malicious = [
    record("resources", "crew", { name: "@Danger", kind: "Crew" }),
    record("resource-memberships", "member", {
      title: "=1+2", resource: "crew", employee: "foreign-person",
      start: "2026-11-06T18:00:00Z", end: "2026-11-06T20:00:00Z",
    }),
    record("employees", "foreign-person", { name: "FOREIGN PERSON" }, false, OTHER),
  ];
  const csv = filteredResourceMembershipsCsv(malicious, ORG, "UTC", view);
  expect(csv).toContain("\"'@Danger\"");
  expect(csv).toContain("\"'=1+2\"");
  expect(csv).not.toContain("FOREIGN PERSON");
  expect(csv).not.toContain("foreign-person");
});


it("combines membership archive status with resource filters, date review and CSV rows", () => {
  const all = filteredResourceMembershipsCsv(
    records, ORG, "America/Los_Angeles", {
      ...view, resourceSearch: "Blue Crew",
    },
  );
  expect(all.trimEnd().split("\r\n")).toHaveLength(3);
  const active = filteredResourceMembershipsCsv(
    records, ORG, "America/Los_Angeles", {
      ...view, resourceSearch: "Blue Crew", membershipStatus: "current",
    },
  );
  expect(active.trimEnd().split("\r\n")).toHaveLength(2);
  expect(active).toContain("Morning roster");
  expect(active).not.toContain("Archived past membership");
  const archive = filteredResourceMembershipsCsv(
    records, ORG, "America/Los_Angeles", {
      ...view, resourceSearch: "Blue Crew", membershipStatus: "archived",
    },
  );
  expect(archive.trimEnd().split("\r\n")).toHaveLength(2);
  expect(archive).toContain("Archived past membership");
  expect(archive).not.toContain("Morning roster");
  expect(archive).toContain('"Enrolled"');
  const onDay = filteredResourceMembershipsCsv(
    records, ORG, "America/Los_Angeles", {
      ...view, resourceSearch: "Blue Crew",
      membershipStatus: "archived",
      mode: "overlapping-day", date: "2026-11-06",
    },
  );
  expect(onDay.trimEnd().split("\r\n")).toHaveLength(1);
  const past = filteredResourceMembershipsCsv(
    records, ORG, "America/Los_Angeles", {
      ...view, resourceSearch: "Blue Crew",
      membershipStatus: "archived",
      mode: "overlapping-day", date: "2026-11-03",
    },
  );
  expect(past.trimEnd().split("\r\n")).toHaveLength(2);
  expect(past).toContain("Archived past membership");
  for (const secret of ["FOREIGN", "PRIVATE", "employee-b", "crew-a"]) {
    expect(past).not.toContain(secret);
  }
  expect(filteredResourceMembershipsCsv(
    records, ORG, "America/Los_Angeles", {
      ...view, resourceSearch: "Blue Crew", membershipStatus: "all",
    },
  )).toBe(all);
});


it("exports each resource's retained rows in effective-start order after status/date filters", () => {
  const original = filteredResourceMembershipsCsv(
    records, ORG, "America/Los_Angeles", {
      ...view, resourceSearch: "Blue Crew",
    },
  );
  expect(original.indexOf("Morning roster")).toBeLessThan(
    original.indexOf("Archived past membership"),
  );
  const oldest = filteredResourceMembershipsCsv(
    records, ORG, "America/Los_Angeles", {
      ...view, resourceSearch: "Blue Crew", sort: "oldest",
    },
  );
  expect(oldest.indexOf("Archived past membership")).toBeLessThan(
    oldest.indexOf("Morning roster"),
  );
  const newest = filteredResourceMembershipsCsv(
    records, ORG, "America/Los_Angeles", {
      ...view, resourceSearch: "Blue Crew", sort: "newest",
    },
  );
  expect(newest.indexOf("Morning roster")).toBeLessThan(
    newest.indexOf("Archived past membership"),
  );
  const statusFiltered = filteredResourceMembershipsCsv(
    records, ORG, "America/Los_Angeles", {
      ...view, resourceSearch: "Blue Crew", sort: "oldest",
      membershipStatus: "current",
      mode: "overlapping-day", date: "2026-11-06",
    },
  );
  expect(statusFiltered.trimEnd().split("\r\n")).toHaveLength(2);
  expect(statusFiltered).toContain('"Morning roster"');
  expect(statusFiltered).not.toContain("Archived past membership");
  expect(original).not.toBe(oldest);
  for (const secret of ["FOREIGN", "PRIVATE", "crew-a", "employee-a"]) {
    expect(oldest).not.toContain(secret);
  }
});


it("applies title and employee-name search after roster date/status filters without leaking contact or foreign data", () => {
  const byEmployee = filteredResourceMembershipsCsv(
    records, ORG, "America/Los_Angeles", {
      ...view, resourceSearch: "blue", memberSearch: "  AVEry  ",
    },
  );
  expect(byEmployee.trimEnd().split("\r\n")).toHaveLength(2);
  expect(byEmployee).toContain('"Morning roster","Avery Example"');
  expect(byEmployee).not.toContain("Archived past membership");

  const byTitle = filteredResourceMembershipsCsv(
    records, ORG, "America/Los_Angeles", {
      ...view, resourceSearch: "blue", memberSearch: "past membership",
      membershipStatus: "archived", sort: "newest",
    },
  );
  expect(byTitle.trimEnd().split("\r\n")).toHaveLength(2);
  expect(byTitle).toContain('"Archived past membership","Morgan Example"');
  expect(byTitle).not.toContain("Morning roster");

  const onDay = filteredResourceMembershipsCsv(
    records, ORG, "America/Los_Angeles", {
      ...view, resourceSearch: "blue", memberSearch: "morgan",
      mode: "overlapping-day", date: "2026-11-06",
    },
  );
  expect(onDay.trimEnd().split("\r\n")).toHaveLength(1);
  for (const secret of [
    "PRIVATE@EXAMPLE.COM", "PRIVATE MEMBERSHIP NOTE", "employee-a",
    "employee-b", "FOREIGN PRIVATE PERSON", "foreign-person",
  ]) {
    expect(byEmployee).not.toContain(secret);
    expect(byTitle).not.toContain(secret);
  }
  const notSearchable = [
    "PRIVATE@EXAMPLE.COM", "PRIVATE MEMBERSHIP NOTE", "employee-a",
    "foreign-person", "FOREIGN PRIVATE PERSON",
  ];
  for (const memberSearch of notSearchable) {
    const csv = filteredResourceMembershipsCsv(
      records, ORG, "America/Los_Angeles", {
        ...view, resourceSearch: "Blue Crew", memberSearch,
      },
    );
    expect(csv.trimEnd().split("\r\n")).toHaveLength(1);
  }
});


it("match-only resources option recomputes scoped roster search and preserves exported membership rows", () => {
  const all = filteredResourceMembershipsCsv(records, ORG, "UTC", view);
  const matching = filteredResourceMembershipsCsv(
    records, ORG, "UTC", { ...view, onlyMatchingResources: true },
  );
  // Resource cards without any matching membership have no CSV detail rows,
  // regardless of whether the UI shows them as empty cards.
  expect(matching).toBe(all);
  const selected = filteredResourceMembershipsCsv(
    records, ORG, "America/Los_Angeles", {
      ...view, onlyMatchingResources: true, memberSearch: "Morgan",
      membershipStatus: "archived", mode: "overlapping-day",
      date: "2026-11-03",
    },
  );
  expect(selected.trimEnd().split("\r\n")).toHaveLength(2);
  expect(selected).toContain('"Archived past membership","Morgan Example"');
  expect(selected).not.toContain("Morning roster");
  const empty = filteredResourceMembershipsCsv(
    records, ORG, "America/Los_Angeles", {
      ...view, onlyMatchingResources: true,
      memberSearch: "not found anywhere",
    },
  );
  expect(empty.trimEnd().split("\r\n")).toHaveLength(1);
  for (const hidden of [
    "PRIVATE@EXAMPLE.COM", "PRIVATE MEMBERSHIP NOTE",
    "FOREIGN PRIVATE PERSON", "crew-a", "employee-a",
  ]) expect(selected).not.toContain(hidden);
});


it("follows stable resource-card matching-count order in CSV without changing matching details", () => {
  const original = filteredResourceMembershipsCsv(
    records, ORG, "America/Los_Angeles", view,
  );
  const most = filteredResourceMembershipsCsv(
    records, ORG, "America/Los_Angeles", {
      ...view, resourceSort: "most",
    },
  );
  const fewest = filteredResourceMembershipsCsv(
    records, ORG, "America/Los_Angeles", {
      ...view, resourceSort: "fewest",
    },
  );
  expect(most).toBe(original);
  expect(fewest.indexOf('"East Worker"')).toBeLessThan(
    fewest.indexOf('"Blue Crew"'),
  );
  expect(original.indexOf('"Blue Crew"')).toBeLessThan(
    original.indexOf('"East Worker"'),
  );
  expect(original.trimEnd().split("\r\n")).toHaveLength(4);
  expect(most.trimEnd().split("\r\n")).toHaveLength(4);
  expect(fewest.trimEnd().split("\r\n")).toHaveLength(4);

  const day = filteredResourceMembershipsCsv(
    records, ORG, "America/Los_Angeles", {
      ...view, mode: "overlapping-day", date: "2026-11-06",
      resourceSort: "fewest", memberSearch: "Avery",
      membershipStatus: "current", onlyMatchingResources: true,
    },
  );
  expect(day.trimEnd().split("\r\n")).toHaveLength(3);
  expect(day.indexOf('"Blue Crew"')).toBeLessThan(
    day.indexOf('"East Worker"'),
  ); // stable tie: one matching record in each resource
  for (const secret of [
    "FOREIGN", "PRIVATE", "555-0123", "employee-a", "crew-a",
  ]) {
    expect(fewest).not.toContain(secret);
    expect(day).not.toContain(secret);
  }
});
