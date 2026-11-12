import { expect, it } from "vitest";
import type { RateContinuityReview } from "../../src/core/service-rate-continuity";
import { summarizeContinuityActions } from "../../src/core/service-rate-continuity-action-summary";

const readyReview: RateContinuityReview = {
  status: "ready",
  through: "2027-01-14",
  reviewedEnds: 6,
  uncoveredCount: 3,
  linkedReviewCount: 2,
  issues: [
    {
      rateId: "ending-later",
      rateTitle: "Later successor",
      serviceName: "Cleaning",
      areaName: "Local",
      endDate: "2027-01-04",
      nextStart: "2027-01-06",
      status: "Uncovered",
    },
    {
      rateId: "ending-none",
      rateTitle: "Missing successor",
      serviceName: "Repairs",
      areaName: "Outer",
      endDate: "2027-01-03",
      nextStart: null,
      status: "Uncovered",
    },
    {
      rateId: "old-link",
      rateTitle: "Former service",
      serviceName: "Retained service link",
      areaName: "Former area",
      endDate: "2027-01-02",
      nextStart: null,
      status: "Review links",
    },
    {
      rateId: "ending-earlier",
      rateTitle: "Earlier gap",
      serviceName: "Cleaning",
      areaName: "Local",
      endDate: "2027-01-01",
      nextStart: "2027-01-05",
      status: "Uncovered",
    },
    {
      rateId: "missing-link",
      rateTitle: "Foreign linked record",
      serviceName: "Retained service link",
      areaName: "Retained area link",
      endDate: "2027-01-06",
      nextStart: null,
      status: "Review links",
    },
  ],
};

it("separates missing successors, delayed starts and linked-record reviews", () => {
  const original = structuredClone(readyReview);
  expect(summarizeContinuityActions(readyReview)).toEqual({
    status: "ready",
    withoutLaterRate: 1,
    delayedReplacement: 2,
    reviewLinks: 2,
    firstWithoutLaterEnd: "2027-01-03",
    firstDelayedEnd: "2027-01-01",
    firstReviewLinksEnd: "2027-01-02",
  });
  expect(readyReview).toEqual(original);
});

it("uses null for categories without findings instead of a misleading date", () => {
  const empty: RateContinuityReview = {
    status: "ready", through: "2027-01-01", reviewedEnds: 3,
    uncoveredCount: 0, linkedReviewCount: 0, issues: [],
  };
  expect(summarizeContinuityActions(empty)).toEqual({
    status: "ready", withoutLaterRate: 0, delayedReplacement: 0, reviewLinks: 0,
    firstWithoutLaterEnd: null, firstDelayedEnd: null, firstReviewLinksEnd: null,
  });
});

it("does not summarize invalid, missing-date or unauthorized area selections", () => {
  for (const status of ["choose", "invalid-date", "invalid-area"] as const) {
    const review: RateContinuityReview = {
      status, reviewedEnds: 0, uncoveredCount: 0,
      linkedReviewCount: 0, issues: [], through: "",
    };
    expect(summarizeContinuityActions(review)).toEqual({ status: "unavailable" });
  }
});

it("does not reveal titles, raw IDs, prices, or other private details", () => {
  const result = summarizeContinuityActions(readyReview);
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain("ending-later");
  expect(serialized).not.toContain("Missing successor");
  expect(serialized).not.toContain("Repairs");
  expect(serialized).not.toContain("Foreign linked record");
  expect(serialized).not.toContain("Retained area link");
});
