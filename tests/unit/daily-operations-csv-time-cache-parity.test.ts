import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import type { EquipmentState } from "../../src/core/equipment";
import { summarizeDailyOperations } from "../../src/core/daily-operations";
import { dailyOperationsCsv, csvSafeCell } from "../../src/core/daily-operations-csv";
import { displayTime } from "../../src/core/time";

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

// Independent implementation copied from merged five-green LMS #171.
// Originally every appointment scheduled start was formatted separately.
function previousCsv(
  overview: ReturnType<typeof summarizeDailyOperations>,
  zone: string,
  includeEquipment: boolean,
): string {
  const rows: string[][] = [[
    "Selected date", "Type", "Title", "Time or due date",
    "Status or reason", "Business time zone",
  ]];
  for (const appointment of overview.appointments) {
    rows.push([
      overview.date, "Appointment", String(appointment.data.title),
      displayTime(String(appointment.data.start), zone),
      String(appointment.data.status), zone,
    ]);
  }
  for (const { record: item, due } of overview.overdue) {
    rows.push([
      overview.date, "Overdue work", String(item.data.title), due,
      String(item.data.status), zone,
    ]);
  }
  for (const { record: item, due } of overview.dueToday) {
    rows.push([
      overview.date, "Work due today", String(item.data.title), due,
      String(item.data.status), zone,
    ]);
  }
  if (includeEquipment) {
    for (const { record: item, reason } of overview.equipment) {
      rows.push([
        overview.date, "Equipment attention", String(item.data.name),
        "", reason, zone,
      ]);
    }
  }
  return rows.map((row) => row.map(csvSafeCell).join(",")).join("\r\n") + "\r\n";
}

it("preserves exact Daily Operations CSV bytes over 720 fictional appointments and DST days", () => {
  const appointments: Array<readonly [string, string]> = [
    ["2026-11-01T08:30:00Z", "2026-11-01T08:45:00Z"], // first 1:30 fold
    ["2026-11-01T09:30:00Z", "2026-11-01T09:45:00Z"], // second 1:30 fold
    ["2026-11-01T15:00:00Z", "2026-11-01T15:30:00Z"],
    ["2026-11-02T08:00:00Z", "2026-11-02T08:30:00Z"], // next LA midnight
    ["2026-03-08T09:30:00Z", "2026-03-08T09:45:00Z"], // spring 1:30
    ["2026-03-08T10:30:00Z", "2026-03-08T10:45:00Z"], // spring 3:30
    ["2026-03-09T07:00:00Z", "2026-03-09T07:15:00Z"],
    ["2026-11-06T18:30:00Z", "2026-11-06T19:30:00Z"],
  ];
  const records: WorkspaceRecord[] = Array.from({ length: 720 }, (_, i) => {
    const [start, end] = appointments[i % appointments.length];
    return record("appointments", "appointment-" + (i % 300), {
      title: i % 17 === 0 ? "=HYPERLINK(\"fake\")"
        : i % 19 === 0 ? "@Fictional Title" : "Fictional Visit " + i,
      status: i % 13 === 0 ? "Cancelled" : "Scheduled",
      start, end, notes: "PRIVATE APPOINTMENT NOTE",
    }, i % 23 === 0 ? FOREIGN : ORG, i % 29 === 0);
  });
  // Historical duplicate object references and separate revisions must not
  // disappear from the export, or alter source selection/order.
  const duplicate = record("appointments", "duplicate-revision", {
    title: "Repeated Visit", status: "Scheduled",
    start: "2026-11-01T08:30:00Z", end: "2026-11-01T08:45:00Z",
  });
  records.push(duplicate, duplicate, record("appointments", "duplicate-revision", {
    title: "Independent Revision", status: "Scheduled",
    start: "2026-11-01T09:30:00Z", end: "2026-11-01T09:45:00Z",
  }));
  records.push(
    record("jobs", "overdue", {
      title: "+Risky Job", status: "Planned", date: "2026-10-31",
    }),
    record("tasks", "due", {
      title: "@Risky Task", status: "Open", due: "2026-11-01",
    }),
    record("tasks", "foreign", {
      title: "FOREIGN PRIVATE TASK", status: "Open", due: "2026-11-01",
    }, FOREIGN),
    record("equipment", "asset", { name: "Fictional Scrubber" }),
    record("equipment", "foreign-asset", { name: "FOREIGN ASSET" }, FOREIGN),
  );
  const states: EquipmentState[] = [{
    organization_id: ORG,
    record_id: "asset", revision: 1, asset_key: "asset",
    barcode_key: null, condition: "Needs inspection",
    maintenance: "Clear", work_id: null, technician_id: null,
    last_service: null, next_inspection: null,
  }];
  const before = structuredClone({ records, states });
  for (const zone of ["America/Los_Angeles", "America/New_York", "UTC"]) {
    for (const date of [
      "2026-11-01", "2026-11-02", "2026-03-08", "2026-03-09",
      "2026-11-06", "2026-10-30",
    ]) {
      const summary = summarizeDailyOperations({
        organizationId: ORG, records, equipmentStates: states,
      }, zone, date);
      for (const includeEquipment of [false, true]) {
        const actual = dailyOperationsCsv(summary, zone, includeEquipment);
        const expected = previousCsv(summary, zone, includeEquipment);
        expect(actual).toBe(expected);
        expect(actual).not.toContain("FOREIGN PRIVATE TASK");
        expect(actual).not.toContain("FOREIGN ASSET");
        expect(actual).not.toContain("PRIVATE APPOINTMENT NOTE");
      }
    }
  }
  expect({ records, states }).toEqual(before);
});

it("reformats each independent export with its own zone, including DST-fold offsets", () => {
  const recordOne = record("appointments", "one", {
    title: "First Fold", status: "Scheduled",
    start: "2026-11-01T08:30:00Z", end: "2026-11-01T08:45:00Z",
  });
  const recordTwo = record("appointments", "two", {
    title: "Second Fold", status: "Scheduled",
    start: "2026-11-01T09:30:00Z", end: "2026-11-01T09:45:00Z",
  });
  const overview = summarizeDailyOperations({
    organizationId: ORG, records: [recordOne, recordTwo],
    equipmentStates: [],
  }, "America/Los_Angeles", "2026-11-01");
  const pacific = dailyOperationsCsv(overview, "America/Los_Angeles", false);
  const utc = dailyOperationsCsv(overview, "UTC", false);
  expect(pacific).toContain('"2026-11-01 01:30-07:00"');
  expect(pacific).toContain('"2026-11-01 01:30-08:00"');
  expect(utc).toContain('"2026-11-01 08:30+00:00"');
  expect(utc).toContain('"2026-11-01 09:30+00:00"');
  expect(pacific).toBe(previousCsv(overview, "America/Los_Angeles", false));
  expect(utc).toBe(previousCsv(overview, "UTC", false));
});

it("keeps non-string starts uncached and preserves original errors and empty exports", () => {
  const one = record("appointments", "one", {
    title: "Fictional Example", status: "Scheduled",
    start: "2026-11-06T18:30:00Z", end: "2026-11-06T19:00:00Z",
  });
  const overview = summarizeDailyOperations({
    organizationId: ORG, records: [one], equipmentStates: [],
  }, "UTC", "2026-11-06");
  const originalStart = one.data.start;
  one.data.start = { toString: () => "2026-11-06T18:30:00Z" };
  expect(dailyOperationsCsv(overview, "UTC", false)).toBe(
    previousCsv(overview, "UTC", false),
  );
  one.data.start = 17;
  expect(() => dailyOperationsCsv(overview, "UTC", false)).toThrow();
  expect(() => previousCsv(overview, "UTC", false)).toThrow();
  one.data.start = originalStart;
  const empty = summarizeDailyOperations({
    organizationId: ORG, records: [], equipmentStates: [],
  }, "UTC", "2026-11-06");
  expect(dailyOperationsCsv(empty, "UTC", true)).toBe(
    previousCsv(empty, "UTC", true),
  );
});
