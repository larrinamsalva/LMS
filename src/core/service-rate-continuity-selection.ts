import type {
  RateContinuityReview,
  RateContinuityReviewItem,
} from "./service-rate-continuity";

/**
 * Select only issues actually present in the CURRENT organization-scoped,
 * validated review. Arbitrary/stale/foreign IDs never become export rows.
 * Keep source order, de-duplicate selections and never mutate the review.
 */
export function selectedContinuityReviewIssues(
  review: RateContinuityReview,
  rateIds: readonly string[],
): RateContinuityReviewItem[] {
  if (review.status !== "ready" || rateIds.length === 0) return [];
  const chosen = new Set(rateIds);
  return review.issues.filter((issue) => chosen.has(issue.rateId));
}

export type VisibleContinuitySelectionAction = "select-visible" | "deselect-visible";

/**
 * Bulk-select or deselect just the warnings currently displayed, without
 * changing authorized selections hidden by type/search filters. Revalidate
 * both sets against the CURRENT scoped review, never trust arbitrary IDs,
 * and return a stable, duplicate-free list in original review order.
 * No rate, estimate, invoice or customer record is changed.
 */
export function updateVisibleContinuitySelection(
  review: RateContinuityReview,
  selectedRateIds: readonly string[],
  visibleRateIds: readonly string[],
  action: VisibleContinuitySelectionAction,
): string[] {
  if (review.status !== "ready") return [];

  const authorized = new Set(review.issues.map((issue) => issue.rateId));
  const selected = new Set(selectedRateIds.filter((id) => authorized.has(id)));
  const visible = new Set(visibleRateIds.filter((id) => authorized.has(id)));

  if (action === "select-visible") {
    for (const id of visible) selected.add(id);
  } else {
    for (const id of visible) selected.delete(id);
  }

  return review.issues
    .filter((issue) => selected.has(issue.rateId))
    .map((issue) => issue.rateId);
}
