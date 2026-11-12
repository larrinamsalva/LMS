import type { RateContinuityReview } from "./service-rate-continuity";

export type ContinuityActionSummary =
  | { status: "unavailable" }
  | {
      status: "ready";
      withoutLaterRate: number;
      delayedReplacement: number;
      reviewLinks: number;
      firstWithoutLaterEnd: string | null;
      firstDelayedEnd: string | null;
      firstReviewLinksEnd: string | null;
    };

/**
 * Summarize only the CURRENT, already organization-scoped continuity
 * warnings. This is a planning queue, not a billable-rate or service-
 * availability determination. A later start is NOT next-day coverage;
 * absent later dates mean unknown future duration, not zero days.
 * Names, raw IDs, saved prices and other organizations never enter it.
 */
export function summarizeContinuityActions(
  review: RateContinuityReview,
): ContinuityActionSummary {
  if (review.status !== "ready") return { status: "unavailable" };
  let withoutLaterRate = 0;
  let delayedReplacement = 0;
  let reviewLinks = 0;
  let firstWithoutLaterEnd: string | null = null;
  let firstDelayedEnd: string | null = null;
  let firstReviewLinksEnd: string | null = null;

  for (const issue of review.issues) {
    if (issue.status === "Review links") {
      reviewLinks += 1;
      if (firstReviewLinksEnd === null || issue.endDate < firstReviewLinksEnd)
        firstReviewLinksEnd = issue.endDate;
    } else if (issue.nextStart === null) {
      withoutLaterRate += 1;
      if (firstWithoutLaterEnd === null || issue.endDate < firstWithoutLaterEnd)
        firstWithoutLaterEnd = issue.endDate;
    } else {
      delayedReplacement += 1;
      if (firstDelayedEnd === null || issue.endDate < firstDelayedEnd)
        firstDelayedEnd = issue.endDate;
    }
  }

  return {
    status: "ready",
    withoutLaterRate, delayedReplacement, reviewLinks,
    firstWithoutLaterEnd, firstDelayedEnd, firstReviewLinksEnd,
  };
}
