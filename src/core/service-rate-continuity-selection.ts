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
