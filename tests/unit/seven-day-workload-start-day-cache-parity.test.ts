import { Temporal } from "@js-temporal/polyfill";
import { expect, it } from "vitest";
import { summarizeDailyOperations } from "../../src/core/daily-operations";
import {
  sevenDayWorkload,
  type DailyWorkload,
} from "../../src/core/daily-operations-workload";
import { sevenDayWorkloadCsv } from "../../src/core/seven-day-workload-csv";
import { localDate } from "../../src/core/time";
import type { WorkspaceRecord } from "../../src/core/engine";
import type { EquipmentState } from "../../src/core/equipment";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function record(
  entity: string, id: string, data: WorkspaceRecord["data"],
  organization_id = ORG, archived = false,
): WorkspaceRecord {
  return {
    id, entity, data, organization_id, archived,
    revision: 1, config_revision: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function equipmentState(record_id: string, date: string): EquipmentState {
  return {
    organization_id: ORG, record_id, revision: 1,
    asset_key: record_id, barcode_key: null, condition: "Serviceable",
    maintenance: "Clear", work_id: null, technician_id: null,
    last_service: null, next_inspection: date,
  };
}

// Independent pre-cache implementation from verified five-green LMS #172.
// Each scheduled start is converted separately, even when strings repeat.
function previousSevenDayWorkload(
  overview: ReturnType<typeof summarizeDailyOperations>,
  zone: string,
): DailyWorkload[] {
  const selected = Temporal.PlainDate.from(overview.date);
  const days: DailyWorkload[] = Array.from({ length: 7 }, (_, offset) => ({
    date: selected.add({ days: offset + 1 }).toString(),
    appointments: 0,
    unfinishedWork: 0,
    inspections: 0,
  }));
  const byDate = new Map(days.map((day) => [day.date, day]));
  for (const item of overview.upcomingAppointments) {
    const date = localDate(String(item.data.start), zone);
    const day = byDate.get(date);
    if (day) day.appointments += 1;
  }
  for (const item of overview.upcoming) {
    const day = byDate.get(item.due);
    if (day) day.unfinishedWork += 1;
  }
  for (const item of overview.upcomingEquipmentInspections) {
    const day = byDate.get(item.due);
    if (day) day.inspections += 1;
  }
  return days;
}

it("preserves seven business-local workload counts for 720 fictional appointment records", () => {
  const starts = [
    "2026-11-01T08:30:00Z", "2026-11-01T09:30:00Z",
    "2026-11-02T08:00:00Z", "2026-11-06T18:30:00Z",
    "2026-11-07T07:30:00Z", "2026-11-07T08:30:00Z",
    "2026-03-08T09:30:00Z", "2026-03-08T10:30:00Z",
    "2026-03-09T07:00:00Z", "2026-03-14T18:00:00Z",
    "2028-02-28T18:00:00Z", "2028-02-29T18:00:00Z",
    "2028-03-01T18:00:00Z",
  ];
  const records: WorkspaceRecord[] = Array.from(
    { length: 720 }, (_, i) => {
      const start = starts[i % starts.length];
      const end = new Date(Date.parse(start) + 30 * 60_000).toISOString();
      return record("appointments", "appointment-" + (i % 240), {
        title: "Fictional visit " + i,
        status: i % 13 === 0 ? "Cancelled" : "Scheduled",
        start, end, notes: "PRIVATE NOTE",
      }, i % 29 === 0 ? FOREIGN : ORG, i % 31 === 0);
    },
  );
  const duplicate = record("appointments", "repeated", {
    title: "Identical historical reference", status: "Scheduled",
    start: "2026-11-01T08:30:00Z", end: "2026-11-01T08:45:00Z",
  });
  records.push(duplicate, duplicate,
    record("appointments", "repeated", {
      title: "Second DST fold", status: "Scheduled",
      start: "2026-11-01T09:30:00Z", end: "2026-11-01T09:45:00Z",
    }),
    record("jobs", "work", {
      title: "Fictional task", status: "Planned", date: "2026-11-03",
    }),
    record("tasks", "spring-work", {
      title: "Fictional repair", status: "Open", due: "2026-03-09",
    }),
    record("tasks", "foreign-work", {
      title: "FOREIGN PRIVATE TASK", status: "Open", due: "2026-11-03",
    }, FOREIGN),
    record("equipment", "scrubber", { name: "Fictional scrubber" }),
    record("equipment", "foreign-tool", { name: "FOREIGN EQUIPMENT" }, FOREIGN),
  );
  const equipmentStates = [equipmentState("scrubber", "2026-11-04")];
  const original = structuredClone({ records, equipmentStates });
  for (const zone of ["UTC", "America/Los_Angeles", "America/New_York"]) {
    for (const selected of ["2026-10-31", "2026-11-05", "2026-03-07", "2028-02-26"]) {
      const overview = summarizeDailyOperations(
        { organizationId: ORG, records, equipmentStates }, zone, selected,
      );
      const expected = previousSevenDayWorkload(overview, zone);
      const actual = sevenDayWorkload(overview, zone);
      expect(actual).toEqual(expected);
      expect(actual).toHaveLength(7);
      expect(actual).not.toBe(expected);
      actual.forEach((day, i) => {
        expect(day).toEqual(expected[i]);
        expect(day).not.toBe(expected[i]);
      });
      // The public workload CSV must retain its original output.
      const csv = sevenDayWorkloadCsv(overview, zone, true);
      expect(csv).toContain('"TOTAL (7 days)"');
      expect(csv).not.toContain("FOREIGN PRIVATE TASK");
      expect(csv).not.toContain("FOREIGN EQUIPMENT");
    }
  }
  expect({ records, equipmentStates }).toEqual(original);
});

it("preserves DST-fold and leap-day calendar dates, with duplicate occurrences", () => {
  const same = record("appointments", "same", {
    title: "Fold one", status: "Scheduled",
    start: "2026-11-01T08:30:00Z", end: "2026-11-01T08:45:00Z",
  });
  const second = record("appointments", "second", {
    title: "Fold two", status: "Scheduled",
    start: "2026-11-01T09:30:00Z", end: "2026-11-01T09:45:00Z",
  });
  const overview = summarizeDailyOperations(
    { organizationId: ORG, records: [same, same, second], equipmentStates: [] },
    "America/Los_Angeles", "2026-10-31",
  );
  const actual = sevenDayWorkload(overview, "America/Los_Angeles");
  expect(actual).toEqual(previousSevenDayWorkload(overview, "America/Los_Angeles"));
  expect(actual[0]).toEqual({
    date: "2026-11-01", appointments: 3, unfinishedWork: 0, inspections: 0,
  });
  const leap = summarizeDailyOperations(
    { organizationId: ORG, records: [], equipmentStates: [] },
    "UTC", "2028-02-26",
  );
  expect(sevenDayWorkload(leap, "UTC").map((day) => day.date)).toEqual([
    "2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01",
    "2028-03-02", "2028-03-03", "2028-03-04",
  ]);
});

it("keeps local-time parsing isolated across calls, data changes and invalid non-string starts", () => {
  const appointment = record("appointments", "future", {
    title: "Fictional visit", status: "Scheduled",
    start: "2026-11-06T08:30:00Z", end: "2026-11-06T09:00:00Z",
  });
  const overview = summarizeDailyOperations(
    { organizationId: ORG, records: [appointment, appointment],
      equipmentStates: [] },
    "UTC", "2026-11-05",
  );
  const compare = (zone: string) => {
    expect(sevenDayWorkload(overview, zone)).toEqual(
      previousSevenDayWorkload(overview, zone),
    );
  };
  compare("UTC");
  compare("America/Los_Angeles");
  appointment.data.start = "2026-11-07T08:30:00Z";
  compare("UTC");
  compare("America/Los_Angeles");
  appointment.data.start = 17;
  expect(() => sevenDayWorkload(overview, "UTC")).toThrow();
  expect(() => previousSevenDayWorkload(overview, "UTC")).toThrow();
  appointment.data.start = "2026-11-06T08:30:00Z";
  compare("UTC");
});
