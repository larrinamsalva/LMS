import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import { filterResourceMembershipsByName } from "../../src/core/resource-membership-review";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function row(
  id: string, entity: string, data: WorkspaceRecord["data"],
  organization_id = ORG, archived = false,
): WorkspaceRecord {
  return {
    id, entity, data, organization_id, archived, revision: 1,
    config_revision: 1, created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };
}

// Independent pre-optimization reference. Search titles before employee names,
// use the first employee with the matching ID in the same organization, and
// exclude contacts, notes, raw IDs, unrelated entities and foreign people.
function previousRosterSearch(
  memberships: readonly WorkspaceRecord[],
  records: readonly WorkspaceRecord[],
  search: string,
): WorkspaceRecord[] {
  const query = search.trim().toLocaleLowerCase();
  return memberships.filter((membership) => {
    if (membership.entity !== "resource-memberships") return false;
    if (!query) return true;
    const title = typeof membership.data.title === "string"
      ? membership.data.title : "";
    if (title.toLocaleLowerCase().includes(query)) return true;
    const employee = records.find((record) =>
      record.entity === "employees" &&
      record.organization_id === membership.organization_id &&
      record.id === membership.data.employee,
    );
    const name = employee && typeof employee.data.name === "string"
      ? employee.data.name : "";
    return name.toLocaleLowerCase().includes(query);
  });
}

it("indexed roster name search matches the original across 720 records and all scoped search cases", () => {
  const memberships: WorkspaceRecord[] = [];
  const people: WorkspaceRecord[] = [];
  for (let i = 0; i < 720; i++) {
    const employee = "employee-" + i;
    people.push(row(employee, "employees", {
      name: "Employee Zone " + (i % 16) + " Person " + i,
      phone: "PRIVATE " + i, notes: "confidential " + i,
    }));
    memberships.push(row("membership-" + i, "resource-memberships", {
      resource: "crew-" + (i % 20), employee,
      title: i % 7 === 0 ? "Weekend Coverage " + i : "Shift " + i,
      notes: "SECRET " + i,
    }, ORG, i % 5 === 0));
    if (i % 12 === 0) {
      // Foreign employee with the same ID must never satisfy local matches.
      people.unshift(row(employee, "employees", {
        name: "FOREIGN PRIVATE " + i,
      }, FOREIGN));
    }
  }
  memberships.push(row("not-membership", "availability", {
    title: "Weekend", employee: "employee-1",
  }));
  memberships.push(row("foreign-member", "resource-memberships", {
    resource: "crew-1", employee: "employee-1", title: "Offsite",
  }, FOREIGN));
  people.push(row("not-employee", "resources", {
    name: "Restricted Contact",
  }));
  const source = structuredClone({ memberships, people });
  for (const query of [
    "", "  ", "  ZONE 3  ", "weekend", "shift 19",
    "PERSON 700", "FOREIGN PRIVATE", "PRIVATE", "SECRET",
    "employee-1", "not-present", "offsite",
  ]) {
    expect(filterResourceMembershipsByName(memberships, people, query))
      .toEqual(previousRosterSearch(memberships, people, query));
  }
  expect({ memberships, people }).toEqual(source);
});

it("keeps first-record-wins for duplicate employee IDs, malformed names and foreign ID collisions", () => {
  const members = [
    row("first", "resource-memberships", {
      title: "First", resource: "crew", employee: "shared",
    }),
    row("second", "resource-memberships", {
      title: "Second", resource: "crew", employee: "valid",
    }),
    row("third", "resource-memberships", {
      title: "Third", resource: "crew", employee: "shared",
    }, FOREIGN),
    row("bad-link", "resource-memberships", {
      title: "Bad link", resource: "crew", employee: 123,
    }),
    row("wrong-entity", "availability", {
      title: "Sensitive", employee: "valid",
    }),
  ];
  const people = [
    row("shared", "employees", { name: "FOREIGN NAME" }, FOREIGN),
    row("shared", "employees", { name: 123, notes: "PRIVATE NOTE" }),
    row("shared", "employees", { name: "IGNORED DUPLICATE" }),
    row("valid", "employees", { name: "Visible Worker" }),
    row("123", "employees", { name: "Should Not Match" }),
  ];
  for (const query of [
    "", "visible", "foreign", "ignored", "private", "123",
    "first", "second", "third", "sensitive", "bad link",
  ]) {
    const expected = previousRosterSearch(members, people, query)
      .map((r) => r.id);
    expect(filterResourceMembershipsByName(members, people, query)
      .map((r) => r.id)).toEqual(expected);
  }
  expect(filterResourceMembershipsByName(
    members, people, "IGNORED DUPLICATE",
  )).toEqual([]);
  expect(filterResourceMembershipsByName(
    members, people, "FOREIGN NAME",
  ).map((r) => r.id)).toEqual(["third"]);
  expect(filterResourceMembershipsByName(
    members, people, "Visible Worker",
  ).map((r) => r.id)).toEqual(["second"]);
});
