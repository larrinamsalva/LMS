import { Temporal } from "@js-temporal/polyfill";
import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import { csvSafeCell } from "../../src/core/daily-operations-csv";
import { isTimeZone, instant, localTime } from "../../src/core/time";
import {
  filterAvailabilityPeriods,
} from "../../src/core/workforce-availability-filter";
import {
  filteredAvailabilityPeriodsCsv,
  type AvailabilityPeriodsCsvView,
} from "../../src/core/workforce-availability-csv";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function rec(
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

// Independent previous exporter: same validated canonical pipeline and
// one scoped.find() for every matching exported availability record.
function previousCsv(
  records: readonly WorkspaceRecord[],
  organizationId: string,
  zone: string,
  view: AvailabilityPeriodsCsvView,
): string {
  if (!isTimeZone(zone)) throw new Error("Choose a valid business time zone.");
  let day: Temporal.PlainDate;
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(view.date)) throw new Error("Invalid date");
    day = Temporal.PlainDate.from(view.date, { overflow: "reject" });
    if (day.toString() !== view.date) throw new Error("Invalid date");
  } catch {
    throw new Error("Choose a valid availability calendar date.");
  }
  const start = day.toZonedDateTime(zone).epochNanoseconds;
  const end = day.add({ days: 1 }).toZonedDateTime(zone).epochNanoseconds;
  const scoped = records.filter((r) => r.organization_id === organizationId);
  const periods = scoped.filter((r) => {
    if (r.entity !== "availability" || r.archived !== view.archived) return false;
    try {
      return instant(String(r.data.start)).epochNanoseconds < end &&
        instant(String(r.data.end)).epochNanoseconds > start;
    } catch { return false; }
  });
  const matching = filterAvailabilityPeriods(
    periods, scoped, view.kind, view.search,
  );
  const header = [
    "Selected business-local date", "Period title", "Period type",
    "Subject type", "Employee or resource",
    "Start (business local)", "End (business local)",
    "Start (UTC)", "End (UTC)", "Record status", "Business time zone",
  ];
  const rows = matching.map((period) => {
    const employeeId = period.data.employee;
    const resourceId = period.data.resource;
    const subjectType = employeeId ? "Employee" : resourceId ? "Resource" : "";
    const subjectId = employeeId || resourceId;
    const subjectEntity = employeeId ? "employees" : "resources";
    const subject = scoped.find((r) =>
      r.id === subjectId && r.entity === subjectEntity,
    );
    const startInstant = instant(String(period.data.start)).toString();
    const endInstant = instant(String(period.data.end)).toString();
    return [
      view.date,
      typeof period.data.title === "string" ? period.data.title : "",
      typeof period.data.kind === "string" ? period.data.kind : "",
      subjectType,
      typeof subject?.data.name === "string" ? subject.data.name : "",
      localTime(startInstant, zone),
      localTime(endInstant, zone),
      startInstant, endInstant,
      period.archived ? "Archived" : "Current", zone,
    ];
  });
  return [header, ...rows]
    .map((row) => row.map(csvSafeCell).join(","))
    .join("\r\n") + "\r\n";
}

it("matches prior CSV byte-for-byte across 720 fictional periods, status/type/search/date selections", () => {
  const records: WorkspaceRecord[] = [];
  const kinds = ["Working hours", "Day off", "Vacation", "Unavailable"] as const;
  for (let i = 0; i < 720; i++) {
    const org = i % 17 === 0 ? FOREIGN : ORG;
    const subjectId = "subject-" + (i % 320);
    const type = i % 2 === 0 ? "employees" : "resources";
    records.push(rec("period-" + i,
      i % 61 === 0 ? "appointments" : "availability", {
        title: i % 23 === 0 ? "=SUM(1,2)" : "Fictional period " + i,
        kind: kinds[i % 4],
        employee: i % 2 === 0 ? subjectId : "",
        resource: i % 2 === 1 ? subjectId : "",
        start: i % 5 === 0 ? "2026-11-01T08:30:00Z"
          : i % 5 === 1 ? "2026-11-01T09:30:00Z"
            : i % 5 === 2 ? "2026-11-06T16:00:00Z"
              : i % 5 === 3 ? "2026-11-07T07:30:00Z" : "invalid",
        end: i % 5 === 0 ? "2026-11-01T08:45:00Z"
          : i % 5 === 1 ? "2026-11-01T09:45:00Z"
            : i % 5 === 2 ? "2026-11-06T19:00:00Z"
              : "2026-11-07T08:30:00Z",
        notes: "PRIVATE PERIOD NOTE " + i,
      }, org, i % 7 === 0));
    records.push(rec(subjectId, type, {
      name: i % 29 === 0 ? "@formula" : "Subject Zone " + (i % 15) + " " + i,
      phone: "PRIVATE PHONE " + i,
    }, org, i % 11 === 0));
    if (i % 31 === 0) {
      records.unshift(rec(subjectId, type, {
        name: "FOREIGN PRIVATE " + i,
      }, org === ORG ? FOREIGN : ORG));
    }
  }
  records.unshift(rec("subject-2", "employees", { name: 12 }));
  records.push(rec("subject-2", "employees", { name: "Ignored duplicate" }));
  records.unshift(rec("subject-3", "resources", { name: 12 }));
  records.push(rec("subject-3", "resources", { name: "Ignored resource" }));
  records.push(rec("subject-3", "contacts", {
    name: "PRIVATE CONTACT", notes: "PRIVATE NOTE",
  }));
  const original = structuredClone(records);
  const views: AvailabilityPeriodsCsvView[] = [
    { date: "2026-11-01", archived: false, kind: "all", search: "" },
    { date: "2026-11-01", archived: true, kind: "all", search: "" },
    { date: "2026-11-06", archived: false, kind: "all", search: "" },
    { date: "2026-11-06", archived: false, kind: "Working hours", search: "zone 3" },
    { date: "2026-11-06", archived: false, kind: "Vacation", search: "" },
    { date: "2026-11-06", archived: false, kind: "Day off", search: "subject" },
    { date: "2026-11-06", archived: true, kind: "Unavailable", search: "" },
    { date: "2026-11-07", archived: false, kind: "all", search: "=SUM" },
    { date: "2026-11-07", archived: false, kind: "all", search: "PRIVATE PHONE" },
    { date: "2026-11-06", archived: false, kind: "all", search: "not found" },
  ];
  for (const view of views) {
    expect(filteredAvailabilityPeriodsCsv(records, ORG,
      "America/Los_Angeles", view,
    )).toBe(previousCsv(records, ORG, "America/Los_Angeles", view));
  }
  expect(records).toEqual(original);
});

it("preserves first linked record by entity, foreign ID isolation and malformed subject links", () => {
  const periods = [
    rec("employee-link", "availability", {
      title: "Employee", kind: "Working hours",
      employee: "same", start: "2026-11-06T10:00:00Z",
      end: "2026-11-06T12:00:00Z",
    }),
    rec("resource-link", "availability", {
      title: "Resource", kind: "Vacation",
      resource: "same", start: "2026-11-06T10:00:00Z",
      end: "2026-11-06T12:00:00Z",
    }),
    rec("numeric-link", "availability", {
      title: "Invalid link", kind: "Day off",
      employee: 22, start: "2026-11-06T10:00:00Z",
      end: "2026-11-06T12:00:00Z",
    }),
    rec("foreign-link", "availability", {
      title: "Foreign ID", kind: "Unavailable",
      resource: "private", start: "2026-11-06T10:00:00Z",
      end: "2026-11-06T12:00:00Z",
    }),
  ];
  const records = [
    ...periods,
    rec("same", "employees", { name: "Foreign Employee" }, FOREIGN),
    rec("same", "employees", { name: 123 }),
    rec("same", "employees", { name: "Ignored Employee" }),
    rec("same", "resources", { name: "Visible Local Resource" }),
    rec("private", "resources", { name: "Foreign Private" }, FOREIGN),
    rec("22", "employees", { name: "Not a numeric match" }),
    rec("same", "contacts", { name: "Private Contact" }),
  ];
  const view: AvailabilityPeriodsCsvView = {
    date: "2026-11-06", archived: false, kind: "all", search: "",
  };
  const actual = filteredAvailabilityPeriodsCsv(records, ORG, "UTC", view);
  expect(actual).toBe(previousCsv(records, ORG, "UTC", view));
  expect(actual).toContain('"Resource","Vacation","Resource","Visible Local Resource"');
  for (const forbidden of [
    "Ignored Employee", "Foreign Employee", "Foreign Private",
    "Not a numeric match", "Private Contact",
  ]) expect(actual).not.toContain(forbidden);
});

it("preserves validation errors and header-only exports", () => {
  const view: AvailabilityPeriodsCsvView = {
    date: "2026-11-06", archived: false, kind: "all", search: "",
  };
  expect(filteredAvailabilityPeriodsCsv([], ORG, "UTC", view))
    .toBe(previousCsv([], ORG, "UTC", view));
  expect(() => filteredAvailabilityPeriodsCsv([], ORG, "UTC", {
    ...view, date: "2026-02-30",
  })).toThrow(/valid availability calendar date/);
  expect(() => filteredAvailabilityPeriodsCsv([], ORG, "Not/AZone", view))
    .toThrow(/valid business time zone/);
});
