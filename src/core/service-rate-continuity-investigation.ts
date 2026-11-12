import { Temporal } from "@js-temporal/polyfill";
import type { WorkspaceRecord } from "./engine";
import {
  reviewServiceRateContinuity,
} from "./service-rate-continuity";
import type { RateDateWindow } from "./upcoming-service-rate-dates";

export interface RateHistoryEntry {
  rateId: string;
  title: string;
  from: string;
  until: string;
  archived: boolean;
  isEnding: boolean;
}
export type RateGapInvestigation =
  | { status: "unavailable" }
  | {
      status: "ready";
      endDate: string;
      gapDays: number | null;
      nextStart: string | null;
      entries: RateHistoryEntry[];
    };

/**
 * Inspect a flagged, live-linked continuity gap without changing
 * catalog selections or saved records. Always confirm the issue against
 * the CURRENT organization's scoped review, rather than trusting a
 * caller-provided rate id or old UI list.
 *
 * Show same-service/same-area saved rate history only. Archived rates
 * are visibly marked and cannot count toward the gap's replacement.
 * Exclude raw links, customer information and rates from other orgs.
 */
export function investigateRateContinuityGap(
  records: readonly WorkspaceRecord[],
  organizationId: string,
  asOfDate: string,
  selectedAreaId: string,
  days: RateDateWindow,
  rateId: string,
): RateGapInvestigation {
  if (!rateId) return { status: "unavailable" };
  const review = reviewServiceRateContinuity(
    records, organizationId, asOfDate, selectedAreaId, days,
  );
  if (review.status !== "ready") return { status: "unavailable" };
  const issue = review.issues.find((candidate) =>
    candidate.rateId === rateId && candidate.status === "Uncovered",
  );
  if (!issue) return { status: "unavailable" };
  const scoped = records.filter((r) => r.organization_id === organizationId);
  const current = scoped.find((r) =>
    r.id === rateId && r.entity === "service-rates" && !r.archived,
  );
  if (!current) return { status: "unavailable" };
  const entries = scoped.filter((r) =>
    r.entity === "service-rates" &&
    r.data.service === current.data.service &&
    r.data.zone === current.data.zone,
  ).map((r) => ({
    rateId: r.id,
    title: String(r.data.title ?? "Untitled saved rate"),
    from: String(r.data.effective_from ?? ""),
    until: String(r.data.effective_until || "Open end"),
    archived: r.archived,
    isEnding: r.id === rateId,
  })).sort((a, b) =>
    a.from.localeCompare(b.from) ||
    Number(a.archived) - Number(b.archived) ||
    a.title.localeCompare(b.title) ||
    a.rateId.localeCompare(b.rateId),
  );
  const gapDays = issue.nextStart === null ? null :
    Temporal.PlainDate.from(issue.endDate).until(
      Temporal.PlainDate.from(issue.nextStart),
    ).days;
  return {
    status: "ready",
    endDate: issue.endDate,
    gapDays,
    nextStart: issue.nextStart,
    entries,
  };
}
