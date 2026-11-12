import type { RateContinuityReviewItem } from "./service-rate-continuity";

export type ContinuityWarningFilter = "all" | "uncovered" | "review-links";

/**
 * Narrow an already organization-scoped continuity-review queue for
 * on-screen triage only. Do not change the underlying review, totals,
 * linked-record classifications or the full downloadable checklist.
 * Never match raw IDs or pricing/customer data.
 */
export function filterContinuityWarnings(
  issues: readonly RateContinuityReviewItem[],
  status: ContinuityWarningFilter,
  text: string,
): RateContinuityReviewItem[] {
  const query = text.trim().toLocaleLowerCase();
  return issues.filter((issue) => {
    if (status === "uncovered" && issue.status !== "Uncovered") return false;
    if (status === "review-links" && issue.status !== "Review links") return false;
    if (!query) return true;
    return [
      issue.rateTitle, issue.serviceName, issue.areaName, issue.endDate,
    ].some((value) => value.toLocaleLowerCase().includes(query));
  });
}
