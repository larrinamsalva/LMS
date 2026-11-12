import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import { rateGapAuditTarget } from "../../src/core/service-rate-gap-audit-target";

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

it("selects exactly the flagged service's authorized area and exclusive end date", () => {
  const records = [
    rec("local", "pricing-zones", { name: "Local service area" }),
    rec("outer", "pricing-zones", { name: "Outer service area" }),
    rec("service", "services", { name: "House cleaning" }),
    rate("local-ending", "service", "local", "2026-01-01", "2027-01-01"),
    rate("outer-ending", "service", "outer", "2026-01-01", "2027-01-02"),
    rate("late", "service", "local", "2027-01-05"),
  ];
  const original = structuredClone(records);
  const local = rateGapAuditTarget(records, org, "2026-12-15", "", 30, "local-ending");
  expect(local).toEqual({
    status: "ready",
    areaId: "local",
    date: "2027-01-01",
    areaName: "Local service area",
    serviceName: "House cleaning",
  });
  expect(rateGapAuditTarget(records, org, "2026-12-15", "outer", 30, "outer-ending"))
    .toEqual({
      status: "ready",
      areaId: "outer",
      date: "2027-01-02",
      areaName: "Outer service area",
      serviceName: "House cleaning",
    });
  expect(rateGapAuditTarget(records, org, "2026-12-15", "outer", 30, "local-ending"))
    .toEqual({ status: "unavailable" });
  expect(records).toEqual(original);
});

it("rejects already-covered or stale warnings, dates outside window and archived records", () => {
  const records = [
    rec("local", "pricing-zones", { name: "Local" }),
    rec("service", "services", { name: "Clean" }),
    rate("covered", "service", "local", "2026-01-01", "2027-01-01"),
    rate("successor", "service", "local", "2027-01-01"),
    rate("archived-ending", "service", "local", "2026-01-01", "2027-01-01", true),
  ];
  const target = (id: string, date = "2026-12-15", days: 7 | 30 | 90 = 30) =>
    rateGapAuditTarget(records, org, date, "", days, id);
  expect(target("covered")).toEqual({ status: "unavailable" });
  expect(target("successor")).toEqual({ status: "unavailable" });
  expect(target("archived-ending")).toEqual({ status: "unavailable" });
  expect(target("missing")).toEqual({ status: "unavailable" });
  expect(target("")).toEqual({ status: "unavailable" });
  expect(target("covered", "2026-02-30")).toEqual({ status: "unavailable" });
  expect(target("covered", "2026-01-02", 7)).toEqual({ status: "unavailable" });
});

it("never navigates to another organization's service or archived linked areas", () => {
  const records = [
    rec("local", "pricing-zones", { name: "Local" }),
    rec("retired", "pricing-zones", { name: "Retired" }, true),
    rec("private-zone", "pricing-zones", { name: "SECRET zone" }, false, foreign),
    rec("service", "services", { name: "Cleaning" }),
    rec("archived-service", "services", { name: "Old" }, true),
    rec("private-service", "services", { name: "SECRET service" }, false, foreign),
    rate("local-rate", "service", "local", "2026-01-01", "2027-01-01"),
    rate("private-rate", "private-service", "private-zone",
      "2026-01-01", "2027-01-01", false, foreign),
    rate("retired-zone", "service", "retired", "2026-01-01", "2027-01-01"),
    rate("retired-service", "archived-service", "local",
      "2026-01-01", "2027-01-01"),
    rate("foreign-link", "private-service", "private-zone",
      "2026-01-01", "2027-01-01"),
  ];
  const find = (id: string, area = "") =>
    rateGapAuditTarget(records, org, "2026-12-15", area, 30, id);
  expect(find("local-rate")).toEqual({
    status: "ready", areaId: "local", date: "2027-01-01",
    areaName: "Local", serviceName: "Cleaning",
  });
  expect(find("private-rate")).toEqual({ status: "unavailable" });
  expect(find("retired-zone")).toEqual({ status: "unavailable" });
  expect(find("retired-service")).toEqual({ status: "unavailable" });
  expect(find("foreign-link")).toEqual({ status: "unavailable" });
  expect(find("local-rate", "private-zone")).toEqual({ status: "unavailable" });
});
