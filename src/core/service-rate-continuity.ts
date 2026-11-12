import { Temporal } from "@js-temporal/polyfill";
import type { WorkspaceRecord } from "./engine";
import { rateCoversDate } from "./service-rate-card-csv";
import {
  upcomingServiceRateDates,
  type RateDateWindow,
} from "./upcoming-service-rate-dates";

export interface RateContinuityReviewItem {
  rateId: string;
  rateTitle: string;
  serviceName: string;
  areaName: string;
  endDate: string;
  status: "Uncovered" | "Review links";
  nextStart: string | null;
}

export type RateContinuityReview =
  | {
      status: "choose" | "invalid-date" | "invalid-area";
      reviewedEnds: 0;
      uncoveredCount: 0;
      linkedReviewCount: 0;
      issues: [];
      through: "";
    }
  | {
      status: "ready";
      through: string;
      reviewedEnds: number;
      uncoveredCount: number;
      linkedReviewCount: number;
      issues: RateContinuityReviewItem[];
    };

function validDay(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return Temporal.PlainDate.from(value).toString() === value;
  } catch {
    return false;
  }
}

/**
 * A rate's effective-until day is EXCLUSIVE: review whether some other
 * saved active rate for the same service and area covers that exact day.
 * This is not a quote/readiness guarantee and does not promise that
 * the service must be sold in the area. Gaps are planning candidates only.
 *
 * Reuse the existing organization-scoped upcoming date review. Treat
 * archived/unavailable service or area links as manual review, not
 * as confirmed missing successor prices; never expose foreign names.
 */
export function reviewServiceRateContinuity(
  records: readonly WorkspaceRecord[],
  organizationId: string,
  asOfDate: string,
  selectedAreaId = "",
  days: RateDateWindow = 30,
): RateContinuityReview {
  const upcoming = upcomingServiceRateDates(
    records, organizationId, asOfDate, selectedAreaId, days,
  );
  if (upcoming.status !== "ready") {
    return {
      status: upcoming.status,
      reviewedEnds: 0, uncoveredCount: 0, linkedReviewCount: 0,
      issues: [], through: "",
    };
  }
  const scoped = records.filter((r) => r.organization_id === organizationId);
  const rates = scoped.filter((r) => r.entity === "service-rates" && !r.archived);
  const byId = new Map(rates.map((r) => [r.id, r]));
  const issues: RateContinuityReviewItem[] = [];
  let reviewedEnds = 0;
  let uncoveredCount = 0;
  let linkedReviewCount = 0;

  for (const event of upcoming.events) {
    if (event.kind !== "Ends") continue;
    const current = byId.get(event.rateId);
    if (!current) continue;
    reviewedEnds += 1;

    const common = {
      rateId: current.id,
      rateTitle: event.rateTitle,
      serviceName: event.serviceName,
      areaName: event.areaName,
      endDate: event.date,
    };

    if (event.linkStatus !== "Active") {
      linkedReviewCount += 1;
      issues.push({
        ...common, status: "Review links", nextStart: null,
      });
      continue;
    }
    const successors = rates.filter((rate) =>
      rate.id !== current.id &&
      rate.data.service === current.data.service &&
      rate.data.zone === current.data.zone,
    );
    const covered = successors.some((rate) => rateCoversDate(rate, event.date));
    if (covered) continue;

    const futureStarts = successors
      .map((rate) => rate.data.effective_from)
      .filter((value): value is string =>
        validDay(value) && value > event.date,
      )
      .sort();
    uncoveredCount += 1;
    issues.push({
      ...common, status: "Uncovered", nextStart: futureStarts[0] ?? null,
    });
  }
  return {
    status: "ready", through: upcoming.through, reviewedEnds,
    uncoveredCount, linkedReviewCount, issues,
  };
}
