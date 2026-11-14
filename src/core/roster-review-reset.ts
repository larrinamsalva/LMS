import type {
  ResourceMembershipReviewMode,
  ResourceMembershipRecordStatus,
  ResourceMembershipStartSort,
} from "./resource-membership-review";

/**
 * Whether the membership-specific review needs a focused reset.
 * The review date is meaningful only when its mode is overlapping-day.
 * Resource name/type/enrollment, resource-card selection and card sorting
 * are deliberately not considered membership-review filters.
 */
export function membershipReviewFiltersActive(
  mode: ResourceMembershipReviewMode,
  status: ResourceMembershipRecordStatus,
  sort: ResourceMembershipStartSort,
  search: string,
): boolean {
  return mode !== "all" || status !== "all" ||
    sort !== "retained" || search.trim().length > 0;
}
