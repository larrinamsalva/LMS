import { expect, it } from "vitest";
import type { RateContinuityReviewItem } from "../../src/core/service-rate-continuity";
import { filterContinuityWarnings } from "../../src/core/service-rate-continuity-filter";

const issues: RateContinuityReviewItem[] = [
  {
    rateId: "private-id-one",
    rateTitle: "Local hourly rate",
    serviceName: "Home cleaning",
    areaName: "Local service area",
    endDate: "2027-01-01",
    status: "Uncovered",
    nextStart: "2027-01-05",
  },
  {
    rateId: "private-id-two",
    rateTitle: "Outer labor rate",
    serviceName: "Repair",
    areaName: "Outer service area",
    endDate: "2027-01-02",
    status: "Uncovered",
    nextStart: null,
  },
  {
    rateId: "private-id-three",
    rateTitle: "Old area rate",
    serviceName: "Retained service link",
    areaName: "Former area",
    endDate: "2027-01-03",
    status: "Review links",
    nextStart: null,
  },
];

it("filters by warning type while retaining source ordering", () => {
  expect(filterContinuityWarnings(issues, "all", "").map((x) => x.rateId))
    .toEqual(["private-id-one", "private-id-two", "private-id-three"]);
  expect(filterContinuityWarnings(issues, "uncovered", "").map((x) => x.rateId))
    .toEqual(["private-id-one", "private-id-two"]);
  expect(filterContinuityWarnings(issues, "review-links", "").map((x) => x.rateId))
    .toEqual(["private-id-three"]);
});

it("searches only displayed names and end dates, ignoring case and spaces", () => {
  expect(filterContinuityWarnings(issues, "all", "  OUTER  ")
    .map((x) => x.rateTitle)).toEqual(["Outer labor rate"]);
  expect(filterContinuityWarnings(issues, "uncovered", "HOME cleaning")
    .map((x) => x.rateTitle)).toEqual(["Local hourly rate"]);
  expect(filterContinuityWarnings(issues, "all", "2027-01-03")
    .map((x) => x.rateTitle)).toEqual(["Old area rate"]);
  expect(filterContinuityWarnings(issues, "uncovered", "Former")).toEqual([]);
  expect(filterContinuityWarnings(issues, "all", "private-id-one")).toEqual([]);
  expect(filterContinuityWarnings(issues, "all", "2027-01-05")).toEqual([]);
});

it("does not mutate the existing audit warnings or leak hidden fields", () => {
  const before = structuredClone(issues);
  const filtered = filterContinuityWarnings(issues, "review-links", "retained");
  expect(filtered).toHaveLength(1);
  expect(filtered[0]).toBe(issues[2]);
  expect(issues).toEqual(before);
});
