import { expect, it } from "vitest";
import { summarizeDailyOperations } from "../../src/core/daily-operations";
import { csvSafeCell } from "../../src/core/daily-operations-csv";
import { sevenDayOutlookCsv } from "../../src/core/seven-day-outlook-csv";
import { displayTime, localTime } from "../../src/core/time";
import type { WorkspaceRecord } from "../../src/core/engine";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
type Outlook = ReturnType<typeof summarizeDailyOperations>;

// Independent reference: the unchanged row construction, sort, escaping,
// line endings, and per-appointment displayTime/localTime calls from #185.
function previousOutlookCsv(outlook: Outlook, zone: string): string {
  const header = [
    "Starting after", "Through (inclusive)", "Type", "Title",
    "Appointment time or work due date", "Status", "Business time zone",
  ];
  const rows: { sortKey: string; title: string; values: string[] }[] = [];
  function row(type: string, title: string, when: string, status: string, key: string) {
    rows.push({
      sortKey: key, title,
      values: [outlook.date, outlook.upcomingThrough, type, title, when, status, zone],
    });
  }
  for (const appointment of outlook.upcomingAppointments) {
    const start = String(appointment.data.start);
    row(
      "Appointment", String(appointment.data.title),
      displayTime(start, zone), String(appointment.data.status),
      localTime(start, zone),
    );
  }
  for (const { record, due } of outlook.upcoming) {
    row(
      record.entity === "jobs" ? "Cleaning job" : "Task",
      String(record.data.title), due, String(record.data.status),
      due + "T00:00",
    );
  }
  rows.sort(
    (a, b) => a.sortKey.localeCompare(b.sortKey) ||
      a.title.localeCompare(b.title),
  );
  return [header, ...rows.map((entry) => entry.values)]
    .map((fields) => fields.map(csvSafeCell).join(","))
    .join("\r\n") + "\r\n";
}

function record(
  entity: string, id: string, data: WorkspaceRecord["data"],
  organization_id = ORG, archived = false,
): WorkspaceRecord {
  return {
    entity, id, data, organization_id, archived,
    revision: 1, config_revision: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function sameCsv(outlook: Outlook, zone: string): string {
  const expected = previousOutlookCsv(outlook, zone);
  const actual = sevenDayOutlookCsv(outlook, zone);
  expect(actual).toBe(expected);
  return actual;
}

it("matches the old exact CSV for 720 fictional appointments with repeated starts", () => {
  const startTimes = [
    "2026-11-01T08:30:00Z", "2026-11-01T01:30:00-07:00",
    "2026-11-01T09:30:00Z", "2026-11-01T01:30:00-08:00",
    "2026-11-02T08:00:00Z", "2026-11-06T18:30:00Z",
    "2026-11-07T08:30:00Z", "2026-11-12T18:30:00Z",
    "2026-11-13T07:30:00Z", "2026-11-13T08:00:00Z",
    "2026-03-08T09:30:00Z", "2026-03-08T10:30:00Z",
    "2026-03-09T07:00:00Z", "2028-02-29T18:30:00Z",
    "2028-03-01T18:30:00Z",
  ];
  const records: WorkspaceRecord[] = Array.from(
    { length: 720 }, (_, i) => {
      const start = startTimes[i % startTimes.length];
      const end = new Date(Date.parse(start) + 30 * 60_000).toISOString();
      return record("appointments", "visit-" + (i % 199), {
        title: i % 7 === 0 ? "=HYPERLINK(\"fictional\")" : "Fictional visit " + i,
        start, end, status: i % 11 === 0 ? "Cancelled" : "Scheduled",
        notes: "PRIVATE APPOINTMENT NOTES",
        phone: "PRIVATE APPOINTMENT PHONE",
      }, i % 17 === 0 ? FOREIGN : ORG, i % 23 === 0);
    },
  );
  const dueDates = [
    "2026-11-01", "2026-11-05", "2026-11-06", "2026-11-12",
    "2026-11-13", "2026-03-08", "2028-02-29", "",
  ];
  for (let i = 0; i < 240; i++) {
    const entity = i % 2 === 0 ? "tasks" : "jobs";
    const field = entity === "tasks" ? "due" : "date";
    const data: WorkspaceRecord["data"] = {
      title: i % 9 === 0 ? "\t=FAKE_FORMULA()" : "Fictional work " + i,
      status: i % 11 === 0 ? "Done" : "Open",
      notes: "PRIVATE WORK NOTES",
      [field]: dueDates[i % dueDates.length],
    };
    records.push(record(entity, "work-" + (i % 73), data,
      i % 29 === 0 ? FOREIGN : ORG, i % 31 === 0));
  }
  const repeated = record("appointments", "duplicate", {
    title: "Repeated retained appointment", status: "Scheduled",
    start: "2026-11-06T18:30:00Z",
    end: "2026-11-06T19:00:00Z",
  });
  records.push(repeated, repeated);
  records.push(
    record("appointments", "other", {
      title: "FOREIGN PRIVATE BOOKING", status: "Scheduled",
      start: "2026-11-06T18:30:00Z", end: "2026-11-06T19:00:00Z",
    }, FOREIGN),
    record("appointments", "archived", {
      title: "ARCHIVED PRIVATE BOOKING", status: "Scheduled",
      start: "2026-11-06T18:30:00Z", end: "2026-11-06T19:00:00Z",
    }, ORG, true),
  );
  const original = structuredClone(records);
  for (const zone of ["UTC", "America/Los_Angeles", "America/New_York"]) {
    for (const date of [
      "2026-10-31", "2026-11-01", "2026-11-05",
      "2026-03-07", "2028-02-26",
    ]) {
      const summary = summarizeDailyOperations({
        organizationId: ORG, records, equipmentStates: [],
      }, zone, date);
      const csv = sameCsv(summary, zone);
      expect(csv).toMatch(/^"Starting after","Through \(inclusive\)"/);
      expect(csv.endsWith("\r\n")).toBe(true);
      expect(csv).not.toContain("FOREIGN PRIVATE BOOKING");
      expect(csv).not.toContain("ARCHIVED PRIVATE BOOKING");
      expect(csv).not.toContain("PRIVATE APPOINTMENT NOTES");
      expect(csv).not.toContain("PRIVATE APPOINTMENT PHONE");
      expect(csv).not.toContain("PRIVATE WORK NOTES");
      expect(csv).not.toContain(',"=HYPERLINK(');
    }
  }
  expect(records).toEqual(original);
});

it("retains stable ties and CSV formula escaping for repeated appointments", () => {
  const items = [
    record("appointments", "a", {
      title: "=FAKEFORMULA()", status: "Scheduled",
      start: "2026-11-06T18:30:00Z", end: "2026-11-06T19:00:00Z",
    }),
    record("appointments", "b", {
      title: "Fictional B", status: "Scheduled",
      start: "2026-11-06T10:30:00-08:00",
      end: "2026-11-06T11:00:00-08:00",
    }),
    record("appointments", "c", {
      title: "Fictional C", status: "Scheduled",
      start: "2026-11-06T18:30:00Z", end: "2026-11-06T19:00:00Z",
    }),
    record("jobs", "j", {
      title: "Fictional same day job", status: "Planned", date: "2026-11-06",
    }),
  ];
  const overview = summarizeDailyOperations({
    organizationId: ORG, records: items, equipmentStates: [],
  }, "America/Los_Angeles", "2026-11-05");
  const csv = sameCsv(overview, "America/Los_Angeles");
  const lines = csv.trimEnd().split("\r\n");
  expect(lines[1]).toContain("Fictional same day job");
  expect(lines[2]).toContain("'=FAKEFORMULA()");
  expect(lines[3]).toContain("Fictional B");
  expect(lines[4]).toContain("Fictional C");
  expect(csv).toContain("2026-11-06 10:30-08:00");
});

it("does not carry cached formatted starts across changed exports or time zones", () => {
  const item = record("appointments", "mutable", {
    title: "Fictional visit", status: "Scheduled",
    start: "2026-11-06T18:30:00Z", end: "2026-11-06T19:30:00Z",
  });
  const records = [item, item];
  const compare = (zone: string, date: string) => {
    const summary = summarizeDailyOperations({
      organizationId: ORG, records, equipmentStates: [],
    }, zone, date);
    return sameCsv(summary, zone);
  };
  const utc = compare("UTC", "2026-11-05");
  const la = compare("America/Los_Angeles", "2026-11-05");
  expect(utc).not.toBe(la);
  item.data.start = "2026-11-07T18:30:00Z";
  item.data.end = "2026-11-07T19:30:00Z";
  const moved = compare("UTC", "2026-11-05");
  expect(moved).not.toBe(utc);
  compare("America/New_York", "2026-11-06");
});

it("preserves empty CSVs, malformed excluded records, and invalid included times", () => {
  const invalidExcluded = [
    record("appointments", "cancel", {
      title: "Cancelled bad time", status: "Cancelled",
      start: "invalid", end: "invalid",
    }),
    record("appointments", "archived", {
      title: "Archived bad time", status: "Scheduled",
      start: "invalid", end: "invalid",
    }, ORG, true),
    record("appointments", "foreign", {
      title: "Foreign bad time", status: "Scheduled",
      start: "invalid", end: "invalid",
    }, FOREIGN),
  ];
  const overview = summarizeDailyOperations({
    organizationId: ORG, records: invalidExcluded, equipmentStates: [],
  }, "UTC", "2026-11-05");
  expect(sameCsv(overview, "UTC").trimEnd().split("\r\n")).toHaveLength(1);
  const item = record("appointments", "start", {
    title: "Fictional", status: "Scheduled",
    start: "2026-11-06T18:30:00Z", end: "2026-11-06T19:00:00Z",
  });
  const selected = summarizeDailyOperations({
    organizationId: ORG, records: [item], equipmentStates: [],
  }, "UTC", "2026-11-05");
  // Editing a legacy already-selected record after the summary is built
  // must still produce the original parse error in the export.
  item.data.start = "not-a-time";
  expect(() => previousOutlookCsv(selected, "UTC")).toThrow();
  expect(() => sevenDayOutlookCsv(selected, "UTC")).toThrow();
});
