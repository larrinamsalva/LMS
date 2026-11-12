import { Temporal } from "@js-temporal/polyfill";
import type { WorkspaceRecord } from "./engine";
import { csvSafeCell } from "./daily-operations-csv";
import { reviewServiceRateContinuity } from "./service-rate-continuity";
import type { RateDateWindow } from "./upcoming-service-rate-dates";

/**
 * A read-only, human-decision checklist for exactly the currently flagged
 * continuity issues. Recompute from the authorized organization and explicit
 * review date, area and window. Never export saved rate IDs, amounts, customers,
 * contacts or other organizations' linked catalog names.
 *
 * "Review links" is intentionally separate from a known uncovered period.
 * A missing successor has unknown total duration, not zero gap days.
 */
export function serviceRateContinuityReviewCsv(
  records: readonly WorkspaceRecord[],
  organizationId: string,
  asOfDate: string,
  selectedAreaId = "",
  days: RateDateWindow = 30,
): string {
  const report = reviewServiceRateContinuity(
    records, organizationId, asOfDate, selectedAreaId, days,
  );
  if (report.status !== "ready") {
    throw new Error("Choose an authorized area and valid date/window.");
  }

  const header = [
    "Review from (exclusive)",
    "Review through (inclusive)",
    "Saved rate title",
    "Service",
    "Service area",
    "Rate ends (exclusive)",
    "Review status",
    "Next active saved rate starts",
    "Uncovered calendar days",
    "Operator decision (fill manually)",
    "Review notes (fill manually)",
  ];
  const rows = report.issues.map((issue) => {
    const gapDays = issue.status === "Uncovered" && issue.nextStart
      ? String(Temporal.PlainDate.from(issue.endDate).until(
          Temporal.PlainDate.from(issue.nextStart),
        ).days)
      : "";
    return [
      asOfDate,
      report.through,
      issue.rateTitle,
      issue.serviceName,
      issue.areaName,
      issue.endDate,
      issue.status,
      issue.nextStart ?? "",
      gapDays,
      "",
      "",
    ];
  });
  return [header, ...rows]
    .map((row) => row.map(csvSafeCell).join(","))
    .join("\r\n") + "\r\n";
}
