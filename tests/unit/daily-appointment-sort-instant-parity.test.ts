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
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };
}

// Independent reference: the selected-day and upcoming appointment filters
// from merged, five-green LMS #178. Keep the original Temporal.Instant.compare
// on every sort comparison rather than reusing already-parsed timestamps.
function previousAppointmentLists(
  allRecords: readonly WorkspaceRecord[],
  organizationId: string, zone: string, date: string,
): { today: WorkspaceRecord[]; upcoming: WorkspaceRecord[] } {
  const day = Temporal.PlainDate.from(date);
  const from = day.toZonedDateTime(zone).epochNanoseconds;
  const until = day.add({ days: 1 }).toZonedDateTime(zone).epochNanoseconds;
  const upcomingEnd = day.add({ days: 8 }).toZonedDateTime(zone).epochNanoseconds;
  const records = allRecords.filter((r) =>
    r.organization_id === organizationId && !r.archived);
  const dayInstants = new Map<string, bigint>();
  const dayInstant = (value: unknown): bigint => {
    if (typeof value !== "string") return instant(String(value)).epochNanoseconds;
    const cached = dayInstants.get(value);
    if (cached !== undefined) return cached;
    const parsed = instant(value).epochNanoseconds;
    dayInstants.set(value, parsed);
    return parsed;
  };
  const today = records
    .filter((r) =>
      r.entity === "appointments" &&
      r.data.status !== "Cancelled" &&
      dayInstant(r.data.start) < until &&
      dayInstant(r.data.end) > from)
    .sort((a, b) => Temporal.Instant.compare(
      instant(String(a.data.start)), instant(String(b.data.start)),
    ));
  const upcoming = records
    .filter((r) => {
      if (r.entity !== "appointments" || r.data.status === "Cancelled") {
        return false;
      }
      if (typeof r.data.start !== "string") {
        return instant(String(r.data.start)).epochNanoseconds >= until &&
          instant(String(r.data.start)).epochNanoseconds < upcomingEnd;
      }
      const parsed = dayInstant(r.data.start);
      return parsed >= until && parsed < upcomingEnd;
    })
    .sort((a, b) => Temporal.Instant.compare(
      instant(String(a.data.start)), instant(String(b.data.start)),
    ));
  return { today, upcoming };
}

function sameReferences(
  actual: readonly WorkspaceRecord[], previous: readonly WorkspaceRecord[],
): void {
  expect(actual).toHaveLength(previous.length);
  expect(actual).toEqual(previous);
  actual.forEach((row, i) => expect(row).toBe(previous[i]));
}

it("preserves exact records and stable timestamp order across 720 fictional appointments", () => {
  const starts = [
    "2026-11-01T08:30:00Z",
    "2026-11-01T01:30:00-07:00", // exact same instant, different offset text
    "2026-11-01T09:30:00Z",
    "2026-11-01T01:30:00-08:00", // second fold, exact same instant
    "2026-11-01T15:30:00Z",
    "2026-11-02T08:00:00Z",
    "2026-11-03T18:00:00Z",
    "2026-11-06T18:30:00Z",
    "2026-11-06T10:30:00-08:00",
    "2026-11-07T07:30:00Z",
    "2026-11-07T08:30:00Z",
    "2026-03-08T09:30:00Z",
    "2026-03-08T10:30:00Z",
    "2026-03-09T07:00:00Z",
    "2028-02-28T18:00:00Z",
    "2028-02-29T18:00:00Z",
    "2028-03-01T18:00:00Z",
  ];
  const records: WorkspaceRecord[] = Array.from({ length: 720 }, (_, i) => {
    const start = starts[i % starts.length];
    const end = new Date(Date.parse(start) + 30 * 60_000).toISOString();
    return record("appointment-" + (i % 253), "appointments", {
      title: "Fictional visit " + i, start, end,
      status: i % 13 === 0 ? "Cancelled" : "Scheduled",
      notes: "PRIVATE NOTES", phone: "PRIVATE PHONE",
    }, i % 19 === 0 ? FOREIGN : ORG, i % 23 === 0);
  });
  const duplicate = record("same-id", "appointments", {
    title: "Repeated retained row", status: "Scheduled",
    start: "2026-11-01T08:30:00Z", end: "2026-11-01T09:00:00Z",
  });
  records.push(
    duplicate, duplicate,
    record("same-id", "appointments", {
      title: "Equal instant different offset", status: "Scheduled",
      start: "2026-11-01T01:30:00-07:00", end: "2026-11-01T09:00:00Z",
    }),
    record("foreign", "appointments", {
      title: "FOREIGN PRIVATE APPOINTMENT", status: "Scheduled",
      start: "2026-11-01T08:30:00Z", end: "2026-11-01T09:00:00Z",
    }, FOREIGN),
    record("wrong-entity", "tasks", {
      title: "Unrelated work", due: "2026-11-01", status: "Open",
    }),
  );
  const before = structuredClone(records);
  for (const zone of ["UTC", "America/Los_Angeles", "America/New_York"]) {
    for (const date of [
      "2026-10-31", "2026-11-01", "2026-11-02",
      "2026-11-05", "2026-03-07", "2026-03-08",
      "2028-02-26", "2028-02-29",
    ]) {
      const expected = previousAppointmentLists(records, ORG, zone, date);
      const summary = summarizeDailyOperations(
        { organizationId: ORG, records, equipmentStates: [] }, zone, date,
      );
      sameReferences(summary.appointments, expected.today);
      sameReferences(summary.upcomingAppointments, expected.upcoming);
      for (const row of [...summary.appointments, ...summary.upcomingAppointments]) {
        expect(row.organization_id).toBe(ORG);
        expect(row.archived).toBe(false);
        expect(row.entity).toBe("appointments");
      }
    }
  }
  expect(records).toEqual(before);
});

it("does not reorder equal instants expressed using different UTC offsets", () => {
  const records = [
    record("first", "appointments", {
      title: "First offset", status: "Scheduled",
      start: "2026-11-01T01:30:00-07:00",
      end: "2026-11-01T09:00:00Z",
    }),
    record("second", "appointments", {
      title: "Zulu time", status: "Scheduled",
      start: "2026-11-01T08:30:00Z",
      end: "2026-11-01T09:00:00Z",
    }),
    record("third", "appointments", {
      title: "Second local fold", status: "Scheduled",
      start: "2026-11-01T01:30:00-08:00",
      end: "2026-11-01T10:00:00Z",
    }),
  ];
  const summary = summarizeDailyOperations(
    { organizationId: ORG, records, equipmentStates: [] },
    "America/Los_Angeles", "2026-11-01",
  );
  expect(summary.appointments.map((r) => r.id))
    .toEqual(["first", "second", "third"]);
  const expected = previousAppointmentLists(
    records, ORG, "America/Los_Angeles", "2026-11-01",
  );
  sameReferences(summary.appointments, expected.today);
});

it("rebuilds sort instants per invocation after appointment date changes", () => {
  const first = record("first", "appointments", {
    title: "First", status: "Scheduled",
    start: "2026-11-06T17:00:00Z", end: "2026-11-06T17:30:00Z",
  });
  const second = record("second", "appointments", {
    title: "Second", status: "Scheduled",
    start: "2026-11-06T19:00:00Z", end: "2026-11-06T19:30:00Z",
  });
  const records = [second, first, first];
  const compare = (zone: string, date: string) => {
    const previous = previousAppointmentLists(records, ORG, zone, date);
    const actual = summarizeDailyOperations(
      { organizationId: ORG, records, equipmentStates: [] }, zone, date,
    );
    sameReferences(actual.appointments, previous.today);
    sameReferences(actual.upcomingAppointments, previous.upcoming);
  };
  compare("UTC", "2026-11-05");
  compare("UTC", "2026-11-06");
  compare("America/Los_Angeles", "2026-11-06");
  first.data.start = "2026-11-06T20:00:00Z";
  first.data.end = "2026-11-06T20:30:00Z";
  compare("UTC", "2026-11-05");
  compare("UTC", "2026-11-06");
  compare("America/Los_Angeles", "2026-11-06");
  first.data.start = 17;
  expect(() => previousAppointmentLists(records, ORG, "UTC", "2026-11-06"))
    .toThrow();
  expect(() => summarizeDailyOperations(
    { organizationId: ORG, records, equipmentStates: [] },
    "UTC", "2026-11-06",
  )).toThrow();
});

it("preserves original non-string sort comparator behavior for valid legacy coercion", () => {
  const old = record("old", "appointments", {
    title: "Legacy coerced", status: "Scheduled",
    start: "2026-11-06T18:30:00Z", end: "2026-11-06T19:00:00Z",
  });
  // Deliberately inject a non-schema legacy value: the actual production
  // record schema still requires an explicit-offset timestamp string.
  old.data.start = ({ toString: () => "2026-11-06T18:30:00Z" }
    as unknown as WorkspaceRecord["data"]["start"]);
  const second = record("second", "appointments", {
    title: "Normal", status: "Scheduled",
    start: "2026-11-06T19:30:00Z", end: "2026-11-06T20:00:00Z",
  });
  const records = [second, old, old];
  const expected = previousAppointmentLists(records, ORG, "UTC", "2026-11-06");
  const summary = summarizeDailyOperations(
    { organizationId: ORG, records, equipmentStates: [] },
    "UTC", "2026-11-06",
  );
  sameReferences(summary.appointments, expected.today);
});
