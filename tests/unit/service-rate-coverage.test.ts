import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import { rateCoverageAudit } from "../../src/core/service-rate-coverage";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const record = (
  id: string,
  entity: string,
  data: WorkspaceRecord["data"],
  archived = false,
  organization_id = org,
): WorkspaceRecord => ({
  id, entity, data, archived, organization_id,
  revision: 1, config_revision: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

it("spots missing live rates, including extras, at the chosen area and date", () => {
  const records = [
    record("local", "pricing-zones", { name: "Local" }),
    record("outer", "pricing-zones", { name: "Outer" }),
    record("base", "services", {
      name: "Base cleaning", kind: "Service", mode: "Hourly", unit: "hour",
    }),
    record("extra", "services", {
      name: "Oven detail", kind: "Extra", mode: "Fixed", unit: "oven",
    }),
    record("future", "services", {
      name: "Window cleaning", kind: "Service", mode: "Per unit", unit: "window",
    }),
    record("inactive", "services", { name: "Retired service" }, true),
    record("base-rate", "service-rates", {
      service: "base", zone: "local", effective_from: "2026-01-01",
      effective_until: "2027-01-01",
    }),
    record("extra-rate-archived", "service-rates", {
      service: "extra", zone: "local", effective_from: "2026-01-01",
    }, true),
    record("future-rate", "service-rates", {
      service: "future", zone: "local", effective_from: "2027-01-01",
    }),
    record("foreign-rate", "service-rates", {
      service: "extra", zone: "local", effective_from: "2026-01-01",
    }, false, other),
    record("outer-rate", "service-rates", {
      service: "extra", zone: "outer", effective_from: "2026-01-01",
    }),
  ];
  const before = structuredClone(records);
  const result = rateCoverageAudit(records, org, "local", "2026-11-06");
  expect(result).toEqual({
    status: "ready", areaName: "Local", date: "2026-11-06",
    totalActiveServices: 3, coveredServices: 1,
    gaps: [
      { serviceId: "extra", serviceName: "Oven detail", kind: "Extra", mode: "Fixed", unit: "oven" },
      { serviceId: "future", serviceName: "Window cleaning", kind: "Service", mode: "Per unit", unit: "window" },
    ],
  });
  const endBoundary = rateCoverageAudit(records, org, "local", "2027-01-01");
  expect(endBoundary.status).toBe("ready");
  if (endBoundary.status === "ready") {
    expect(endBoundary.coveredServices).toBe(1);
    expect(endBoundary.gaps.map((g) => g.serviceName)).toEqual([
      "Base cleaning", "Oven detail",
    ]);
  }
  const outer = rateCoverageAudit(records, org, "outer", "2026-11-06");
  expect(outer.status).toBe("ready");
  if (outer.status === "ready") expect(outer.coveredServices).toBe(1);
  expect(records).toEqual(before);
});

it("refuses missing, archived or foreign area and invalid date without leaking names", () => {
  const records = [
    record("archived", "pricing-zones", { name: "Former" }, true),
    record("private", "pricing-zones", { name: "Other company's area" }, false, other),
    record("local", "pricing-zones", { name: "Local" }),
    record("foreign-service", "services", { name: "Private contract" }, false, other),
    record("ours", "services", { name: "Cleaning" }),
  ];
  expect(rateCoverageAudit(records, org, "", "2026-11-06").status).toBe("choose");
  expect(rateCoverageAudit(records, org, "local", "").status).toBe("choose");
  expect(rateCoverageAudit(records, org, "archived", "2026-11-06").status).toBe("unavailable-area");
  expect(rateCoverageAudit(records, org, "private", "2026-11-06").status).toBe("unavailable-area");
  expect(rateCoverageAudit(records, org, "absent", "2026-11-06").status).toBe("unavailable-area");
  expect(rateCoverageAudit(records, org, "local", "2026-02-30").status).toBe("invalid-date");
  expect(rateCoverageAudit(records, org, "local", "2026-1-1").status).toBe("invalid-date");
  const valid = rateCoverageAudit(records, org, "local", "2026-11-06");
  expect(valid.status).toBe("ready");
  if (valid.status === "ready") {
    expect(valid.gaps.map((gap) => gap.serviceName)).toEqual(["Cleaning"]);
    expect(valid.totalActiveServices).toBe(1);
  }
});
