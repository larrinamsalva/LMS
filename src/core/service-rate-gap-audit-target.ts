import type { WorkspaceRecord } from "./engine";
import { rateCoverageAudit } from "./service-rate-coverage";
import { reviewServiceRateContinuity } from "./service-rate-continuity";
import type { RateDateWindow } from "./upcoming-service-rate-dates";

export type RateGapAuditTarget =
  | { status: "unavailable" }
  | {
      status: "ready";
      areaId: string;
      date: string;
      areaName: string;
      serviceName: string;
    };

/**
 * Navigate only from a currently confirmed, active-linked continuity
 * issue to the SAME authorized area's coverage audit on the rate's
 * exclusive end date. Fail closed if the issue is stale, the record
 * is foreign/archived or service/area linkage has changed.
 *
 * No writes, prices, customer data, or assumptions that every
 * service is offered in every service area.
 */
export function rateGapAuditTarget(
  records: readonly WorkspaceRecord[],
  organizationId: string,
  selectedDate: string,
  selectedAreaId: string,
  days: RateDateWindow,
  rateId: string,
): RateGapAuditTarget {
  if (!rateId) return { status: "unavailable" };
  const continuity = reviewServiceRateContinuity(
    records, organizationId, selectedDate, selectedAreaId, days,
  );
  if (continuity.status !== "ready") return { status: "unavailable" };
  const flagged = continuity.issues.find((issue) =>
    issue.status === "Uncovered" && issue.rateId === rateId,
  );
  if (!flagged) return { status: "unavailable" };

  const rate = records.find((r) =>
    r.organization_id === organizationId &&
    r.entity === "service-rates" &&
    r.id === rateId &&
    !r.archived,
  );
  if (!rate) return { status: "unavailable" };
  const areaId = String(rate.data.zone ?? "");
  const serviceId = String(rate.data.service ?? "");
  const coverage = rateCoverageAudit(
    records, organizationId, areaId, flagged.endDate,
  );
  if (coverage.status !== "ready" ||
      !coverage.gaps.some((gap) => gap.serviceId === serviceId))
    return { status: "unavailable" };

  return {
    status: "ready",
    areaId,
    date: flagged.endDate,
    areaName: coverage.areaName,
    serviceName: flagged.serviceName,
  };
}
