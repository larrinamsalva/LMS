import { expect, it } from "vitest";
import { summarizeDailyOperations } from "../../src/core/daily-operations";
import { noSavedActivityDatesCsv } from "../../src/core/no-saved-activity-dates-csv";
import { datesWithoutSavedActivity, sevenDayWorkload } from "../../src/core/daily-operations-workload";
import type { WorkspaceRecord } from "../../src/core/engine";
import type { EquipmentState } from "../../src/core/equipment";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOTE = "NOT CONFIRMED AVAILABILITY - check schedules before planning";

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

function state(
  record_id: string, next_inspection: string,
  organization_id = ORG,
): EquipmentState {
  return {
    record_id, organization_id, revision: 1,
    asset_key: record_id, barcode_key: null,
    condition: "Serviceable", maintenance: "Clear",
    work_id: null, technician_id: null,
    last_service: null, next_inspection,
  };
}

function lines(csv: string): string[] {
  expect(csv.endsWith("\r\n")).toBe(true);
  expect(csv).not.toContain("\n\n");
  return csv.trimEnd().split("\r\n");
}

it("exports only the authorized empty dates, with an explicit caution on every row", () => {
  const records = [
    record("appointments", "visit", {
      title: "PRIVATE CUSTOMER VISIT", status: "Scheduled",
      start: "2026-11-06T18:30:00Z", end: "2026-11-06T19:30:00Z",
      phone: "PRIVATE CONTACT", notes: "PRIVATE NOTES",
    }),
    record("tasks", "task", {
      title: "PRIVATE TASK", status: "Open", due: "2026-11-07",
    }),
    record("equipment", "asset", { name: "PRIVATE EQUIPMENT" }),
    record("jobs", "foreign-job", {
      title: "FOREIGN PRIVATE JOB", status: "Planned", date: "2026-11-09",
    }, FOREIGN),
    record("appointments", "archived", {
      title: "ARCHIVED PRIVATE VISIT", status: "Scheduled",
      start: "2026-11-10T18:30:00Z", end: "2026-11-10T19:30:00Z",
    }, ORG, true),
    record("appointments", "cancelled", {
      title: "CANCELLED PRIVATE VISIT", status: "Cancelled",
      start: "2026-11-11T18:30:00Z", end: "2026-11-11T19:30:00Z",
    }),
  ];
  const states = [
    state("asset", "2026-11-08"),
    state("asset", "2026-11-09", FOREIGN),
  ];
  const before = structuredClone({ records, states });
  const overview = summarizeDailyOperations({
    organizationId: ORG, records, equipmentStates: states,
  }, "America/Los_Angeles", "2026-11-05");
  const enabled = noSavedActivityDatesCsv(overview, "America/Los_Angeles", true);
  const rows = lines(enabled);
  expect(rows).toHaveLength(5); // Header + four dates Nov 9–12.
  expect(rows[0]).toBe(
    '"Starting after","Through (inclusive)","Business-local date",' +
    '"Saved activity","Planning note","Business time zone"',
  );
  expect(rows.slice(1)).toEqual([
    "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12",
  ].map((date) =>
    '"2026-11-05","2026-11-12","' + date +
    '","None recorded","' + NOTE + '","America/Los_Angeles"',
  ));
  const disabled = noSavedActivityDatesCsv(
    overview, "America/Los_Angeles", false,
  );
  expect(lines(disabled)).toHaveLength(6); // Inspection-only date added.
  expect(disabled).toContain('"2026-11-08","None recorded"');
  expect(enabled).not.toContain('"2026-11-08","None recorded"');
  for (const hidden of [
    "PRIVATE CUSTOMER", "PRIVATE CONTACT", "PRIVATE NOTES",
    "PRIVATE TASK", "PRIVATE EQUIPMENT", "FOREIGN PRIVATE",
    "ARCHIVED PRIVATE", "CANCELLED PRIVATE",
  ]) {
    expect(enabled).not.toContain(hidden);
    expect(disabled).not.toContain(hidden);
  }
  expect({ records, states }).toEqual(before);
});

it("keeps empty weeks, fully occupied weeks and leap/DST dates calendar-correct", () => {
  for (const [selected, expectedFirst, expectedLast] of [
    ["2026-10-31", "2026-11-01", "2026-11-07"],
    ["2028-02-26", "2028-02-27", "2028-03-04"],
  ]) {
    const empty = summarizeDailyOperations({
      organizationId: ORG, records: [], equipmentStates: [],
    }, "America/Los_Angeles", selected);
    const csv = noSavedActivityDatesCsv(empty, "America/Los_Angeles", true);
    const exported = lines(csv);
    expect(exported).toHaveLength(8); // Header + 7 empty dates.
    expect(exported[1]).toContain('"' + expectedFirst + '"');
    expect(exported[7]).toContain('"' + expectedLast + '"');
    exported.slice(1).forEach((row) => {
      expect(row).toContain('"' + NOTE + '"');
      expect(row).toContain('"None recorded"');
    });
  }
  const allDates = [
    "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09",
    "2026-11-10", "2026-11-11", "2026-11-12",
  ];
  const filled = summarizeDailyOperations({
    organizationId: ORG,
    records: allDates.map((due, i) =>
      record("tasks", "due-" + i, {
        title: "Fictional work " + i, status: "Open", due,
      }),
    ),
    equipmentStates: [],
  }, "UTC", "2026-11-05");
  const csv = noSavedActivityDatesCsv(filled, "UTC", false);
  expect(lines(csv)).toHaveLength(1);
  expect(csv).toContain('"Planning note"');
});

it("recomputes canonical dates after saved records change, independent of screen filters", () => {
  const task = record("tasks", "mutable", {
    title: "Fictional work", status: "Open", due: "2026-11-06",
  });
  const records = [task];
  const first = summarizeDailyOperations({
    organizationId: ORG, records, equipmentStates: [],
  }, "UTC", "2026-11-05");
  const firstCsv = noSavedActivityDatesCsv(first, "UTC", false);
  expect(firstCsv).not.toContain('"2026-11-06","None recorded"');
  // The exporter receives only the authorized overview and cannot read
  // arbitrary UI dates or forged per-day counts. Its output agrees with the
  // canonical seven-day workload complement.
  const canonical = datesWithoutSavedActivity(
    sevenDayWorkload(first, "UTC"), false,
  );
  const rows = lines(firstCsv);
  expect(rows.length - 1).toBe(canonical.length);
  canonical.forEach((day, i) => expect(rows[i + 1]).toContain('"' + day.date + '"'));
  task.data.due = "2026-11-07";
  const second = summarizeDailyOperations({
    organizationId: ORG, records, equipmentStates: [],
  }, "UTC", "2026-11-05");
  const secondCsv = noSavedActivityDatesCsv(second, "UTC", false);
  expect(secondCsv).toContain('"2026-11-06","None recorded"');
  expect(secondCsv).not.toContain('"2026-11-07","None recorded"');
  expect(secondCsv).not.toBe(firstCsv);
});
