import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import {
  investigateRateContinuityGap,
} from "../../src/core/service-rate-continuity-investigation";

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
it("shows an expiring rate and delayed replacement with precise missing days", () => {
  const records = [
    rec("local", "pricing-zones", { name: "Local area" }),
    rec("outer", "pricing-zones", { name: "Outer area" }),
    rec("service", "services", { name: "Cleaning" }),
    rec("extra", "services", { name: "Oven" }),
    rate("old", "service", "local", "2026-01-01", "2027-01-01"),
    rate("later", "service", "local", "2027-01-05"),
    rate("archived", "service", "local", "2027-01-01", "", true),
    rate("other-area", "service", "outer", "2027-01-01"),
    rate("other-service", "extra", "local", "2027-01-01"),
    rate("private", "service", "local", "2027-01-01", "", false, foreign),
  ];
  const before = structuredClone(records);
  const review = investigateRateContinuityGap(
    records, org, "2026-12-15", "", 30, "old",
  );
  expect(review).toEqual({
    status: "ready",
    endDate: "2027-01-01",
    gapDays: 4,
    nextStart: "2027-01-05",
    entries: [
      { rateId: "old", title: "old", from: "2026-01-01",
        until: "2027-01-01", archived: false, isEnding: true },
      { rateId: "archived", title: "archived", from: "2027-01-01",
        until: "Open end", archived: true, isEnding: false },
      { rateId: "later", title: "later", from: "2027-01-05",
        until: "Open end", archived: false, isEnding: false },
    ],
  });
  expect(records).toEqual(before);
});
it("distinguishes an indefinite gap from a later saved rate", () => {
  const records = [
    rec("local", "pricing-zones", { name: "Local area" }),
    rec("service", "services", { name: "Cleaning" }),
    rate("old", "service", "local", "2026-01-01", "2027-01-01"),
  ];
  const report = investigateRateContinuityGap(
    records, org, "2026-12-15", "local", 30, "old",
  );
  expect(report.status).toBe("ready");
  if (report.status === "ready") {
    expect(report.gapDays).toBeNull();
    expect(report.nextStart).toBeNull();
    expect(report.entries).toHaveLength(1);
  }
});
it("refuses covered rates, absent/private identifiers and invalid selections", () => {
  const records = [
    rec("local", "pricing-zones", { name: "Local" }),
    rec("foreign-zone", "pricing-zones", { name: "SECRET AREA" }, false, foreign),
    rec("service", "services", { name: "Cleaning" }),
    rec("foreign-service", "services", { name: "SECRET SERVICE" }, false, foreign),
    rate("covered", "service", "local", "2026-01-01", "2027-01-01"),
    rate("replacement", "service", "local", "2027-01-01"),
    rate("foreign-rate", "foreign-service", "foreign-zone",
      "2026-01-01", "2027-01-01"),
  ];
  const find = (rateId: string, date = "2026-12-15", area = "") =>
    investigateRateContinuityGap(records, org, date, area, 30, rateId);
  expect(find("covered")).toEqual({ status: "unavailable" });
  expect(find("replacement")).toEqual({ status: "unavailable" });
  expect(find("foreign-rate")).toEqual({ status: "unavailable" });
  expect(find("unlisted")).toEqual({ status: "unavailable" });
  expect(find("")).toEqual({ status: "unavailable" });
  expect(find("covered", "2026-02-30")).toEqual({ status: "unavailable" });
  expect(find("covered", "2026-12-15", "foreign-zone"))
    .toEqual({ status: "unavailable" });
});
it("will not reveal history from a linked archived or unavailable area", () => {
  const records = [
    rec("old-area", "pricing-zones", { name: "Archived" }, true),
    rec("foreign-zone", "pricing-zones", { name: "Private" }, false, foreign),
    rec("service", "services", { name: "Cleaning" }),
    rec("foreign-service", "services", { name: "Private service" }, false, foreign),
    rate("archived-link", "service", "old-area", "2026-01-01", "2027-01-01"),
    rate("foreign-link", "foreign-service", "foreign-zone",
      "2026-01-01", "2027-01-01"),
  ];
  expect(investigateRateContinuityGap(
    records, org, "2026-12-15", "", 30, "archived-link",
  )).toEqual({ status: "unavailable" });
  expect(investigateRateContinuityGap(
    records, org, "2026-12-15", "", 30, "foreign-link",
  )).toEqual({ status: "unavailable" });
});
