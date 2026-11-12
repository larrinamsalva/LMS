import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import { reviewServiceRateContinuity } from "../../src/core/service-rate-continuity";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const foreign = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const rec = (
  id: string, entity: string, data: WorkspaceRecord["data"],
  archived = false, organization_id = org,
): WorkspaceRecord => ({
  id, entity, data, archived, organization_id, revision: 1,
  config_revision: 1, created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});
const rate = (
  id: string, service: string, zone: string, start: string,
  end = "", archived = false, organization_id = org,
): WorkspaceRecord => rec(
  id, "service-rates", {
    title: id, service, zone, effective_from: start, effective_until: end,
  }, archived, organization_id,
);

it("finds only ends without same-day coverage, including later successor gaps", () => {
  const records = [
    rec("local", "pricing-zones", { name: "Local" }),
    rec("outer", "pricing-zones", { name: "Outer" }),
    rec("base", "services", { name: "Cleaning" }),
    rec("extra", "services", { name: "Oven" }),
    rate("ending-covered", "base", "local", "2026-01-01", "2027-01-01"),
    rate("replacement", "base", "local", "2027-01-01"),
    rate("ending-gap", "extra", "local", "2026-01-01", "2027-01-01"),
    rate("later", "extra", "local", "2027-01-05"),
    rate("outer-gap", "base", "outer", "2026-01-01", "2027-01-01"),
    rate("other-org", "base", "outer", "2027-01-01", "", false, foreign),
    rate("archived", "base", "outer", "2027-01-01", "", true),
  ];
  const before = structuredClone(records);
  const result = reviewServiceRateContinuity(records, org, "2026-12-15", "", 30);
  expect(result).toEqual({
    status: "ready",
    through: "2027-01-14",
    reviewedEnds: 3,
    uncoveredCount: 2,
    linkedReviewCount: 0,
    issues: [
      {
        rateId: "ending-gap", rateTitle: "ending-gap",
        serviceName: "Oven", areaName: "Local", endDate: "2027-01-01",
        status: "Uncovered", nextStart: "2027-01-05",
      },
      {
        rateId: "outer-gap", rateTitle: "outer-gap",
        serviceName: "Cleaning", areaName: "Outer", endDate: "2027-01-01",
        status: "Uncovered", nextStart: null,
      },
    ],
  });
  const local = reviewServiceRateContinuity(records, org, "2026-12-15", "local", 30);
  expect(local.status).toBe("ready");
  if (local.status === "ready") {
    expect(local.reviewedEnds).toBe(2);
    expect(local.uncoveredCount).toBe(1);
  }
  expect(records).toEqual(before);
});

it("separates archived/unavailable linked catalog records from confirmed gaps", () => {
  const records = [
    rec("active", "pricing-zones", { name: "Active area" }),
    rec("old", "pricing-zones", { name: "Retired area" }, true),
    rec("foreign-area", "pricing-zones", { name: "Secret area" }, false, foreign),
    rec("service", "services", { name: "Repair" }),
    rec("retired", "services", { name: "Retired service" }, true),
    rec("foreign-service", "services", { name: "Private service" }, false, foreign),
    rate("archived-link", "retired", "old", "2026-01-01", "2027-01-01"),
    rate("unavailable-link", "foreign-service", "foreign-area",
      "2026-01-01", "2027-01-01"),
    rate("active-gap", "service", "active", "2026-01-01", "2027-01-01"),
  ];
  const result = reviewServiceRateContinuity(records, org, "2026-12-15");
  expect(result.status).toBe("ready");
  if (result.status === "ready") {
    expect(result.reviewedEnds).toBe(3);
    expect(result.linkedReviewCount).toBe(2);
    expect(result.uncoveredCount).toBe(1);
    expect(result.issues.map((v) => v.status))
      .toEqual(["Review links", "Uncovered", "Review links"]);
    expect(JSON.stringify(result)).not.toContain("Private service");
    expect(JSON.stringify(result)).not.toContain("Secret area");
  }
});

it("respects date windows, archived records and invalid selections", () => {
  const records = [
    rec("local", "pricing-zones", { name: "Local" }),
    rec("private-area", "pricing-zones", { name: "Private" }, false, foreign),
    rec("service", "services", { name: "Clean" }),
    rate("active", "service", "local", "2026-01-01", "2027-01-01"),
    rate("archived-rate", "service", "local", "2026-01-01", "2027-01-02", true),
  ];
  expect(reviewServiceRateContinuity(records, org, "").status).toBe("choose");
  expect(reviewServiceRateContinuity(records, org, "2026-02-30").status)
    .toBe("invalid-date");
  expect(reviewServiceRateContinuity(records, org, "2026-12-15", "private-area").status)
    .toBe("invalid-area");
  const short = reviewServiceRateContinuity(records, org, "2026-12-15", "", 7);
  expect(short.status).toBe("ready");
  if (short.status === "ready") expect(short.reviewedEnds).toBe(0);
  const thirty = reviewServiceRateContinuity(records, org, "2026-12-15", "", 30);
  expect(thirty.status).toBe("ready");
  if (thirty.status === "ready") {
    expect(thirty.reviewedEnds).toBe(1);
    expect(thirty.uncoveredCount).toBe(1);
  }
  const after = reviewServiceRateContinuity(records, org, "2027-01-01", "", 30);
  expect(after.status).toBe("ready");
  if (after.status === "ready") expect(after.reviewedEnds).toBe(0);
});
