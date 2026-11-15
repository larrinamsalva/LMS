import { Temporal } from "@js-temporal/polyfill";
import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import { summarizeDailyOperations } from "../../src/core/daily-operations";
import { instant } from "../../src/core/time";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function record(
  id: string, entity: string, data: WorkspaceRecord["data"],
  organization_id = ORG, archived = false,
): WorkspaceRecord {
  return {
    id, entity, data, organization_id, archived,
    revision: 1, config_revision: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

// Independent reference from verified five-green LMS #177.
// Today's appointments had a per-call dayInstants cache, while upcoming
// appointments separately built another per-call upcomingStarts cache.
// Preserve both original filters, their invalid-date behavior and comparator.
function previousAppointmentViews(
  records: readonly WorkspaceRecord[],
  organizationId: string,
  zone: string,
  date: string,
): { today: WorkspaceRecord[]; upcoming: WorkspaceRecord[] } {
  const day = Temporal.PlainDate.from(date);
  const from = day.toZonedDateTime(zone).epochNanoseconds;
  const until = day.add({ days: 1 }).toZonedDateTime(zone).epochNanoseconds;
  const upcomingEnd = day.add({ days: 8 }).toZonedDateTime(zone).epochNanoseconds;
  const scoped = records.filter(
    (r) => r.organization_id === organizationId && !r.archived,
  );
  const dayInstants = new Map<string, bigint>();
  const dayInstant = (value: unknown): bigint => {
    if (typeof value !== "string") return instant(String(value)).epochNanoseconds;
    const cached = dayInstants.get(value);
    if (cached !== undefined) return cached;
    const parsed = instant(value).epochNanoseconds;
    dayInstants.set(value, parsed);
    return parsed;
  };
  const today = scoped.filter(
    (r) => r.entity === "appointments" &&
      r.data.status !== "Cancelled" &&
      dayInstant(r.data.start) < until &&
      dayInstant(r.data.end) > from,
  ).sort((a, b) => Temporal.Instant.compare(
    instant(String(a.data.start)), instant(String(b.data.start)),
  ));
  const upcomingStarts = new Map<string, bigint>();
  const upcoming = scoped.filter((r) => {
    if (r.entity !== "appointments" || r.data.status === "Cancelled") {
      return false;
    }
    const value = r.data.start;
    if (typeof value !== "string") {
      return instant(String(r.data.start)).epochNanoseconds >= until &&
        instant(String(r.data.start)).epochNanoseconds < upcomingEnd;
    }
    let parsed = upcomingStarts.get(value);
    if (parsed === undefined) {
      parsed = instant(value).epochNanoseconds;
      upcomingStarts.set(value, parsed);
    }
    return parsed >= until && parsed < upcomingEnd;
  }).sort((a, b) => Temporal.Instant.compare(
    instant(String(a.data.start)), instant(String(b.data.start)),
  ));
  return { today, upcoming };
}

function assertExactRecords(
  actual: readonly WorkspaceRecord[], expected: readonly WorkspaceRecord[],
): void {
  expect(actual).toHaveLength(expected.length);
  expect(actual).toEqual(expected);
  actual.forEach((row, index) => expect(row).toBe(expected[index]));
}

it("preserves both day-overlap and next-seven-day appointment lists across 720 fictional revisions", () => {
  const ranges: Array<readonly [string, string]> = [
    ["2026-11-01T06:30:00Z", "2026-11-01T07:30:00Z"],
    ["2026-11-01T08:30:00Z", "2026-11-01T08:45:00Z"],
    ["2026-11-01T09:30:00Z", "2026-11-01T09:45:00Z"],
    ["2026-11-02T07:30:00Z", "2026-11-02T08:30:00Z"],
    ["2026-11-02T08:00:00Z", "2026-11-02T08:30:00Z"],
    ["2026-11-06T18:30:00Z", "2026-11-06T19:30:00Z"],
    ["2026-11-07T07:30:00Z", "2026-11-07T08:30:00Z"],
    ["2026-11-07T08:30:00Z", "2026-11-07T09:00:00Z"],
    ["2026-03-08T09:30:00Z", "2026-03-08T09:45:00Z"],
    ["2026-03-08T10:30:00Z", "2026-03-08T10:45:00Z"],
    ["2026-03-09T07:00:00Z", "2026-03-09T07:15:00Z"],
    ["2028-02-29T18:00:00Z", "2028-02-29T18:30:00Z"],
    ["2028-03-01T08:00:00Z", "2028-03-01T08:30:00Z"],
  ];
  const records: WorkspaceRecord[] = Array.from({ length: 720 }, (_, i) => {
    const [start, end] = ranges[i % ranges.length];
    return record("appointment-" + (i % 238), "appointments", {
      title: "Fictional visit " + i,
      start, end, status: i % 13 === 0 ? "Cancelled" : "Scheduled",
      notes: "PRIVATE CUSTOMER NOTES",
    }, i % 19 === 0 ? FOREIGN : ORG, i % 23 === 0);
  });
  const repeat = record("same-revision", "appointments", {
    title: "Repeated retained revision", status: "Scheduled",
    start: "2026-11-01T08:30:00Z", end: "2026-11-01T08:45:00Z",
  });
  records.push(
    repeat, repeat,
    record("same-revision", "appointments", {
      title: "Different revision, same ID", status: "Scheduled",
      start: "2026-11-01T09:30:00Z", end: "2026-11-01T09:45:00Z",
    }),
    record("unrelated", "tasks", {
      title: "Non-appointment", status: "Open", due: "2026-11-01",
    }),
    record("archived", "appointments", {
      title: "ARCHIVED BOOKING", status: "Scheduled",
      start: "2026-11-01T08:30:00Z", end: "2026-11-01T08:45:00Z",
    }, ORG, true),
    record("foreign", "appointments", {
      title: "FOREIGN PRIVATE BOOKING", status: "Scheduled",
      start: "2026-11-01T08:30:00Z", end: "2026-11-01T08:45:00Z",
    }, FOREIGN),
  );
  const original = structuredClone(records);
  for (const zone of ["UTC", "America/Los_Angeles", "America/New_York"]) {
    for (const date of [
      "2026-10-31", "2026-11-01", "2026-11-05",
      "2026-03-07", "2026-03-08", "2028-02-26",
    ]) {
      const expected = previousAppointmentViews(records, ORG, zone, date);
      const overview = summarizeDailyOperations(
        { organizationId: ORG, records, equipmentStates: [] }, zone, date,
      );
      assertExactRecords(overview.appointments, expected.today);
      assertExactRecords(overview.upcomingAppointments, expected.upcoming);
      for (const item of [...overview.appointments, ...overview.upcomingAppointments]) {
        expect(item.organization_id).toBe(ORG);
        expect(item.archived).toBe(false);
        expect(item.entity).toBe("appointments");
      }
    }
  }
  expect(records).toEqual(original);
});

it("preserves both local 01:30 fall-back appointments and excludes next midnight from today", () => {
  const records = [
    record("one", "appointments", {
      title: "First fold", status: "Scheduled",
      start: "2026-11-01T08:30:00Z", end: "2026-11-01T08:45:00Z",
    }),
    record("two", "appointments", {
      title: "Second fold", status: "Scheduled",
      start: "2026-11-01T09:30:00Z", end: "2026-11-01T09:45:00Z",
    }),
    record("three", "appointments", {
      title: "Midnight next day", status: "Scheduled",
      start: "2026-11-02T08:00:00Z", end: "2026-11-02T08:30:00Z",
    }),
  ];
  const overview = summarizeDailyOperations(
    { organizationId: ORG, records, equipmentStates: [] },
    "America/Los_Angeles", "2026-11-01",
  );
  expect(overview.appointments.map((row) => row.id)).toEqual(["one", "two"]);
  expect(overview.upcomingAppointments.map((row) => row.id)).toEqual(["three"]);
  const expected = previousAppointmentViews(
    records, ORG, "America/Los_Angeles", "2026-11-01",
  );
  assertExactRecords(overview.appointments, expected.today);
  assertExactRecords(overview.upcomingAppointments, expected.upcoming);
});

it("does not carry start/end parsing across calls, zones, or record changes", () => {
  const repeated = record("mutable", "appointments", {
    title: "Mutable fictional visit", status: "Scheduled",
    start: "2026-11-06T18:30:00Z", end: "2026-11-06T19:30:00Z",
  });
  const records = [repeated, repeated];
  const check = (zone: string, date: string) => {
    const expected = previousAppointmentViews(records, ORG, zone, date);
    const overview = summarizeDailyOperations(
      { organizationId: ORG, records, equipmentStates: [] }, zone, date,
    );
    assertExactRecords(overview.appointments, expected.today);
    assertExactRecords(overview.upcomingAppointments, expected.upcoming);
  };
  check("UTC", "2026-11-05");
  check("UTC", "2026-11-06");
  check("America/Los_Angeles", "2026-11-06");
  repeated.data.start = "2026-11-07T18:30:00Z";
  repeated.data.end = "2026-11-07T19:30:00Z";
  check("UTC", "2026-11-05");
  check("UTC", "2026-11-07");
  check("America/Los_Angeles", "2026-11-07");
  repeated.data.start = 17;
  expect(() => previousAppointmentViews(records, ORG, "UTC", "2026-11-07"))
    .toThrow();
  expect(() => summarizeDailyOperations(
    { organizationId: ORG, records, equipmentStates: [] },
    "UTC", "2026-11-07",
  )).toThrow();
});

it("short circuits invalid cancelled, archived, foreign and unrelated records", () => {
  const records = [
    record("cancelled", "appointments", {
      title: "Not shown", status: "Cancelled",
      start: "invalid", end: "invalid",
    }),
    record("archived", "appointments", {
      title: "Archived", status: "Scheduled",
      start: "invalid", end: "invalid",
    }, ORG, true),
    record("foreign", "appointments", {
      title: "FOREIGN PRIVATE", status: "Scheduled",
      start: "invalid", end: "invalid",
    }, FOREIGN),
    record("other", "tasks", {
      title: "Not an appointment", status: "Open", start: "invalid",
    }),
  ];
  const expected = previousAppointmentViews(records, ORG, "UTC", "2026-11-01");
  const actual = summarizeDailyOperations(
    { organizationId: ORG, records, equipmentStates: [] },
    "UTC", "2026-11-01",
  );
  assertExactRecords(actual.appointments, expected.today);
  assertExactRecords(actual.upcomingAppointments, expected.upcoming);
});
