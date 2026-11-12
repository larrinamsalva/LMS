import { expect, it } from "vitest";
import type {
  RateContinuityReview,
  RateContinuityReviewItem,
} from "../../src/core/service-rate-continuity";
import { focusedContinuityReviewIssues } from "../../src/core/service-rate-continuity-selection";

const local: RateContinuityReviewItem = {
  rateId: "local", rateTitle: "Local rate", serviceName: "Cleaning",
  areaName: "Local", endDate: "2027-01-01", status: "Uncovered",
  nextStart: null,
};
const outer: RateContinuityReviewItem = {
  rateId: "outer", rateTitle: "Outer rate", serviceName: "Repairs",
  areaName: "Outer", endDate: "2027-01-02", status: "Uncovered",
  nextStart: "2027-01-05",
};
const linked: RateContinuityReviewItem = {
  rateId: "linked", rateTitle: "Retained", serviceName: "Retained service link",
  areaName: "Former area", endDate: "2027-01-03", status: "Review links",
  nextStart: null,
};
const ready: RateContinuityReview = {
  status: "ready", through: "2027-01-30", reviewedEnds: 3,
  uncoveredCount: 2, linkedReviewCount: 1,
  issues: [local, outer, linked],
};

it("focuses selected cards without changing the order or mutating the authorized review", () => {
  const filtered = [linked, outer, local]; // Existing UI filter/sort order.
  const beforeReview = structuredClone(ready);
  const beforeCards = structuredClone(filtered);
  expect(focusedContinuityReviewIssues(
    ready, filtered, ["local", "linked", "linked"], true,
  )).toEqual([linked, local]);
  expect(focusedContinuityReviewIssues(
    ready, filtered, ["local"], false,
  )).toEqual([linked, outer, local]);
  expect(focusedContinuityReviewIssues(
    ready, [], ["local"], true,
  )).toEqual([]);
  expect(ready).toEqual(beforeReview);
  expect(filtered).toEqual(beforeCards);
});

it("reprojects cards from current authorized review, excluding forged and duplicate entries", () => {
  const fake: RateContinuityReviewItem = {
    ...local, rateTitle: "PRIVATE FOREIGN CUSTOMER RATE",
  };
  const foreign: RateContinuityReviewItem = {
    ...local, rateId: "foreign", rateTitle: "OTHER ORGANIZATION",
  };
  const focused = focusedContinuityReviewIssues(
    ready, [fake, foreign, outer, local, outer], ["local", "foreign", "outer"], true,
  );
  expect(focused).toEqual([local, outer]);
  expect(focused[0]).toBe(local);
  expect(focused.map((card) => card.rateTitle).join(" ")).not.toContain("PRIVATE");
  expect(focused.map((card) => card.rateTitle).join(" ")).not.toContain("OTHER");
  expect(focusedContinuityReviewIssues(
    ready, [fake, foreign, local], [], false,
  )).toEqual([local]);
  expect(focusedContinuityReviewIssues(
    ready, [local, outer], ["unknown"], true,
  )).toEqual([]);
});

it("refuses invalid or unauthorized review states, even with incoming cards and IDs", () => {
  for (const status of ["choose", "invalid-date", "invalid-area"] as const) {
    const invalid: RateContinuityReview = {
      status, through: "", reviewedEnds: 0, uncoveredCount: 0,
      linkedReviewCount: 0, issues: [],
    };
    expect(focusedContinuityReviewIssues(
      invalid, [local, outer], ["local"], true,
    )).toEqual([]);
    expect(focusedContinuityReviewIssues(
      invalid, [local], ["local"], false,
    )).toEqual([]);
  }
});
