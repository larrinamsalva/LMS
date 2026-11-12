import type { RateContinuityReviewItem } from "./service-rate-continuity";

export type ContinuityWarningFilter = "all" | "uncovered" | "review-links";
export type ContinuityWarningSort =
  | "soonest" | "latest" | "service" | "area" | "area-desc";

/**
 * Narrow an already organization-scoped continuity-review queue for
 * on-screen triage only. Sort a new array, never the input review.
 * Do not change the underlying review, totals,
 * linked-record classifications or the full downloadable checklist.
 * Never match raw IDs or pricing/customer data.
 */
export function filterContinuityWarnings(
  issues: readonly RateContinuityReviewItem[],
  status: ContinuityWarningFilter,
  text: string,
  sort: ContinuityWarningSort = "soonest",
): RateContinuityReviewItem[] {
  const query = text.trim().toLocaleLowerCase();
  const visible = issues.filter((issue) => {
    if (status === "uncovered" && issue.status !== "Uncovered") return false;
    if (status === "review-links" && issue.status !== "Review links") return false;
    if (!query) return true;
    return [
      issue.rateTitle, issue.serviceName, issue.areaName, issue.endDate,
    ].some((value) => value.toLocaleLowerCase().includes(query));
  });
  const compare = (a: RateContinuityReviewItem, b: RateContinuityReviewItem) =>
    sort === "latest"
      ? b.endDate.localeCompare(a.endDate)
      : sort === "service"
        ? a.serviceName.localeCompare(b.serviceName)
        : sort === "area"
          ? a.areaName.localeCompare(b.areaName)
          : sort === "area-desc"
            ? b.areaName.localeCompare(a.areaName)
            : a.endDate.localeCompare(b.endDate);
  return visible.sort((a, b) =>
    compare(a, b) ||
    a.endDate.localeCompare(b.endDate) ||
    a.serviceName.localeCompare(b.serviceName) ||
    a.areaName.localeCompare(b.areaName) ||
    a.rateTitle.localeCompare(b.rateTitle) ||
    a.rateId.localeCompare(b.rateId),
  );
}
