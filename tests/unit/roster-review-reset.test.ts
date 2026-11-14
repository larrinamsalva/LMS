import { expect, it } from "vitest";
import { membershipReviewFiltersActive } from "../../src/core/roster-review-reset";

it("starts inactive and ignores whitespace-only member searches", () => {
  expect(membershipReviewFiltersActive("all", "all", "retained", ""))
    .toBe(false);
  expect(membershipReviewFiltersActive("all", "all", "retained", "   "))
    .toBe(false);
});

it("activates for each membership-only filter independently", () => {
  expect(membershipReviewFiltersActive(
    "overlapping-day", "all", "retained", "",
  )).toBe(true);
  expect(membershipReviewFiltersActive(
    "all", "current", "retained", "",
  )).toBe(true);
  expect(membershipReviewFiltersActive(
    "all", "archived", "retained", "",
  )).toBe(true);
  expect(membershipReviewFiltersActive(
    "all", "all", "newest", "",
  )).toBe(true);
  expect(membershipReviewFiltersActive(
    "all", "all", "oldest", "",
  )).toBe(true);
  expect(membershipReviewFiltersActive(
    "all", "all", "retained", "  Example member ",
  )).toBe(true);
});
