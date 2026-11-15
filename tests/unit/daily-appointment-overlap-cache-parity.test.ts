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

// Independent reference copied from five-green merged LMS #174.
// Reparse start and end per retained appointment with original short circuit,
// then perform the exact unoptimized Temporal.Instant comparator sort.
function previousSelectedDay(
  records: readonly WorkspaceRecord[],
  organizationId: string,
  zone: string,
  date: string,
): WorkspaceRecord[] {
  const day = Temporal.PlainDate.from(date);
  const from = day.toZonedDateTime(zone).epochNanoseconds;
  const until = day.add({ days: 1 }).toZonedDateTime(zone).epochNanoseconds;
  return records
    .filter((r) => r.organization_id === organizationId && !r.archived)
    .filter(
      (r) =>
        r.entity === "appointments" &&
        r.data.status !== "Cancelled" &&
        instant(String(r.data.start)).epochNanoseconds < until &&
        instant(String(r.data.end)).epochNanoseconds > from,
    )
    .sort((a, b) =>
      Temporal.Instant.compare(
        instant(String(a.data.start)),
        instant(String(b.data.start)),
      ),
    );
}

it("preserves exact selected-day appointments and references across 720 fictional revisions", () => {
  const times: Array<readonly [string, string]> = [
    ["2026-11-01T06:30:00Z", "2026-11-01T07:30:00Z"],
    ["2026-11-01T08:30:00Z", "2026-11-01T08:45:00Z"],
    ["2026-11-01T09:30:00Z", "2026-11-01T09:45:00Z"],
    ["2026-11-02T07:30:00Z", "2026-11-02T08:30:00Z"],
    ["2026-11-02T08:00:00Z", "2026-11-02T08:30:00Z"],
    ["2026-03-08T09:30:00Z", "2026-03-08T09:45:00Z"],
    ["2026-03-08T10:30:00Z", "2026-03-08T10:45:00Z"],
    ["2026-03-09T07:00:00Z", "2026-03-09T07:15:00Z"],
    ["2026-11-06T18:30:00Z", "2026-11-06T19:30:00Z"],
    ["2028-02-29T18:00:00Z", "2028-02-29T18:30:00Z"],
    ["2028-03-01T08:00:00Z", "2028-03-01T08:30:00Z"],
  ];
  const records: WorkspaceRecord[] = Array.from(
    { length: 720 }, (_, i) => {
      const [start, end] = times[i % times.length];
      return record("fictional-" + (i % 245), "appointments", {
        title: "Fictional appointment " + i,
        status: i % 11 === 0 ? "Cancelled" : "Scheduled",
        start, end, notes: "PRIVATE APPOINTMENT NOTES",
      }, i % 19 === 0 ? FOREIGN : ORG, i % 23 === 0);
    },
  );
  const same = record("duplicate", "appointments", {
    title: "Repeated reference", status: "Scheduled",
    start: "2026-11-01T08:30:00Z",
    end: "2026-11-01T08:45:00Z",
  });
  records.push(
    same, same,
    record("duplicate", "appointments", {
      title: "Separate revision same ID", status: "Scheduled",
      start: "2026-11-01T09:30:00Z", end: "2026-11-01T09:45:00Z",
    }),
    record("not-appointment", "tasks", {
      title: "Unrelated record", due: "2026-11-01", status: "Open",
    }),
    record("foreign", "appointments", {
      title: "FOREIGN PRIVATE BOOKING", status: "Scheduled",
      start: "2026-11-01T08:30:00Z", end: "2026-11-01T08:45:00Z",
    }, FOREIGN),
  );
  const original = structuredClone(records);
  for (const zone of ["UTC", "America/Los_Angeles", "America/New_York"]) {
    for (const date of [
      "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-06",
      "2026-03-08", "2026-03-09", "2028-02-29",
    ]) {
      const expected = previousSelectedDay(records, ORG, zone, date);
      const result = summarizeDailyOperations(
        { organizationId: ORG, records, equipmentStates: [] },
        zone, date,
      ).appointments;
      expect(result).toHaveLength(expected.length);
      expect(result).toEqual(expected);
      result.forEach((entry, index) => {
        expect(entry).toBe(expected[index]);
        expect(entry.organization_id).toBe(ORG);
        expect(entry.archived).toBe(false);
      });
      expect(result.some((entry) =>
        entry.data.title === "FOREIGN PRIVATE BOOKING")).toBe(false);
    }
  }
  expect(records).toEqual(original);
});

it("retains strict local-midnight bounds and both autumn DST fold instants", () => {
  const records = [
    record("ends-at-midnight", "appointments", {
      status: "Scheduled", title: "Prior day",
      start: "2026-11-01T06:30:00Z", end: "2026-11-01T07:00:00Z",
    }),
    record("crosses-midnight", "appointments", {
      status: "Scheduled", title: "Overnight",
      start: "2026-11-01T06:30:00Z", end: "2026-11-01T07:30:00Z",
    }),
    record("first-130", "appointments", {
      status: "Scheduled", title: "First 1:30",
      start: "2026-11-01T08:30:00Z", end: "2026-11-01T08:45:00Z",
    }),
    record("second-130", "appointments", {
      status: "Scheduled", title: "Second 1:30",
      start: "2026-11-01T09:30:00Z", end: "2026-11-01T09:45:00Z",
    }),
    record("starts-next-midnight", "appointments", {
      status: "Scheduled", title: "Next date",
      start: "2026-11-02T08:00:00Z", end: "2026-11-02T08:30:00Z",
    }),
  ];
  const today = summarizeDailyOperations(
    { organizationId: ORG, records, equipmentStates: [] },
    "America/Los_Angeles", "2026-11-01",
  ).appointments;
  expect(today.map((r) => r.id)).toEqual([
    "crosses-midnight", "first-130", "second-130",
  ]);
  expect(today).toEqual(previousSelectedDay(
    records, ORG, "America/Los_Angeles", "2026-11-01",
  ));
});

it("does not share stale parsed starts or ends between summaries", () => {
  const same = record("mutable", "appointments", {
    title: "Fictional visit", status: "Scheduled",
    start: "2026-11-06T18:30:00Z", end: "2026-11-06T19:30:00Z",
  });
  const records = [same, same];
  const compare = (zone: string, date: string) => {
    const expected = previousSelectedDay(records, ORG, zone, date);
    const actual = summarizeDailyOperations(
      { organizationId: ORG, records, equipmentStates: [] },
      zone, date,
    ).appointments;
    expect(actual).toEqual(expected);
    actual.forEach((item, i) => expect(item).toBe(expected[i]));
  };
  compare("UTC", "2026-11-06");
  compare("America/Los_Angeles", "2026-11-06");
  same.data.start = "2026-11-07T18:30:00Z";
  same.data.end = "2026-11-07T19:30:00Z";
  compare("UTC", "2026-11-06");
  compare("UTC", "2026-11-07");
  compare("America/Los_Angeles", "2026-11-07");
  same.data.start = 17;
  expect(() => previousSelectedDay(records, ORG, "UTC", "2026-11-07"))
    .toThrow();
  expect(() => summarizeDailyOperations(
    { organizationId: ORG, records, equipmentStates: [] },
    "UTC", "2026-11-07",
  )).toThrow();
});

it("rejects invalid excluded appointments before parsing them", () => {
  const records = [
    record("cancelled", "appointments", {
      title: "Not shown", status: "Cancelled",
      start: "invalid", end: "invalid",
    }),
    record("foreign", "appointments", {
      title: "FOREIGN PRIVATE", status: "Scheduled",
      start: "invalid", end: "invalid",
    }, FOREIGN),
    record("archived", "appointments", {
      title: "Archived", status: "Scheduled",
      start: "invalid", end: "invalid",
    }, ORG, true),
  ];
  expect(summarizeDailyOperations(
    { organizationId: ORG, records, equipmentStates: [] },
    "UTC", "2026-11-01",
  ).appointments).toEqual([]);
  expect(previousSelectedDay(records, ORG, "UTC", "2026-11-01"))
    .toEqual([]);
});
