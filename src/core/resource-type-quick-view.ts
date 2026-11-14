import type {
  WorkforceResourceEnrollmentFilter,
  WorkforceResourceTypeFilter,
} from "./workforce-resource-directory";

export interface ResourceTypeQuickView {
  kind: WorkforceResourceTypeFilter;
  enrollment: WorkforceResourceEnrollmentFilter;
}

/**
 * A Resource Directory quick view changes only resource type and, when
 * choosing Equipment, clears employee enrollment (which cannot apply to
 * equipment). Worker/Crew/All choices preserve any enrollment selection.
 * Existing membership review, name search, sort and card-only filters
 * remain controlled by their own UI state.
 */
export function resourceTypeQuickView(
  kind: WorkforceResourceTypeFilter,
  enrollment: WorkforceResourceEnrollmentFilter,
): ResourceTypeQuickView {
  return {
    kind,
    enrollment: kind === "Equipment" ? "all" : enrollment,
  };
}
