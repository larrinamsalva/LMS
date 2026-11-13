import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import {
  resourceMembershipRowsForReview,
  resourceMembershipReviewDateError,
  filterResourceMembershipRecordStatus,
  orderResourceMembershipsByStart,
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


it("filters retained membership records by their own archive status without changing enrollment", () => {
  const source = [
    member("active-before", "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"),
    member("archived", "2026-11-06T17:00:00Z", "2026-11-06T20:00:00Z", true),
    member("active-after", "2026-11-06T17:00:00Z", "2026-11-06T20:00:00Z"),
    member("foreign", "2026-11-06T17:00:00Z", "2026-11-06T20:00:00Z",
      false, OTHER),
    record("not-membership", "availability", { resource: "crew-a" }),
  ];
  const all = resourceMembershipRowsForReview(
    source, crew, "all", "", "UTC",
  );
  const before = structuredClone(all);
  expect(filterResourceMembershipRecordStatus(all, "all")
    .map((r) => r.id)).toEqual([
    "active-before", "archived", "active-after",
  ]);
  expect(filterResourceMembershipRecordStatus(all, "current")
    .map((r) => r.id)).toEqual(["active-before", "active-after"]);
  expect(filterResourceMembershipRecordStatus(all, "archived")
    .map((r) => r.id)).toEqual(["archived"]);
  const day = resourceMembershipRowsForReview(
    source, crew, "overlapping-day", "2026-11-06", "UTC",
  );
  expect(filterResourceMembershipRecordStatus(day, "archived")
    .map((r) => r.id)).toEqual(["archived"]);
  expect(filterResourceMembershipRecordStatus(day, "current")
    .map((r) => r.id)).toEqual(["active-after"]);
  // Even a status filter with no matches does not edit retained history.
  expect(filterResourceMembershipRecordStatus(
    resourceMembershipRowsForReview(source, crew, "overlapping-day",
      "2026-11-03", "UTC"), "current",
  )).toEqual([]);
  expect(all).toEqual(before);
  expect(source).toHaveLength(5);
  expect(filterResourceMembershipRecordStatus(
    [record("wrong", "availability", { title: "Not membership" })],
    "all",
  )).toEqual([]);
});


it("sorts retained memberships by effective start without mutating, with stable ties and invalid starts last", () => {
  const memberWithStart = (id: string, start: string) =>
    member(id, start, "2026-12-01T00:00:00Z");
  const input = [
    memberWithStart("later-a", "2026-11-07T08:00:00Z"),
    memberWithStart("invalid-a", "invalid"),
    memberWithStart("earliest", "2026-11-06T08:00:00Z"),
    memberWithStart("later-b", "2026-11-07T08:00:00Z"),
    memberWithStart("invalid-b", ""),
  ];
  const snapshot = structuredClone(input);
  expect(orderResourceMembershipsByStart(input, "retained")
    .map((r) => r.id)).toEqual([
    "later-a", "invalid-a", "earliest", "later-b", "invalid-b",
  ]);
  expect(orderResourceMembershipsByStart(input, "oldest")
    .map((r) => r.id)).toEqual([
    "earliest", "later-a", "later-b", "invalid-a", "invalid-b",
  ]);
  expect(orderResourceMembershipsByStart(input, "newest")
    .map((r) => r.id)).toEqual([
    "later-a", "later-b", "earliest", "invalid-a", "invalid-b",
  ]);
  expect(input).toEqual(snapshot);
});

it("sorts by recorded UTC instant across an autumn DST fold, not ambiguous local clock text", () => {
  const input = [
    member("second-130", "2026-11-01T09:30:00Z", "2026-11-01T09:45:00Z"),
    member("first-130", "2026-11-01T08:30:00Z", "2026-11-01T08:45:00Z"),
  ];
  expect(orderResourceMembershipsByStart(input, "oldest")
    .map((r) => r.id)).toEqual(["first-130", "second-130"]);
  expect(orderResourceMembershipsByStart(input, "newest")
    .map((r) => r.id)).toEqual(["second-130", "first-130"]);
});
