import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import {
  allAreaRateCoverage,
  allAreaRateCoverageCsv,
} from "../../src/core/service-rate-coverage-overview";
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
it("ranks active areas by missing area/service pairs without reading other businesses", () => {
  const records = [
    rec("local", "pricing-zones", { name: "Local" }),
    rec("outer", "pricing-zones", { name: "Outer" }),
    rec("retired-area", "pricing-zones", { name: "Archived" }, true),
    rec("foreign-area", "pricing-zones", { name: "Confidential area" }, false, foreign),
    rec("repair", "services", { name: "Repair" }),
    rec("clean", "services", { name: "Clean" }),
    rec("detail", "services", { name: "Detail" }),
    rec("retired", "services", { name: "Retired" }, true),
    rec("private", "services", { name: "Other client" }, false, foreign),
    rec("local-repair", "service-rates", {
      service: "repair", zone: "local", effective_from: "2026-01-01",
      effective_until: "2027-01-01",
    }),
    rec("local-clean", "service-rates", {
      service: "clean", zone: "local", effective_from: "2026-01-01",
    }),
    rec("outer-repair", "service-rates", {
      service: "repair", zone: "outer", effective_from: "2027-01-01",
    }),
    rec("outer-archived", "service-rates", {
      service: "detail", zone: "outer", effective_from: "2026-01-01",
    }, true),
    rec("foreign-price", "service-rates", {
      service: "detail", zone: "outer", effective_from: "2026-01-01",
    }, false, foreign),
  ];
  const before = structuredClone(records);
  const summary = allAreaRateCoverage(records, org, "2026-11-06");
  expect(summary).toEqual({
    status: "ready", date: "2026-11-06", missingCandidateTotal: 4,
    areas: [
      { areaId: "outer", areaName: "Outer", totalActiveServices: 3,
        coveredServices: 0, missingCandidates: 3 },
      { areaId: "local", areaName: "Local", totalActiveServices: 3,
        coveredServices: 2, missingCandidates: 1 },
    ],
  });
  const csv = allAreaRateCoverageCsv(records, org, "2026-11-06");
  expect(csv.trimEnd().split("\r\n")).toHaveLength(3);
  expect(csv).toContain('"Outer","2026-11-06","3","0","3"');
  expect(csv).toContain('"Local","2026-11-06","3","2","1"');
  expect(csv).not.toContain("Confidential");
  expect(csv).not.toContain("Other client");
  expect(csv).not.toContain("Archived");
  expect(records).toEqual(before);
});
it("honors effective-date boundaries and refuses missing or invalid dates", () => {
  const records = [
    rec("area", "pricing-zones", { name: "Area" }),
    rec("service", "services", { name: "Service" }),
    rec("rate", "service-rates", {
      service: "service", zone: "area",
      effective_from: "2026-01-01", effective_until: "2027-01-01",
    }),
  ];
  expect(allAreaRateCoverage(records, org, "").status).toBe("choose");
  expect(allAreaRateCoverage(records, org, "2026-02-30").status).toBe("invalid-date");
  expect(() => allAreaRateCoverageCsv(records, org, "")).toThrow(
    "Choose a valid rate date for all-area coverage.",
  );
  const first = allAreaRateCoverage(records, org, "2026-01-01");
  const last = allAreaRateCoverage(records, org, "2027-01-01");
  expect(first.status).toBe("ready");
  expect(last.status).toBe("ready");
  if (first.status === "ready" && last.status === "ready") {
    expect(first.areas[0].missingCandidates).toBe(0);
    expect(last.areas[0].missingCandidates).toBe(1);
  }
});
it("exports empty active-area summaries with header only and guards formula-like names", () => {
  const noAreas = [rec("archived", "pricing-zones", { name: "No show" }, true)];
  const report = allAreaRateCoverage(noAreas, org, "2026-11-06");
  expect(report.status).toBe("ready");
  if (report.status === "ready") expect(report.areas).toHaveLength(0);
  expect(allAreaRateCoverageCsv(noAreas, org, "2026-11-06")
    .trimEnd().split("\r\n")).toHaveLength(1);
  const injected = [rec("area", "pricing-zones", { name: "=FAKE()" })];
  expect(allAreaRateCoverageCsv(injected, org, "2026-11-06"))
    .toContain("\"'=FAKE()\"");
});
