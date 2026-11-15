import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import {
  filterWorkforceResourceDirectory,
  type WorkforceResourceEnrollmentFilter,
  type WorkforceResourceTypeFilter,
} from "../../src/core/workforce-resource-directory";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function record(
  id: string, entity: string, data: WorkspaceRecord["data"],
  organization_id = ORG, archived = false,
): WorkspaceRecord {
  return {
    id, entity, data, organization_id, archived,
    revision: 1, config_revision: 1,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };
}

// Independent implementation copied from merged, five-green LMS #169.
// Its nonblank search lowercases each resource name independently.
function previousDirectory(
  resources: readonly WorkspaceRecord[],
  memberships: readonly WorkspaceRecord[],
  showArchived: boolean,
  search: string,
  kind: WorkforceResourceTypeFilter = "all",
  enrollment: WorkforceResourceEnrollmentFilter = "all",
): WorkspaceRecord[] {
  const query = search.trim().toLocaleLowerCase();
  const enrolledByOrganization = new Map<string, Set<string>>();
  if (enrollment !== "all") {
    for (const membership of memberships) {
      if (membership.entity !== "resource-memberships" ||
          typeof membership.data.resource !== "string") continue;
      let enrolled = enrolledByOrganization.get(membership.organization_id);
      if (!enrolled) {
        enrolled = new Set<string>();
        enrolledByOrganization.set(membership.organization_id, enrolled);
      }
      enrolled.add(membership.data.resource);
    }
  }
  return resources.filter((resource) => {
    if (resource.entity !== "resources" ||
        resource.archived !== showArchived) return false;
    const resourceKind = resource.data.kind;
    if (resourceKind !== "Worker" && resourceKind !== "Crew" &&
        resourceKind !== "Equipment") return false;
    if (kind !== "all" && resourceKind !== kind) return false;
    if (enrollment !== "all") {
      if (resourceKind === "Equipment") return false;
      const everEnrolled =
        enrolledByOrganization.get(resource.organization_id)?.has(resource.id) ?? false;
      if (enrollment === "enrolled" && !everEnrolled) return false;
      if (enrollment === "resource-only" && everEnrolled) return false;
    }
    if (!query) return true;
    return typeof resource.data.name === "string" &&
      resource.data.name.toLocaleLowerCase().includes(query);
  });
}

it("preserves exact Resource Directory references across 720 fictional resource cards", () => {
  const names: Array<string | number> = [
    "Blue Crew", "BLUE CREW", "Night Crew", "Floor Machine",
    "Worker Team", "İSTANBUL Crew", "Café Crew", "MÜNCHEN Team",
    "=Fictional Formula", "Archived Crew", "", 123,
  ];
  const resources: WorkspaceRecord[] = Array.from({ length: 720 }, (_, i) =>
    record(
      "resource-" + (i % 251),
      i % 43 === 0 ? "employees" : "resources",
      {
        name: names[i % names.length],
        kind: i % 41 === 0 ? "Invalid"
          : i % 3 === 0 ? "Worker"
            : i % 3 === 1 ? "Crew" : "Equipment",
        phone: "PRIVATE PHONE", notes: "PRIVATE NOTES",
      },
      i % 17 === 0 ? FOREIGN : ORG,
      i % 5 === 0,
    ),
  );
  const memberships: WorkspaceRecord[] = Array.from(
    { length: 900 }, (_, i) => record(
      "membership-" + i,
      i % 53 === 0 ? "availability" : "resource-memberships",
      {
        resource: i % 37 === 0 ? 12 : "resource-" + (i % 251),
        employee: "employee-" + i, title: "Historical enrollment " + i,
      },
      i % 13 === 0 ? FOREIGN : ORG,
      i % 7 === 0,
    ),
  );
  resources.push(
    record("same", "resources", { name: "Blue Crew", kind: "Crew" }),
    record("same", "resources", { name: "Blue Crew", kind: "Crew" }),
    record("same", "resources", { name: "Foreign Blue Crew", kind: "Crew" }, FOREIGN),
  );
  memberships.push(
    record("history-archived", "resource-memberships", {
      resource: "same", employee: "employee-x",
    }, ORG, true),
    record("history-foreign", "resource-memberships", {
      resource: "same", employee: "employee-y",
    }, FOREIGN),
  );
  const snapshot = structuredClone({ resources, memberships });
  const combinations: Array<{
    archived: boolean;
    kind: WorkforceResourceTypeFilter;
    enrollment: WorkforceResourceEnrollmentFilter;
  }> = [
    { archived: false, kind: "all", enrollment: "all" },
    { archived: true, kind: "all", enrollment: "all" },
    { archived: false, kind: "Crew", enrollment: "all" },
    { archived: false, kind: "Worker", enrollment: "enrolled" },
    { archived: true, kind: "Crew", enrollment: "enrolled" },
    { archived: false, kind: "Crew", enrollment: "resource-only" },
    { archived: false, kind: "Equipment", enrollment: "enrolled" },
    { archived: true, kind: "Equipment", enrollment: "resource-only" },
    { archived: false, kind: "all", enrollment: "enrolled" },
    { archived: false, kind: "all", enrollment: "resource-only" },
  ];
  const searches = [
    "", " ", "  BLUE  ", "crew", "night", "Café", "İSTANBUL",
    "i\u0307stanbul", "münchen", "=fictional", "floor", "worker",
    "PRIVATE PHONE", "PRIVATE NOTES", "resource-1", "no-match",
  ];
  for (const view of combinations) {
    for (const search of searches) {
      const expected = previousDirectory(
        resources, memberships, view.archived, search,
        view.kind, view.enrollment,
      );
      const actual = filterWorkforceResourceDirectory(
        resources, memberships, view.archived, search,
        view.kind, view.enrollment,
      );
      expect(actual).toEqual(expected);
      expect(actual).toHaveLength(expected.length);
      actual.forEach((value, i) => expect(value).toBe(expected[i]));
    }
  }
  expect({ resources, memberships }).toEqual(snapshot);
});

it("preserves org-separated historical enrollment and repeat resource references", () => {
  const local = record("same", "resources", { name: "Same Crew", kind: "Crew" });
  const foreign = record("same", "resources", {
    name: "Same Crew", kind: "Crew",
  }, FOREIGN);
  const members = [
    record("foreign-member", "resource-memberships", {
      resource: "same", employee: "private-worker",
    }, FOREIGN, true),
  ];
  expect(filterWorkforceResourceDirectory(
    [local, local, foreign], members, false, "same",
    "Crew", "enrolled",
  )).toEqual([foreign]);
  expect(filterWorkforceResourceDirectory(
    [local, local, foreign], members, false, "same",
    "Crew", "resource-only",
  )).toEqual([local, local]);
  const all = filterWorkforceResourceDirectory(
    [local, local, foreign], members, false, "same",
  );
  expect(all).toEqual([local, local, foreign]);
  expect(all[0]).toBe(local);
  expect(all[1]).toBe(local);
});

it("keeps normalization local to each search after a resource name changes", () => {
  const resource = record("a", "resources", {
    name: "Weekend Crew", kind: "Crew",
  });
  const records = [resource, resource];
  const search = (query: string) =>
    filterWorkforceResourceDirectory(records, [], false, query, "Crew");
  expect(search("weekend")).toEqual([resource, resource]);
  expect(search("weekday")).toEqual([]);
  resource.data.name = "Weekday Crew";
  expect(search("weekend")).toEqual([]);
  expect(search("weekday")).toEqual([resource, resource]);
  expect(search("weekday")).toEqual(previousDirectory(
    records, [], false, "weekday", "Crew",
  ));
  expect(search("")).toEqual(records);
});
