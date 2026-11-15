import { expect, it } from "vitest";
import type { StaffAssignment } from "../../src/core/workforce";
import type { WorkspaceRecord } from "../../src/core/engine";
import {
  filterStaffAssignmentHistory,
  type StaffAssignmentHistoryStatus,
} from "../../src/core/workforce-assignment-history";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function record(
  id: string, entity: string, data: WorkspaceRecord["data"],
  organization_id = ORG,
): WorkspaceRecord {
  return {
    id, entity, data, organization_id, archived: false,
    revision: 1, config_revision: 1,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };
}

function assignment(index: number, organization_id = ORG): StaffAssignment {
  return {
    organization_id,
    appointment_id: "appointment-" + (index % 35),
    appointment_revision: (index % 5) + 1,
    employee_id: "private-employee-" + index,
    resource_id: "resource-" + (index % 28),
    membership_id: "private-membership-" + index,
    membership_revision: 1,
    member_start: "2026-01-01T00:00:00Z",
    member_end: "2028-01-01T00:00:00Z",
    employee_name: index % 11 === 0 ? "İSTANBUL Example"
      : index % 7 === 0 ? "Avery Example"
        : "Fictional Worker " + (index % 12),
    employee_role: index % 5 === 0 ? "Lead"
      : index % 5 === 1 ? "Night Crew" : "Crew",
    employee_skills: "PRIVATE SKILLS",
    starts_at: "2026-11-07T08:30:00Z",
    ends_at: "2026-11-07T09:30:00Z",
    active: index % 3 !== 0,
  };
}

// Independent verbatim filter from merged five-green LMS #168.
// Repeated display strings were lowercased separately in every row.
function previousSearch(
  assignments: readonly StaffAssignment[],
  records: readonly WorkspaceRecord[],
  status: StaffAssignmentHistoryStatus,
  search: string,
): StaffAssignment[] {
  const query = search.trim().toLocaleLowerCase();
  if (!query) return assignments.filter((entry) =>
    (status !== "reserved" || entry.active) &&
    (status !== "released" || !entry.active),
  );
  const appointmentTitles = new Map<string, Map<string, string>>();
  const resourceNames = new Map<string, Map<string, string>>();
  for (const row of records) {
    const isAppointment = row.entity === "appointments";
    if (!isAppointment && row.entity !== "resources") continue;
    const index = isAppointment ? appointmentTitles : resourceNames;
    let names = index.get(row.organization_id);
    if (!names) {
      names = new Map<string, string>();
      index.set(row.organization_id, names);
    }
    if (!names.has(row.id)) {
      const label = isAppointment ? row.data.title : row.data.name;
      names.set(row.id, typeof label === "string" ? label : "");
    }
  }
  return assignments.filter((entry) => {
    if (status === "reserved" && !entry.active) return false;
    if (status === "released" && entry.active) return false;
    const organizationId = entry.organization_id;
    const searchable = [
      entry.employee_name,
      entry.employee_role,
      appointmentTitles.get(organizationId)?.get(entry.appointment_id) ?? "",
      resourceNames.get(organizationId)?.get(entry.resource_id) ?? "",
    ];
    return searchable.some((value) =>
      value.toLocaleLowerCase().includes(query),
    );
  });
}

it("keeps exact assignment references and order for 720 fictional retained revisions", () => {
  const assignments: StaffAssignment[] = Array.from(
    { length: 720 }, (_, i) => assignment(i, i % 19 === 0 ? FOREIGN : ORG),
  );
  const shared = assignment(901);
  shared.employee_name = "Repeat Me";
  assignments.push(shared, shared,
    { ...shared, employee_name: "Repeat Me", appointment_revision: 9 });
  const records: WorkspaceRecord[] = [];
  for (let i = 0; i < 70; i++) {
    records.push(record("appointment-" + (i % 35), "appointments", {
      title: i % 13 === 0 ? "=Formula" : "Night Visit " + (i % 8),
      notes: "PRIVATE APPOINTMENT NOTES",
    }, i % 17 === 0 ? FOREIGN : ORG));
    records.push(record("resource-" + (i % 28), "resources", {
      name: i % 11 === 0 ? "MÜNCHEN Team" : "Blue Crew " + (i % 5),
      phone: "PRIVATE PHONE",
    }, i % 23 === 0 ? FOREIGN : ORG));
  }
  // First duplicate record wins even when the first display label is invalid.
  records.unshift(record("appointment-3", "appointments", { title: 42 }));
  records.push(
    record("appointment-3", "appointments", { title: "Ignored Duplicate" }),
    record("resource-5", "resources", { name: "Foreign Crew" }, FOREIGN),
    record("appointment-5", "contacts", { title: "PRIVATE CONTACT TITLE" }),
  );
  const before = structuredClone({ assignments, records });
  const searches = [
    "", " ", "\t ", "crew", "  NIGHT  ", "Avery",
    "lead", "fictional worker 3", "repeat me",
    "MÜNCHEN", "münchen", "İSTANBUL", "i\u0307stanbul",
    "=formula", "night visit", "blue crew",
    "ignored duplicate", "FOREIGN CREW", "PRIVATE SKILLS",
    "PRIVATE PHONE", "PRIVATE APPOINTMENT NOTES",
    "PRIVATE CONTACT TITLE", "private-employee-2",
    "appointment-12", "unfindable query",
  ];
  for (const status of ["all", "reserved", "released"] as const) {
    for (const search of searches) {
      const expected = previousSearch(assignments, records, status, search);
      const actual = filterStaffAssignmentHistory(
        assignments, records, status, search,
      );
      expect(actual).toHaveLength(expected.length);
      expect(actual).toEqual(expected);
      actual.forEach((row, index) => expect(row).toBe(expected[index]));
    }
  }
  expect({ assignments, records }).toEqual(before);
});

it("preserves organization-separated linked labels and invalid first-record names", () => {
  const local = assignment(1);
  local.employee_name = "Local Employee";
  local.employee_role = "Caretaker";
  local.appointment_id = "same";
  local.resource_id = "shared";
  const foreign = assignment(2, FOREIGN);
  foreign.employee_name = "Outside Employee";
  foreign.employee_role = "Caretaker";
  foreign.appointment_id = "same";
  foreign.resource_id = "shared";
  const links = [
    record("same", "appointments", { title: 123 }),
    record("same", "appointments", { title: "Ignored Local Title" }),
    record("shared", "resources", { name: "Local Crew" }),
    record("same", "appointments", { title: "Foreign Appointment" }, FOREIGN),
    record("shared", "resources", { name: "Foreign Resource" }, FOREIGN),
    record("shared", "contacts", { name: "PRIVATE CONTACT" }),
  ];
  for (const search of [
    "local crew", "foreign resource", "foreign appointment",
    "ignored local", "private contact", "caretaker", "employee", "",
  ]) {
    expect(filterStaffAssignmentHistory(
      [local, foreign], links, "all", search,
    )).toEqual(previousSearch([local, foreign], links, "all", search));
  }
  expect(filterStaffAssignmentHistory([local], links, "all", "Foreign Appointment"))
    .toEqual([]);
  expect(filterStaffAssignmentHistory([foreign], links, "all", "Foreign Appointment"))
    .toEqual([foreign]);
  expect(filterStaffAssignmentHistory([local], links, "all", "Ignored Local Title"))
    .toEqual([]);
});

it("creates a fresh normalized-label cache for every search and record edit", () => {
  const same = assignment(7);
  same.employee_name = "Weekend Example";
  same.employee_role = "Night Crew";
  const entries = [same, same];
  const run = (search: string) =>
    filterStaffAssignmentHistory(entries, [], "all", search);
  expect(run("weekend")).toEqual([same, same]);
  expect(run("weekday")).toEqual([]);
  same.employee_name = "Weekday Example";
  expect(run("weekend")).toEqual([]);
  expect(run("weekday")).toEqual([same, same]);
  expect(run("weekday")).toEqual(previousSearch(entries, [], "all", "weekday"));
  expect(filterStaffAssignmentHistory(entries, [], "released", "weekday")).toEqual([]);
  expect(run("")).toEqual(entries);
});
