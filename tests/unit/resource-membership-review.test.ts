import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import {
  resourceMembershipRowsForReview,
  resourceMembershipReviewDateError,
} from "../../src/core/resource-membership-review";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function record(
  id: string, entity: string, data: WorkspaceRecord["data"],
  archived = false, organization_id = ORG,
): WorkspaceRecord {
  return {
    id, entity, organization_id, data, archived,
    revision: 1, config_revision: 1,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };
}
const crew = record("crew-a", "resources", { name: "Blue Crew", kind: "Crew" });
const member = (
  id: string, start: string, end: string,
  archived = false, organization_id = ORG, resource = "crew-a",
) => record(id, "resource-memberships", {
  resource, employee: "worker-a", title: id, start, end,
}, archived, organization_id);

it("shows retained roster history in original order, scoped to the linked resource and organization", () => {
  const memberships = [
    member("past-archived", "2026-11-01T08:00:00Z", "2026-11-03T08:00:00Z", true),
    member("current", "2026-11-06T17:00:00Z", "2026-11-07T01:00:00Z"),
    member("other-resource", "2026-11-06T17:00:00Z", "2026-11-07T01:00:00Z",
      false, ORG, "crew-b"),
    member("foreign", "2026-11-06T17:00:00Z", "2026-11-07T01:00:00Z",
      false, OTHER),
    record("wrong-entity", "availability", {
      resource: "crew-a", start: "2026-11-06T17:00:00Z",
      end: "2026-11-07T01:00:00Z",
    }),
  ];
  const before = structuredClone(memberships);
  expect(resourceMembershipRowsForReview(
    memberships, crew, "all", "", "America/Los_Angeles",
  ).map((m) => m.id)).toEqual(["past-archived", "current"]);
  expect(resourceMembershipRowsForReview(
    memberships, crew, "overlapping-day", "2026-11-06", "America/Los_Angeles",
  ).map((m) => m.id)).toEqual(["current"]);
  // Archived membership history does not disappear from a date it intersects.
  expect(resourceMembershipRowsForReview(
    memberships, crew, "overlapping-day", "2026-11-02", "America/Los_Angeles",
  ).map((m) => m.id)).toEqual(["past-archived"]);
  expect(memberships).toEqual(before);
});

it("uses inclusive day-overlap of half-open periods and excludes touching boundaries", () => {
  const memberships = [
    member("ends-at-midnight", "2026-11-06T00:00:00Z", "2026-11-06T08:00:00Z"),
    member("starts-at-midnight", "2026-11-07T08:00:00Z", "2026-11-08T08:00:00Z"),
    member("starts-at-day", "2026-11-06T08:00:00Z", "2026-11-06T12:00:00Z"),
    member("ends-at-day", "2026-11-05T22:00:00Z", "2026-11-06T08:01:00Z"),
    member("late-evening", "2026-11-07T07:55:00Z", "2026-11-07T08:20:00Z"),
  ];
  expect(resourceMembershipRowsForReview(
    memberships, crew, "overlapping-day", "2026-11-06", "America/Los_Angeles",
  ).map((m) => m.id)).toEqual([
    "starts-at-day", "ends-at-day", "late-evening",
  ]);
  expect(resourceMembershipRowsForReview(
    memberships, crew, "overlapping-day", "2026-11-07", "America/Los_Angeles",
  ).map((m) => m.id)).toEqual(["starts-at-midnight", "late-evening"]);
});

it("handles the 25-hour fall-back day and 23-hour spring-forward day", () => {
  const fall = [
    member("first-fold", "2026-11-01T08:30:00Z", "2026-11-01T08:40:00Z"),
    member("second-fold", "2026-11-01T09:30:00Z", "2026-11-01T09:40:00Z"),
    member("next-midnight", "2026-11-02T08:00:00Z", "2026-11-02T09:00:00Z"),
  ];
  expect(resourceMembershipRowsForReview(
    fall, crew, "overlapping-day", "2026-11-01", "America/Los_Angeles",
  ).map((m) => m.id)).toEqual(["first-fold", "second-fold"]);
  const spring = [
    member("before-shift", "2026-03-08T09:30:00Z", "2026-03-08T09:45:00Z"),
    member("after-shift", "2026-03-08T10:30:00Z", "2026-03-08T10:45:00Z"),
    member("following-midnight", "2026-03-09T07:00:00Z", "2026-03-09T07:30:00Z"),
  ];
  expect(resourceMembershipRowsForReview(
    spring, crew, "overlapping-day", "2026-03-08", "America/Los_Angeles",
  ).map((m) => m.id)).toEqual(["before-shift", "after-shift"]);
});

it("refuses impossible days, wrong zones, missing instants and unrelated entities", () => {
  for (const date of ["", "2026-02-30", "2026-11", "2026-13-01"]) {
    expect(resourceMembershipReviewDateError(date, "UTC"))
      .toMatch(/valid membership review date/);
  }
  expect(resourceMembershipReviewDateError("2026-11-06", "Not/AZone"))
    .toMatch(/business time zone/);
  const invalid = [
    member("bad-time", "not-a-time", "2026-11-07T08:00:00Z"),
    member("valid", "2026-11-06T08:00:00Z", "2026-11-07T08:00:00Z"),
  ];
  expect(resourceMembershipRowsForReview(
    invalid, crew, "overlapping-day", "2026-02-30", "UTC",
  )).toEqual([]);
  expect(resourceMembershipRowsForReview(
    invalid, crew, "overlapping-day", "2026-11-06", "UTC",
  ).map((m) => m.id)).toEqual(["valid"]);
  expect(resourceMembershipRowsForReview(
    invalid, record("not-resource", "employees", { name: "Example" }),
    "all", "", "UTC",
  )).toEqual([]);
});
