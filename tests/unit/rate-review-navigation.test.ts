import { expect, it } from "vitest";
import {
  rememberRateReviewJump, returnableRateReviewDate,
} from "../../src/core/rate-review-navigation";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherOrg = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

it("remembers a one-step forward review and restores only the original day", () => {
  const jump = rememberRateReviewJump(
    org, "2026-12-15", "local", "2027-01-01",
  );
  expect(jump).toEqual({
    organizationId: org,
    previousDate: "2026-12-15",
    areaId: "local",
    jumpedDate: "2027-01-01",
  });
  expect(returnableRateReviewDate(jump, org, "2027-01-01", "local"))
    .toBe("2026-12-15");
  expect(returnableRateReviewDate(jump, org, "2027-01-01", "outer"))
    .toBeNull();
  expect(returnableRateReviewDate(jump, org, "2027-01-02", "local"))
    .toBeNull();
  expect(returnableRateReviewDate(jump, otherOrg, "2027-01-01", "local"))
    .toBeNull();
  expect(jump?.previousDate).toBe("2026-12-15");
});

it("supports a previously unselected area but never invents a missing date", () => {
  const jump = rememberRateReviewJump(
    org, "2026-11-06", "", "2027-01-01",
  );
  expect(returnableRateReviewDate(jump, org, "2027-01-01", ""))
    .toBe("2026-11-06");
  expect(rememberRateReviewJump(org, "", "", "2027-01-01")).toBeNull();
  expect(rememberRateReviewJump(org, "2026-11-06", "", "")).toBeNull();
});

it("rejects invalid, equal, reverse or absent organization jumps", () => {
  expect(rememberRateReviewJump("", "2026-11-06", "", "2027-01-01")).toBeNull();
  expect(rememberRateReviewJump(org, "2026-02-30", "", "2027-01-01"))
    .toBeNull();
  expect(rememberRateReviewJump(org, "2026-11-06", "", "2027-02-30"))
    .toBeNull();
  expect(rememberRateReviewJump(org, "2027-01-01", "", "2027-01-01"))
    .toBeNull();
  expect(rememberRateReviewJump(org, "2027-01-02", "", "2027-01-01"))
    .toBeNull();
  expect(returnableRateReviewDate(null, org, "2027-01-01", ""))
    .toBeNull();
});
