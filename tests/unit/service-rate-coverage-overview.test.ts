import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import {
  allAreaRateCoverage,
  allAreaRateCoverageCsv,
  allAreaMissingRateReviewCsv,
} from "../../src/core/service-rate-coverage-overview";
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

it("keeps an empty active service catalog at zero gaps in every authorized area", () => {
  const records = [
    rec("b", "pricing-zones", { name: "B area" }),
    rec("a", "pricing-zones", { name: "A area" }),
    rec("private", "pricing-zones", { name: "Confidential area" }, false, foreign),
    rec("archived-service", "services", { name: "Retired service" }, true),
    rec("foreign-service", "services", { name: "Other business service" }, false, foreign),
  ];
  const report = allAreaRateCoverage(records, org, "2026-11-06");
  expect(report).toEqual({
    status: "ready",
    date: "2026-11-06",
    missingCandidateTotal: 0,
    areas: [
      { areaId: "a", areaName: "A area", totalActiveServices: 0,
        coveredServices: 0, missingCandidates: 0 },
      { areaId: "b", areaName: "B area", totalActiveServices: 0,
        coveredServices: 0, missingCandidates: 0 },
    ],
  });
  const csv = allAreaRateCoverageCsv(records, org, "2026-11-06");
  expect(csv).not.toContain("Confidential");
  expect(csv).not.toContain("Other business service");
  expect(csv.trimEnd().split("\r\n")).toHaveLength(3);
});


it("downloads one combined review row for each missing area/service pair", () => {
  const records = [
    rec("local", "pricing-zones", { name: "Local" }),
    rec("outer", "pricing-zones", { name: "Outer" }),
    rec("old-zone", "pricing-zones", { name: "Old zone" }, true),
    rec("foreign-zone", "pricing-zones", { name: "Private area" }, false, foreign),
    rec("base", "services", { name: "Base", kind: "Service", mode: "Hourly", unit: "hour" }),
    rec("extra", "services", { name: "Oven", kind: "Extra", mode: "Fixed", unit: "oven" }),
    rec("retired", "services", { name: "Retired" }, true),
    rec("private", "services", { name: "Secret service" }, false, foreign),
    rec("local-base", "service-rates", {
      service: "base", zone: "local", effective_from: "2026-01-01",
      effective_until: "2027-01-01",
    }),
    rec("outer-base-future", "service-rates", {
      service: "base", zone: "outer", effective_from: "2027-01-01",
    }),
    rec("outer-extra-archived", "service-rates", {
      service: "extra", zone: "outer", effective_from: "2026-01-01",
    }, true),
    rec("foreign-rate", "service-rates", {
      service: "extra", zone: "outer", effective_from: "2026-01-01",
    }, false, foreign),
  ];
  const before = structuredClone(records);
  const csv = allAreaMissingRateReviewCsv(records, org, "2026-11-06");
  const lines = csv.trimEnd().split("\r\n");
  expect(lines).toHaveLength(4);
  expect(lines[0]).toContain('"Operator decision (fill manually)"');
  expect(lines[1]).toContain('"Outer","2026-11-06","Base"');
  expect(lines[2]).toContain('"Outer","2026-11-06","Oven"');
  expect(lines[3]).toContain('"Local","2026-11-06","Oven"');
  expect(csv).not.toContain("Private area");
  expect(csv).not.toContain("Secret service");
  expect(csv).not.toContain('"Retired"');
  expect(csv).not.toContain('"Old zone"');
  const local = serviceRateCoverageReviewCsv(records, org, "local", "2026-11-06");
  expect(lines[0]).toBe(local.trimEnd().split("\r\n")[0]);
  expect(lines[3]).toBe(local.trimEnd().split("\r\n")[1]);
  expect(records).toEqual(before);
});

it("rejects invalid dates, honors exclusive end dates and sanitizes CSV values", () => {
  const records = [
    rec("area", "pricing-zones", { name: "+AREA" }),
    rec("service", "services", { name: "=SERVICE()" }),
    rec("rate", "service-rates", {
      service: "service", zone: "area",
      effective_from: "2026-01-01", effective_until: "2027-01-01",
    }),
  ];
  expect(() => allAreaMissingRateReviewCsv(records, org, "")).toThrow(
    "Choose a valid rate date for all-area coverage.",
  );
  expect(() => allAreaMissingRateReviewCsv(records, org, "2026-02-30")).toThrow(
    "Choose a valid rate date for all-area coverage.",
  );
  expect(allAreaMissingRateReviewCsv(records, org, "2026-11-06")
    .trimEnd().split("\r\n")).toHaveLength(1);
  const oldCsv = allAreaMissingRateReviewCsv(records, org, "2025-12-31");
  expect(oldCsv).toContain("\"'+AREA\"");
  expect(oldCsv).toContain("\"'=SERVICE()\"");
  const exclusive = allAreaMissingRateReviewCsv(records, org, "2027-01-01");
  expect(exclusive).toContain("\"'=SERVICE()\"");
  const noActiveAreas = [rec("area", "pricing-zones", { name: "Retired" }, true)];
  expect(allAreaMissingRateReviewCsv(noActiveAreas, org, "2026-11-06")
    .trimEnd().split("\r\n")).toHaveLength(1);
});
