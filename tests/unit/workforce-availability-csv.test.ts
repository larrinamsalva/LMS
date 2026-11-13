import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import { filteredAvailabilityPeriodsCsv } from "../../src/core/workforce-availability-csv";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const view = {
  date: "2026-11-06", archived: false,
  kind: "all" as const, search: "",
};
function record(
  id: string, entity: string, data: WorkspaceRecord["data"],
  archived = false, organization_id = ORG,
): WorkspaceRecord {
  return {
    id, organization_id, entity, data, archived,
    revision: 1, config_revision: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}
const source = [
  record("employee-a", "employees", {
    name: "Avery Example", email: "PRIVATE@EXAMPLE.COM",
  }),
  record("resource-a", "resources", {
    name: "Blue Crew", notes: "PRIVATE RESOURCE NOTE",
  }),
  record("employee-foreign", "employees", {
    name: "FOREIGN PRIVATE PERSON",
  }, false, OTHER),
  record("day-work", "availability", {
    title: "Early work", kind: "Working hours",
    employee: "employee-a", start: "2026-11-06T16:00:00Z",
    end: "2026-11-06T17:00:00Z", notes: "PRIVATE WORK NOTE",
  }),
  // 23:30 Pacific on Nov 6 until 00:30 Nov 7: appears on both local days.
  record("overnight", "availability", {
    title: "Late vacation", kind: "Vacation",
    resource: "resource-a", start: "2026-11-07T07:30:00Z",
    end: "2026-11-07T08:30:00Z",
  }),
  record("archived", "availability", {
    title: "Old day off", kind: "Day off",
    employee: "employee-a", start: "2026-11-06T18:00:00Z",
    end: "2026-11-06T19:00:00Z",
  }, true),
  record("next-day", "availability", {
    title: "Tomorrow-only", kind: "Working hours",
    employee: "employee-a", start: "2026-11-07T08:30:00Z",
    end: "2026-11-07T09:30:00Z",
  }),
  record("foreign", "availability", {
    title: "FOREIGN PERIOD", kind: "Working hours",
    employee: "employee-foreign", start: "2026-11-06T16:00:00Z",
    end: "2026-11-06T17:00:00Z",
  }, false, OTHER),
];

it("exports only same-org periods overlapping the business-local selected day", () => {
  const original = structuredClone(source);
  const csv = filteredAvailabilityPeriodsCsv(
    source, ORG, "America/Los_Angeles", view,
  );
  const rows = csv.trimEnd().split("\r\n");
  expect(rows).toHaveLength(3);
  expect(rows[0]).toContain('"Selected business-local date"');
  expect(rows[0]).toContain('"Start (UTC)"');
  expect(rows[1]).toContain('"Early work","Working hours","Employee","Avery Example"');
  expect(rows[2]).toContain('"Late vacation","Vacation","Resource","Blue Crew"');
  expect(rows[1]).toContain('"2026-11-06T08:00"');
  expect(rows[2]).toContain('"2026-11-06T23:30"');
  for (const secret of [
    "Tomorrow-only", "Old day off", "FOREIGN", "PRIVATE",
    "employee-a", "day-work", "overnight", "resource-a",
  ]) expect(csv).not.toContain(secret);
  expect(source).toEqual(original);
});

it("respects kind, case-insensitive subject search, archived view, and midnight overlap", () => {
  const named = filteredAvailabilityPeriodsCsv(
    source, ORG, "America/Los_Angeles", {
      ...view, kind: "Working hours", search: " AVeRy ",
    },
  );
  expect(named).toContain("Early work");
  expect(named).not.toContain("Late vacation");

  const resource = filteredAvailabilityPeriodsCsv(
    source, ORG, "America/Los_Angeles", {
      ...view, kind: "Vacation", search: "BLUE",
    },
  );
  expect(resource).toContain("Late vacation");
  expect(resource).not.toContain("Early work");

  const archived = filteredAvailabilityPeriodsCsv(
    source, ORG, "America/Los_Angeles", { ...view, archived: true },
  );
  expect(archived).toContain('"Old day off"');
  expect(archived).toContain('"Archived"');
  expect(archived).not.toContain("Early work");

  const nextDay = filteredAvailabilityPeriodsCsv(
    source, ORG, "America/Los_Angeles", {
      ...view, date: "2026-11-07",
    },
  );
  expect(nextDay).not.toContain("Early work");
  expect(nextDay).toContain("Late vacation");
  expect(nextDay).toContain("Tomorrow-only");

  const notFound = filteredAvailabilityPeriodsCsv(
    source, ORG, "America/Los_Angeles", {
      ...view, search: "PRIVATE@EXAMPLE.COM",
    },
  );
  expect(notFound.trimEnd().split("\r\n")).toHaveLength(1);
});

it("keeps UTC instants when the fall DST fold repeats a local hour", () => {
  const fold = [
    record("hour-one", "availability", {
      title: "First 1:30", kind: "Working hours",
      employee: "person", start: "2026-11-01T08:30:00Z",
      end: "2026-11-01T08:45:00Z",
    }),
    record("hour-two", "availability", {
      title: "Second 1:30", kind: "Working hours",
      employee: "person", start: "2026-11-01T09:30:00Z",
      end: "2026-11-01T09:45:00Z",
    }),
  ];
  const csv = filteredAvailabilityPeriodsCsv(
    fold, ORG, "America/Los_Angeles", {
      ...view, date: "2026-11-01",
    },
  );
  expect(csv.trimEnd().split("\r\n")).toHaveLength(3);
  expect(csv.match(/2026-11-01T01:30/g)).toHaveLength(2);
  expect(csv).toContain('"2026-11-01T08:30:00Z"');
  expect(csv).toContain('"2026-11-01T09:30:00Z"');
});

it("rejects impossible dates and unknown business zones rather than exporting guessed days", () => {
  for (const invalid of ["", "2026-02-30", "2026-11", "tomorrow"]) {
    expect(() => filteredAvailabilityPeriodsCsv(
      source, ORG, "UTC", { ...view, date: invalid },
    )).toThrow(/valid availability calendar date/);
  }
  expect(() => filteredAvailabilityPeriodsCsv(
    source, ORG, "Not/AZone", view,
  )).toThrow(/valid business time zone/);
});

it("neutralizes formula cells and excludes private notes and cross-org matching names", () => {
  const formula = [
    record("private-person", "employees", { name: "@someone" }),
    record("formula", "availability", {
      title: "=HYPERLINK(\"unsafe\")", kind: "Day off",
      employee: "private-person", start: "2026-11-06T16:00:00Z",
      end: "2026-11-06T17:00:00Z",
      notes: "+DANGEROUS PRIVATE NOTE",
    }),
    record("foreign-person", "employees", {
      name: "FOREIGN ONLY",
    }, false, OTHER),
    record("foreign-linked", "availability", {
      title: "Unlinked person's shift", kind: "Working hours",
      employee: "foreign-person", start: "2026-11-06T16:00:00Z",
      end: "2026-11-06T17:00:00Z",
    }),
  ];
  const csv = filteredAvailabilityPeriodsCsv(formula, ORG, "UTC", view);
  expect(csv).toContain("\"'=HYPERLINK(\"\"unsafe\"\")\"");
  expect(csv).toContain("\"'@someone\"");
  expect(csv).not.toContain("DANGEROUS PRIVATE NOTE");
  expect(csv).not.toContain("FOREIGN ONLY");
  // A foreign subject name cannot be used as a search term.
  const missing = filteredAvailabilityPeriodsCsv(formula, ORG, "UTC", {
    ...view, search: "FOREIGN ONLY",
  });
  expect(missing.trimEnd().split("\r\n")).toHaveLength(1);
});
