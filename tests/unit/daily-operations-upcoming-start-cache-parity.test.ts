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

// Independent pre-cache reference copied from merged, five-green #173.
// Deliberately parses the upcoming saved start twice on successful first
// comparison, and retains Temporal.Instant.compare for exact sort parity.
function previousUpcoming(
  records: readonly WorkspaceRecord[],
  organizationId: string,
  zone: string,
  date: string,
): WorkspaceRecord[] {
  const day = Temporal.PlainDate.from(date);
  const until = day.add({ days: 1 }).toZonedDateTime(zone).epochNanoseconds;
  const upcomingEnd = day.add({ days: 8 })
    .toZonedDateTime(zone).epochNanoseconds;
  return records
    .filter((r) => r.organization_id === organizationId && !r.archived)
    .filter(
      (r) =>
        r.entity === "appointments" &&
        r.data.status !== "Cancelled" &&
        instant(String(r.data.start)).epochNanoseconds >= until &&
        instant(String(r.data.start)).epochNanoseconds < upcomingEnd,
    )
    .sort((a, b) =>
      Temporal.Instant.compare(
        instant(String(a.data.start)),
        instant(String(b.data.start)),
      ),
    );
}

it("preserves exact upcoming appointment order and occurrence identities for 720 fictional revisions", () => {
  const starts = [
    "2026-11-01T08:30:00Z",
    "2026-11-01T09:30:00Z",
    "2026-11-02T08:00:00Z",
    "2026-11-03T19:00:00Z",
    "2026-11-05T09:30:00Z",
    "2026-11-06T18:30:00Z",
    "2026-11-07T07:30:00Z",
    "2026-11-07T08:30:00Z",
    "2026-11-09T08:00:00Z",
    "2026-03-08T09:30:00Z",
    "2026-03-08T10:30:00Z",
    "2026-03-09T07:00:00Z",
    "2028-02-28T18:00:00Z",
    "2028-02-29T18:00:00Z",
    "2028-03-01T18:00:00Z",
  ];
  const records: WorkspaceRecord[] = Array.from(
    { length: 720 }, (_, i) => {
      const start = starts[i % starts.length];
      const end = new Date(Date.parse(start) + 30 * 60_000).toISOString();
      return record("appointment-" + (i % 230), "appointments", {
        title: "Fictional scheduled visit " + i,
        status: i % 11 === 0 ? "Cancelled" : "Scheduled",
        start, end, notes: "PRIVATE CUSTOMER NOTE",
      }, i % 19 === 0 ? FOREIGN : ORG, i % 23 === 0);
    },
  );
  const repeated = record("same-id", "appointments", {
    title: "Same reference", status: "Scheduled",
    start: "2026-11-01T08:30:00Z",
    end: "2026-11-01T08:45:00Z",
  });
  records.push(
    repeated, repeated,
    record("same-id", "appointments", {
      title: "Other revision", status: "Scheduled",
      start: "2026-11-01T09:30:00Z",
      end: "2026-11-01T09:45:00Z",
    }),
    record("other-entity", "tasks", {
      title: "Not an appointment", status: "Open", due: "2026-11-07",
    }),
    record("foreign", "appointments", {
      title: "FOREIGN PRIVATE APPOINTMENT", status: "Scheduled",
      start: "2026-11-06T18:30:00Z",
      end: "2026-11-06T19:30:00Z",
    }, FOREIGN),
  );
  const unchanged = structuredClone(records);
  for (const zone of ["UTC", "America/Los_Angeles", "America/New_York"]) {
    for (const date of [
      "2026-10-31", "2026-11-01", "2026-11-05",
      "2026-03-07", "2028-02-26",
    ]) {
      const expected = previousUpcoming(records, ORG, zone, date);
      const summary = summarizeDailyOperations(
        { organizationId: ORG, records, equipmentStates: [] }, zone, date,
      );
      expect(summary.upcomingAppointments).toHaveLength(expected.length);
      expect(summary.upcomingAppointments).toEqual(expected);
      summary.upcomingAppointments.forEach((item, index) => {
        expect(item).toBe(expected[index]);
        expect(item.organization_id).toBe(ORG);
        expect(item.archived).toBe(false);
      });
      expect(summary.upcomingAppointments).not.toContain(records[0]);
      expect(summary.upcomingAppointments.some(
        (item) => item.data.title === "FOREIGN PRIVATE APPOINTMENT",
      )).toBe(false);
    }
  }
  expect(records).toEqual(unchanged);
});

it("keeps both DST-fold instants and excludes adjacent business-local midnights", () => {
  const records = [
    record("first-fold", "appointments", {
      title: "First fold", status: "Scheduled",
      start: "2026-11-01T08:30:00Z", end: "2026-11-01T08:45:00Z",
    }),
    record("second-fold", "appointments", {
      title: "Second fold", status: "Scheduled",
      start: "2026-11-01T09:30:00Z", end: "2026-11-01T09:45:00Z",
    }),
    record("midnight-after", "appointments", {
      title: "Next local midnight", status: "Scheduled",
      start: "2026-11-02T08:00:00Z", end: "2026-11-02T08:30:00Z",
    }),
  ];
  const summary = summarizeDailyOperations(
    { organizationId: ORG, records, equipmentStates: [] },
    "America/Los_Angeles", "2026-10-31",
  );
  expect(summary.upcomingAppointments.map((item) => item.id))
    .toEqual(["first-fold", "second-fold", "midnight-after"]);
  expect(summary.upcomingAppointments).toEqual(
    previousUpcoming(records, ORG, "America/Los_Angeles", "2026-10-31"),
  );
  const following = summarizeDailyOperations(
    { organizationId: ORG, records, equipmentStates: [] },
    "America/Los_Angeles", "2026-11-01",
  );
  expect(following.upcomingAppointments.map((item) => item.id))
    .toEqual(["midnight-after"]);
});

it("starts a fresh cache when saved starts or business zones change", () => {
  const row = record("future", "appointments", {
    title: "Mutable fictional appointment", status: "Scheduled",
    start: "2026-11-06T18:30:00Z", end: "2026-11-06T19:30:00Z",
  });
  const records = [row, row];
  const compare = (zone: string, date: string) => {
    const summary = summarizeDailyOperations(
      { organizationId: ORG, records, equipmentStates: [] }, zone, date,
    );
    const previous = previousUpcoming(records, ORG, zone, date);
    expect(summary.upcomingAppointments).toEqual(previous);
    summary.upcomingAppointments.forEach((item, index) =>
      expect(item).toBe(previous[index]));
  };
  compare("UTC", "2026-11-05");
  compare("America/Los_Angeles", "2026-11-05");
  row.data.start = "2026-11-07T18:30:00Z";
  compare("UTC", "2026-11-05");
  compare("America/Los_Angeles", "2026-11-05");
  row.data.start = 17;
  expect(() => previousUpcoming(records, ORG, "UTC", "2026-11-05")).toThrow();
  expect(() => summarizeDailyOperations(
    { organizationId: ORG, records, equipmentStates: [] },
    "UTC", "2026-11-05",
  )).toThrow();
});

it("keeps invalid excluded records excluded before attempting to parse starts", () => {
  const records = [
    record("cancelled", "appointments", {
      status: "Cancelled", start: "not-a-time", end: "not-a-time",
    }),
    record("archived", "appointments", {
      status: "Scheduled", start: "not-a-time", end: "not-a-time",
    }, ORG, true),
    record("foreign", "appointments", {
      status: "Scheduled", start: "not-a-time", end: "not-a-time",
    }, FOREIGN),
  ];
  const summary = summarizeDailyOperations(
    { organizationId: ORG, records, equipmentStates: [] },
    "UTC", "2026-11-05",
  );
  expect(summary.upcomingAppointments).toEqual([]);
  expect(summary.upcomingAppointments).toEqual(
    previousUpcoming(records, ORG, "UTC", "2026-11-05"),
  );
});
