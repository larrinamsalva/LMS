import type { WorkspaceRecord } from "./engine";
import { rateCoverageAudit, type ServiceWithoutRate } from "./service-rate-coverage";
import { csvSafeCell } from "./daily-operations-csv";

export const missingRateReviewHeader = [
  "Service area", "Coverage date", "Service", "Service kind",
  "Pricing mode", "Unit", "Review status",
  "Operator decision (fill manually)",
  "Review notes (fill manually)",
];

export function missingRateReviewRow(
  areaName: string,
  asOfDate: string,
  gap: ServiceWithoutRate,
): string[] {
  return [
    areaName, asOfDate, gap.serviceName, gap.kind, gap.mode, gap.unit,
    "No active saved rate for area/date - review offering", "", "",
  ];
}

/**
 * Recompute missing-rate candidates from the authorized organization's
 * saved records. Refuse invalid, foreign or archived areas/dates.
 * This export is review-only and never creates prices or rate records.
 */
export function serviceRateCoverageReviewCsv(
  records: readonly WorkspaceRecord[],
  organizationId: string,
  areaId: string,
  asOfDate: string,
): string {
  const audit = rateCoverageAudit(records, organizationId, areaId, asOfDate);
  if (audit.status !== "ready")
    throw new Error("Select an active authorized service area and valid date.");
  const rows = [
    missingRateReviewHeader,
    ...audit.gaps.map((gap) => missingRateReviewRow(audit.areaName, audit.date, gap)),
  ];
  return rows.map((row) => row.map(csvSafeCell).join(",")).join("\r\n") + "\r\n";
}
