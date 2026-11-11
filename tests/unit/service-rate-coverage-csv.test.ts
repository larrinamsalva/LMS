import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import { serviceRateCoverageReviewCsv } from "../../src/core/service-rate-coverage-csv";
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
it("exports only scoped missing-rate candidates with blank review columns", () => {
  const records = [
    rec("area", "pricing-zones", { name: "Local" }),
    rec("other-area", "pricing-zones", { name: "Outer" }),
    rec("priced", "services", { name: "Base", kind: "Service", mode: "Hourly", unit: "hour" }),
    rec("gap", "services", { name: "Oven", kind: "Extra", mode: "Fixed", unit: "oven" }),
    rec("old", "services", { name: "Retired" }, true),
    rec("private", "services", { name: "Confidential" }, false, foreign),
    rec("rate", "service-rates", { service: "priced", zone: "area", effective_from: "2026-01-01" }),
    rec("archived-rate", "service-rates", { service: "gap", zone: "area", effective_from: "2026-01-01" }, true),
    rec("foreign-rate", "service-rates", { service: "gap", zone: "area", effective_from: "2026-01-01" }, false, foreign),
    rec("outer-rate", "service-rates", { service: "gap", zone: "other-area", effective_from: "2026-01-01" }),
  ];
  const before = structuredClone(records);
  const csv = serviceRateCoverageReviewCsv(records, org, "area", "2026-11-06");
  const lines = csv.trimEnd().split("\r\n");
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain('"Operator decision (fill manually)"');
  expect(lines[1]).toBe(
    '"Local","2026-11-06","Oven","Extra","Fixed","oven",' +
    '"No active saved rate for area/date - review offering","",""',
  );
  expect(csv).not.toContain("Retired");
  expect(csv).not.toContain("Confidential");
  expect(csv).not.toContain('"Base"');
  expect(records).toEqual(before);
});
it("returns header only for covered services and flags missing historic periods", () => {
  const records = [
    rec("area", "pricing-zones", { name: "Local" }),
    rec("item", "services", { name: "Repair" }),
    rec("rate", "service-rates", { service: "item", zone: "area", effective_from: "2026-01-01" }),
  ];
  expect(serviceRateCoverageReviewCsv(records, org, "area", "2026-11-06").trimEnd().split("\r\n")).toHaveLength(1);
  expect(serviceRateCoverageReviewCsv(records, org, "area", "2025-12-31")).toContain('"Repair"');
});
it("refuses missing, archived, foreign or invalid area/date selections", () => {
  const records = [
    rec("area", "pricing-zones", { name: "Local" }),
    rec("old", "pricing-zones", { name: "Retired" }, true),
    rec("foreign", "pricing-zones", { name: "Private" }, false, foreign),
  ];
  for (const [area, date] of [
    ["", "2026-11-06"], ["area", ""], ["area", "2026-02-30"],
    ["old", "2026-11-06"], ["foreign", "2026-11-06"],
    ["missing", "2026-11-06"],
  ]) {
    expect(() => serviceRateCoverageReviewCsv(records, org, area, date)).toThrow(
      "Select an active authorized service area and valid date.",
    );
  }
});
it("neutralizes CSV formula injection in service and area names", () => {
  const records = [
    rec("area", "pricing-zones", { name: "+AREA" }),
    rec("item", "services", { name: "=BAD()", kind: "Service" }),
  ];
  const csv = serviceRateCoverageReviewCsv(records, org, "area", "2026-11-06");
  expect(csv).toContain("\"'+AREA\"");
  expect(csv).toContain("\"'=BAD()\"");
});
