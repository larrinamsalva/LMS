import type { WorkspaceRecord } from "./engine";
import { csvSafeCell } from "./daily-operations-csv";
import {
  upcomingServiceRateDates,
  type RateDateWindow,
} from "./upcoming-service-rate-dates";

/**
 * Downloadable snapshot of exactly the selected upcoming-rate review.
 * Recompute from current, organization-scoped records. Never accept
 * user-supplied events or expose raw IDs, prices, customer or staff data.
 *
 * A date boundary is a review event, not a quote, calendar reminder,
 * invoice, or automatic price update.
 */
export function upcomingServiceRateDatesCsv(
  records: readonly WorkspaceRecord[],
  organizationId: string,
  asOfDate: string,
  selectedAreaId = "",
  days: RateDateWindow = 30,
): string {
  const audit = upcomingServiceRateDates(
    records, organizationId, asOfDate, selectedAreaId, days,
  );
  if (audit.status !== "ready") {
    throw new Error("Choose an authorized area and valid date/window.");
  }
  const header = [
    "Review from (exclusive)", "Review through (inclusive)",
    "Boundary date", "Boundary type", "Saved rate title",
    "Service", "Service area", "Linked catalog status",
    "Operator decision (fill manually)", "Review notes (fill manually)",
  ];
  const rows = audit.events.map((event) => [
    asOfDate,
    audit.through,
    event.date,
    event.kind === "Ends" ? "Ends (exclusive)" : "Starts",
    event.rateTitle,
    event.serviceName,
    event.areaName,
    event.linkStatus,
    "",
    "",
  ]);
  return [header, ...rows]
    .map((row) => row.map(csvSafeCell).join(","))
    .join("\r\n") + "\r\n";
}
