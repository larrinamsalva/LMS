import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import { filterResourceMembershipsByName } from "../../src/core/resource-membership-review";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function record(
  entity: string, id: string, data: WorkspaceRecord["data"],
  organization_id = ORG, archived = false,
): WorkspaceRecord {
  return {
    id, entity, data, organization_id, archived,
    revision: 1, config_revision: 1,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };
}

// Independent verbatim search implementation from merged five-green #167.
// Previously each membership title was lowercased for every record.
function previousSearch(
  memberships: readonly WorkspaceRecord[],
  records: readonly WorkspaceRecord[],
  search: string,
): WorkspaceRecord[] {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return memberships.filter(
    (membership) => membership.entity === "resource-memberships",
  );
  const employeeNames = new Map<string, Map<string, string>>();
  for (const row of records) {
    if (row.entity !== "employees") continue;
    let organizationNames = employeeNames.get(row.organization_id);
    if (!organizationNames) {
      organizationNames = new Map<string, string>();
      employeeNames.set(row.organization_id, organizationNames);
    }
    if (!organizationNames.has(row.id)) {
      organizationNames.set(row.id,
        typeof row.data.name === "string"
          ? row.data.name.toLocaleLowerCase() : "");
    }
  }
  return memberships.filter((membership) => {
    if (membership.entity !== "resource-memberships") return false;
    const title = typeof membership.data.title === "string"
      ? membership.data.title : "";
    if (title.toLocaleLowerCase().includes(query)) return true;
    const id = membership.data.employee;
    if (typeof id !== "string") return false;
    const name = employeeNames.get(membership.organization_id)?.get(id) ?? "";
    return name.includes(query);
  });
}

it("keeps exact search record references across 720 repeated-title fictional historical revisions", () => {
  const titleValues: Array<string | number> = [
    "Night Coverage", "NIGHT COVERAGE", "Morning Coverage",
    "İSTANBUL Shift", "Café Scheduling", "MÜNCHEN Crew",
    "Inspection", "=SUM(1,2)", "@Fictional Formula", "",
    42, "Repeated Archived Title",
  ];
  const employees: WorkspaceRecord[] = [];
  for (let i = 0; i < 100; i++) {
    employees.push(record("employees", "employee-" + i, {
      name: i === 4 ? 24 : i % 3 === 0
        ? "Avery Example " + i : "Fictional Worker " + i,
      email: "PRIVATE@EXAMPLE.TEST", phone: "PRIVATE PHONE",
    }, i % 13 === 0 ? FOREIGN : ORG));
  }
  employees.push(
    record("employees", "employee-4", { name: "Ignored Duplicate" }),
    record("employees", "employee-3", { name: "FOREIGN STAFF NAME" }, FOREIGN),
    record("contacts", "employee-3", { name: "PRIVATE CONTACT" }),
  );
  const memberships: WorkspaceRecord[] = [];
  for (let i = 0; i < 720; i++) {
    memberships.push(record("resource-memberships",
      "membership-" + (i % 250), {
        resource: "crew-" + (i % 30),
        employee: i % 17 === 0 ? 123 : "employee-" + (i % 100),
        title: titleValues[i % titleValues.length],
        notes: "PRIVATE MEMBER NOTE",
      }, i % 19 === 0 ? FOREIGN : ORG, i % 5 === 0));
  }
  const repeated = record("resource-memberships", "duplicate-id", {
    employee: "employee-2", resource: "crew-7",
    title: "Repeated Archived Title",
  }, ORG, true);
  memberships.push(repeated, repeated,
    record("resource-memberships", "duplicate-id", {
      employee: "employee-2", resource: "crew-7",
      title: "Night Coverage",
    }),
    record("availability", "unrelated-entity", {
      title: "Night Coverage", employee: "employee-2",
    }));
  const before = structuredClone({ memberships, employees });
  const searches = [
    "", " ", " \t ", "coverage", "  NIGHT  ", "morning",
    "İSTANBUL", "i\u0307stanbul", "CAFE", "Café", "MÜNCHEN",
    "inspection", "=sum(1,2)", "repeated archived",
    "Avery Example", "Fictional Worker 12", "worker",
    "ignored duplicate", "PRIVATE MEMBER NOTE",
    "PRIVATE@EXAMPLE.TEST", "PRIVATE CONTACT", "employee-2",
    "no such matching roster title", "\tcrew\n",
  ];
  for (const search of searches) {
    const expected = previousSearch(memberships, employees, search);
    const actual = filterResourceMembershipsByName(
      memberships, employees, search,
    );
    expect(actual).toHaveLength(expected.length);
    expect(actual).toEqual(expected);
    actual.forEach((entry, i) => expect(entry).toBe(expected[i]));
  }
  expect({ memberships, employees }).toEqual(before);
});

it("preserves organization-separated employee names and first duplicate record semantics", () => {
  const local = record("resource-memberships", "local", {
    resource: "crew", employee: "shared", title: "Coverage",
  });
  const foreign = record("resource-memberships", "foreign", {
    resource: "crew", employee: "shared", title: "Coverage",
  }, FOREIGN);
  const records = [
    record("employees", "shared", { name: 24, notes: "PRIVATE FIRST" }),
    record("employees", "shared", { name: "Ignored Local Name" }),
    record("employees", "shared", { name: "Foreign Staff" }, FOREIGN),
    record("contacts", "shared", { name: "PRIVATE CONTACT" }),
  ];
  for (const search of [
    "coverage", "foreign staff", "Ignored Local Name",
    "PRIVATE FIRST", "PRIVATE CONTACT", "",
  ]) {
    const actual = filterResourceMembershipsByName(
      [local, foreign], records, search,
    );
    expect(actual).toEqual(previousSearch([local, foreign], records, search));
  }
  expect(filterResourceMembershipsByName(
    [local], records, "Foreign Staff",
  )).toEqual([]);
  expect(filterResourceMembershipsByName(
    [foreign], records, "Foreign Staff",
  )).toEqual([foreign]);
  expect(filterResourceMembershipsByName(
    [local], records, "Ignored Local Name",
  )).toEqual([]);
});

it("does not reuse titles between different searches or record changes", () => {
  const shared = record("resource-memberships", "retained", {
    title: "Weekend Coverage", employee: "worker", resource: "crew",
  });
  const rows = [shared, shared];
  const search = (text: string) =>
    filterResourceMembershipsByName(rows, [], text);
  expect(search("weekend")).toEqual([shared, shared]);
  expect(search("weekday")).toEqual([]);
  shared.data.title = "Weekday Coverage";
  expect(search("weekend")).toEqual([]);
  expect(search("weekday")).toEqual([shared, shared]);
  expect(search("weekday")).toEqual(previousSearch(rows, [], "weekday"));
  expect(search("")).toEqual(rows);
});
