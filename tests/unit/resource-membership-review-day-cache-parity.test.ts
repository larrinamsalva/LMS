import { Temporal } from "@js-temporal/polyfill";
import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import { instant } from "../../src/core/time";
import {
  resourceMembershipReviewDateError,
  resourceMembershipRowsForReview,
  type ResourceMembershipReviewMode,
} from "../../src/core/resource-membership-review";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function record(
  entity: string,
  id: string,
  data: WorkspaceRecord["data"],
  archived = false,
  organization_id = ORG,
): WorkspaceRecord {
  return {
    id, entity, data, archived, organization_id,
    revision: 1, config_revision: 1,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };
}

// Independent, pre-optimization implementation from the merged five-green
// LMS #165 baseline. It parses saved start/end instants per matching record.
function previousReview(
  memberships: readonly WorkspaceRecord[],
  resource: WorkspaceRecord,
  mode: ResourceMembershipReviewMode,
  date: string,
  zone: string,
): WorkspaceRecord[] {
  if (resource.entity !== "resources") return [];
  const owned = memberships.filter((membership) =>
    membership.entity === "resource-memberships" &&
    membership.organization_id === resource.organization_id &&
    membership.data.resource === resource.id,
  );
  if (mode === "all") return owned;
  if (resourceMembershipReviewDateError(date, zone)) return [];
  try {
    const day = Temporal.PlainDate.from(date);
    const start = day.toZonedDateTime(zone).epochNanoseconds;
    const end = day.add({ days: 1 }).toZonedDateTime(zone).epochNanoseconds;
    return owned.filter((membership) => {
      try {
        return instant(String(membership.data.start)).epochNanoseconds < end &&
          instant(String(membership.data.end)).epochNanoseconds > start;
      } catch {
        // Never invent a roster day for malformed retained date records.
        return false;
      }
    });
  } catch {
    return [];
  }
}

it("retains exact historical roster records across 720 fictional memberships and local review days", () => {
  const resources = [
    record("resources", "crew-a", { kind: "Crew", name: "Fictional Blue Crew" }),
    record("resources", "crew-b", { kind: "Worker", name: "Fictional Worker" }),
    record("resources", "crew-c", { kind: "Equipment", name: "Fictional Equipment" }),
    record("resources", "crew-a", { kind: "Crew", name: "Foreign Crew" }, false, FOREIGN),
    record("employees", "crew-a", { name: "Not a resource" }),
  ];
  const timePairs: Array<readonly [string | number, string | number]> = [
    ["2026-11-01T08:30:00Z", "2026-11-01T08:45:00Z"],
    ["2026-11-01T09:30:00Z", "2026-11-01T09:45:00Z"],
    ["2026-11-02T08:00:00Z", "2026-11-02T09:00:00Z"],
    ["2026-03-08T09:30:00Z", "2026-03-08T09:45:00Z"],
    ["2026-03-08T10:30:00Z", "2026-03-08T10:45:00Z"],
    ["2026-03-09T07:00:00Z", "2026-03-09T07:30:00Z"],
    ["2026-11-06T18:00:00Z", "2026-11-06T21:00:00Z"],
    ["2026-11-07T07:30:00Z", "2026-11-07T08:30:00Z"],
    ["invalid-retained-start", "2026-11-07T08:30:00Z"],
    ["2026-11-07T07:30:00Z", "invalid-retained-end"],
    ["", ""],
    [17, 18],
  ];
  const records: WorkspaceRecord[] = [];
  for (let index = 0; index < 720; index++) {
    const [start, end] = timePairs[index % timePairs.length];
    records.push(record(
      "resource-memberships", "membership-" + (index % 271),
      {
        resource: index % 3 === 0 ? "crew-a"
          : index % 3 === 1 ? "crew-b" : "crew-c",
        employee: "employee-" + (index % 50),
        title: "Fictional retained revision " + index,
        start, end,
      }, index % 5 === 0, index % 19 === 0 ? FOREIGN : ORG,
    ));
  }
  const shared = record("resource-memberships", "repeat-reference", {
    resource: "crew-a", employee: "worker", title: "Same reference repeated",
    start: "2026-11-01T08:30:00Z", end: "2026-11-01T08:45:00Z",
  }, true);
  records.push(shared, shared,
    record("resource-memberships", "repeat-reference", {
      resource: "crew-a", employee: "worker", title: "Same ID distinct revision",
      start: "2026-11-01T09:30:00Z", end: "2026-11-01T09:45:00Z",
    }),
    record("availability", "wrong-entity", {
      resource: "crew-a", start: "2026-11-01T08:30:00Z",
      end: "2026-11-01T08:45:00Z",
    }),
  );
  const referenceOrder = [...records];
  const dates = [
    "2026-11-01", "2026-11-02", "2026-11-06", "2026-11-07",
    "2026-03-08", "2026-03-09", "2026-02-30", "", "2026-11",
  ];
  for (const zone of ["America/Los_Angeles", "America/New_York", "UTC"]) {
    for (const resource of resources) {
      for (const [mode, date] of [
        ["all", ""],
        ...dates.map((day) => ["overlapping-day", day]),
      ] as Array<[ResourceMembershipReviewMode, string]>) {
        const before = previousReview(records, resource, mode, date, zone);
        const after = resourceMembershipRowsForReview(
          records, resource, mode, date, zone,
        );
        expect(after).toEqual(before);
        expect(after).toHaveLength(before.length);
        after.forEach((entry, i) => expect(entry).toBe(before[i]));
      }
    }
  }
  records.forEach((row, i) => expect(row).toBe(referenceOrder[i]));
});

it("preserves 25-hour fold, 23-hour spring day and non-overlapping day boundaries", () => {
  const resource = record("resources", "crew", { name: "Example", kind: "Crew" });
  const rows = [
    record("resource-memberships", "fold-before", {
      resource: "crew", start: "2026-11-01T08:30:00Z",
      end: "2026-11-01T08:40:00Z",
    }),
    record("resource-memberships", "fold-after", {
      resource: "crew", start: "2026-11-01T09:30:00Z",
      end: "2026-11-01T09:40:00Z",
    }),
    record("resource-memberships", "next-midnight", {
      resource: "crew", start: "2026-11-02T08:00:00Z",
      end: "2026-11-02T09:00:00Z",
    }),
    record("resource-memberships", "spring-after", {
      resource: "crew", start: "2026-03-08T10:30:00Z",
      end: "2026-03-08T10:40:00Z",
    }),
  ];
  const fall = resourceMembershipRowsForReview(
    rows, resource, "overlapping-day", "2026-11-01", "America/Los_Angeles",
  );
  expect(fall.map((r) => r.id)).toEqual(["fold-before", "fold-after"]);
  expect(fall).toEqual(previousReview(
    rows, resource, "overlapping-day", "2026-11-01", "America/Los_Angeles",
  ));
  const spring = resourceMembershipRowsForReview(
    rows, resource, "overlapping-day", "2026-03-08", "America/Los_Angeles",
  );
  expect(spring.map((r) => r.id)).toEqual(["spring-after"]);
});

it("does not retain stale cached values between calls or change invalid-day behavior", () => {
  const crew = record("resources", "crew", { name: "Crew", kind: "Crew" });
  const entry = record("resource-memberships", "m", {
    resource: "crew", start: "invalid",
    end: "2026-11-06T21:00:00Z",
  });
  const data = [entry, entry];
  const review = (date: string, zone: string) =>
    resourceMembershipRowsForReview(data, crew, "overlapping-day", date, zone);
  expect(review("2026-11-06", "UTC")).toEqual([]);
  entry.data.start = "2026-11-06T18:00:00Z";
  expect(review("2026-11-06", "UTC")).toEqual([entry, entry]);
  expect(review("2026-11-06", "UTC")).toEqual(
    previousReview(data, crew, "overlapping-day", "2026-11-06", "UTC"),
  );
  expect(review("2026-02-30", "UTC")).toEqual([]);
  expect(review("2026-11-06", "Not/AZone")).toEqual([]);
  expect(resourceMembershipRowsForReview(
    data, crew, "all", "", "Not/AZone",
  )).toEqual(data);
});
