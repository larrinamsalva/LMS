import { Temporal } from "@js-temporal/polyfill";
import type { WorkspaceRecord } from "./engine";
import { csvSafeCell } from "./daily-operations-csv";
import { rateCoverageAudit } from "./service-rate-coverage";
import {
  missingRateReviewHeader,
  missingRateReviewRow,
} from "./service-rate-coverage-csv";

export interface AreaRateCoverageRow {
  areaId: string;
  areaName: string;
  totalActiveServices: number;
  coveredServices: number;
  missingCandidates: number;
}
export type RateCoverageOverview =
  | { status: "choose" | "invalid-date"; areas: []; missingCandidateTotal: 0 }
  | {
      status: "ready";
      date: string;
      areas: AreaRateCoverageRow[];
      missingCandidateTotal: number;
    };

/**
 * Read-only coverage across authorized ACTIVE pricing areas on one
 * explicit date. Missing-rate counts are area/service pairs, not unique
 * services, sales opportunities or a recommendation to offer all services.
 * Archived areas are excluded, never silently made available.
 */
export function allAreaRateCoverage(
  records: readonly WorkspaceRecord[],
  organizationId: string,
  asOfDate: string,
): RateCoverageOverview {
  if (!asOfDate) return { status: "choose", areas: [], missingCandidateTotal: 0 };
  try {
    if (Temporal.PlainDate.from(asOfDate).toString() !== asOfDate)
      return { status: "invalid-date", areas: [], missingCandidateTotal: 0 };
  } catch {
    return { status: "invalid-date", areas: [], missingCandidateTotal: 0 };
  }
  const areas = records.filter((r) =>
    r.organization_id === organizationId &&
    r.entity === "pricing-zones" && !r.archived,
  );
  const rows: AreaRateCoverageRow[] = areas.map((area) => {
    const audit = rateCoverageAudit(records, organizationId, area.id, asOfDate);
    if (audit.status !== "ready") {
      throw new Error("Cannot audit a selected active service area.");
    }
    return {
      areaId: area.id,
      areaName: audit.areaName,
      totalActiveServices: audit.totalActiveServices,
      coveredServices: audit.coveredServices,
      missingCandidates: audit.gaps.length,
    };
  });
  rows.sort((a, b) =>
    b.missingCandidates - a.missingCandidates ||
    a.areaName.localeCompare(b.areaName) ||
    a.areaId.localeCompare(b.areaId)
  );
  return {
    status: "ready",
    date: asOfDate,
    areas: rows,
    missingCandidateTotal: rows.reduce(
      (total, row) => total + row.missingCandidates, 0,
    ),
  };
}

/**
 * Snapshot the same scoped all-area summary; never export customers,
 * prices, personnel or business IDs. No new rate is created.
 */
export function allAreaRateCoverageCsv(
  records: readonly WorkspaceRecord[],
  organizationId: string,
  asOfDate: string,
): string {
  const summary = allAreaRateCoverage(records, organizationId, asOfDate);
  if (summary.status !== "ready")
    throw new Error("Choose a valid rate date for all-area coverage.");
  const rows = [[
    "Service area", "Coverage date", "Active catalog services",
    "Services with active saved rates", "Missing rate candidates",
  ], ...summary.areas.map((area) => [
    area.areaName, summary.date, String(area.totalActiveServices),
    String(area.coveredServices), String(area.missingCandidates),
  ])];
  return rows.map((row) => row.map(csvSafeCell).join(","))
    .join("\r\n") + "\r\n";
}


/**
 * One row per missing service/area pair across ACTIVE authorized areas.
 * Reuses the exact same scoped audit and review-only columns as the
 * one-area checklist. Sorting follows the all-area overview (most gaps
 * first) then each area's deterministic service-name ordering.
 *
 * A valid no-gap report is header-only; callers should disable the
 * download control rather than imply every service must be offered.
 */
export function allAreaMissingRateReviewCsv(
  records: readonly WorkspaceRecord[],
  organizationId: string,
  asOfDate: string,
): string {
  const overview = allAreaRateCoverage(records, organizationId, asOfDate);
  if (overview.status !== "ready") {
    throw new Error("Choose a valid rate date for all-area coverage.");
  }
  const rows: string[][] = [missingRateReviewHeader];
  for (const area of overview.areas) {
    if (area.missingCandidates === 0) continue;
    const audit = rateCoverageAudit(records, organizationId, area.areaId, asOfDate);
    if (audit.status !== "ready") {
      throw new Error("Cannot audit a selected active service area.");
    }
    for (const gap of audit.gaps) {
      rows.push(missingRateReviewRow(audit.areaName, audit.date, gap));
    }
  }
  return rows.map((row) => row.map(csvSafeCell).join(","))
    .join("\r\n") + "\r\n";
}
