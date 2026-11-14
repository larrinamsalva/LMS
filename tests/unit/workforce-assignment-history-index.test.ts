import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import type { StaffAssignment } from "../../src/core/workforce";
import { filterStaffAssignmentHistory } from "../../src/core/workforce-assignment-history";

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

function assignment(
  i: number,
  organization_id = ORG,
  active = i % 3 === 0,
): StaffAssignment {
  return {
    organization_id,
    appointment_id: "appointment-" + (i % 300),
    appointment_revision: 1,
    resource_id: "resource-" + (i % 280),
    employee_id: "employee-" + i,
    membership_id: "member-" + i,
    membership_revision: 1,
    member_start: "2026-11-01T00:00:00Z",
    member_end: "2026-12-01T00:00:00Z",
    employee_name: "Snapshot Worker Zone " + (i % 15) + " " + i,
    employee_role: i % 9 === 0 ? "Night lead" : "Cleaner",
    employee_skills: "PRIVATE SKILL " + i,
    starts_at: "2026-11-06T10:00:00Z",
    ends_at: "2026-11-06T11:00:00Z",
    active,
  };
}

// Independent pre-optimization reference: two first-match record scans
// per eligible assignment, respecting organization and entity.
function previousFilter(
  assignments: readonly StaffAssignment[],
  records: readonly WorkspaceRecord[],
  status: "all" | "reserved" | "released",
  search: string,
): StaffAssignment[] {
  const query = search.trim().toLocaleLowerCase();
  return assignments.filter((item) => {
    if (status === "reserved" && !item.active) return false;
    if (status === "released" && item.active) return false;
    if (!query) return true;
    const appointment = records.find((r) =>
      r.entity === "appointments" &&
      r.id === item.appointment_id &&
      r.organization_id === item.organization_id,
    );
    const resource = records.find((r) =>
      r.entity === "resources" &&
      r.id === item.resource_id &&
      r.organization_id === item.organization_id,
    );
    const title = appointment?.data.title;
    const name = resource?.data.name;
    return [
      item.employee_name,
      item.employee_role,
      typeof title === "string" ? title : "",
      typeof name === "string" ? name : "",
    ].some((text) => text.toLocaleLowerCase().includes(query));
  });
}

it("matches original assignment search over 720 fictional revisions, all statuses and organization boundaries", () => {
  const assignments: StaffAssignment[] = [];
  const records: WorkspaceRecord[] = [];
  for (let i = 0; i < 720; i++) {
    const org = i % 17 === 0 ? FOREIGN : ORG;
    assignments.push(assignment(i, org, i % 4 === 0));
    records.push(record("appointment-" + i, "appointments", {
      title: "Home Visit Appointment " + i,
      notes: "PRIVATE NOTE " + i,
    }, org, i % 5 === 0));
    records.push(record("resource-" + i, "resources", {
      name: "Resource Bay " + (i % 19) + " " + i,
      phone: "PRIVATE PHONE " + i,
    }, org, i % 7 === 0));
    if (i % 23 === 0) {
      records.unshift(record("appointment-" + i, "appointments", {
        title: "FOREIGN PRIVATE " + i,
      }, org === ORG ? FOREIGN : ORG));
    }
  }
  assignments.push({ ...assignment(900), appointment_id: "missing",
    resource_id: "missing", employee_name: "Anonymous",
  });
  records.push(record("resource-50", "contacts", {
    name: "Forbidden contact name",
  }));
  const snapshot = structuredClone({ assignments, records });
  for (const status of ["all", "reserved", "released"] as const) {
    for (const search of [
      "", "   ", "SNAPSHOT", "ZONE 4", "night LEAD", "cleaner",
      "appointment 23", "home visit", "BAY 3", "Resource Bay",
      "FOREIGN PRIVATE", "PRIVATE NOTE", "PRIVATE PHONE",
      "PRIVATE SKILL", "employee-50", "appointment-50",
      "Forbidden contact", "missing", "no match at all",
    ]) {
      expect(filterStaffAssignmentHistory(assignments, records, status, search))
        .toEqual(previousFilter(assignments, records, status, search));
    }
  }
  expect({ assignments, records }).toEqual(snapshot);
});

it("preserves first-record-wins including invalid labels, separate entity types and foreign shared IDs", () => {
  const assignments = [
    { ...assignment(1), appointment_id: "same", resource_id: "same",
      employee_name: "Alex", employee_role: "Operator",
    },
    { ...assignment(2, FOREIGN), appointment_id: "same", resource_id: "same",
      employee_name: "Morgan", employee_role: "Operator",
    },
    { ...assignment(3), appointment_id: "valid", resource_id: "valid",
      employee_name: "Jordan", employee_role: "Operator",
    },
  ];
  const records = [
    record("same", "appointments", { title: "Foreign visible" }, FOREIGN),
    record("same", "resources", { name: "Foreign resource" }, FOREIGN),
    record("same", "appointments", { title: 123, notes: "PRIVATE FIRST" }),
    record("same", "appointments", { title: "Ignored duplicate" }),
    record("same", "resources", { name: 123 }),
    record("same", "resources", { name: "Ignored resource" }),
    record("valid", "appointments", { title: "Matching title" }),
    record("valid", "resources", { name: "Matching resource" }),
    record("valid", "employees", { name: "Forbidden linked employee" }),
  ];
  for (const query of [
    "foreign", "ignored", "private", "matching title",
    "matching resource", "forbidden", "alex", "operator",
  ]) {
    expect(filterStaffAssignmentHistory(assignments, records, "all", query))
      .toEqual(previousFilter(assignments, records, "all", query));
  }
  expect(filterStaffAssignmentHistory(assignments, records, "all",
    "Ignored duplicate")).toEqual([]);
  expect(filterStaffAssignmentHistory(assignments, records, "all",
    "Ignored resource")).toEqual([]);
  expect(filterStaffAssignmentHistory(assignments, records, "all",
    "Foreign visible")).toEqual([assignments[1]]);
  expect(filterStaffAssignmentHistory(assignments, records, "all",
    "Matching title")).toEqual([assignments[2]]);
});

it("skips all linked-record reads for blank assignment searches", () => {
  const entries = [assignment(0), assignment(1), assignment(2)];
  const records = new Proxy([] as WorkspaceRecord[], {
    get(target, prop, receiver) {
      if (prop === Symbol.iterator || prop === "find") {
        throw new Error("blank search must not inspect linked records");
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  expect(filterStaffAssignmentHistory(entries, records, "reserved", "  "))
    .toEqual(entries.filter((entry) => entry.active));
  expect(filterStaffAssignmentHistory(entries, records, "all", ""))
    .toEqual(entries);
});
