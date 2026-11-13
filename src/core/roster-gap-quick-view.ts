import type {
  WorkforceResourceEnrollmentFilter,
  WorkforceResourceTypeFilter,
} from "./workforce-resource-directory";

export type RosterGapCategory = "enrolled" | "resource-only" | "equipment";

export interface RosterGapCategoryFilters {
  resourceKind: WorkforceResourceTypeFilter;
  enrollment: WorkforceResourceEnrollmentFilter;
}

/**
 * Translate an overview category into Resource Directory filters. Preserve a
 * caller-selected Worker/Crew kind for enrollment drill-downs, so clicking a
 * count cannot unexpectedly include a different resource kind. Equipment is
 * not subject to employee enrollment filters.
 *
 * Callers also enable the existing "without matching memberships" view.
 * This is presentation-only, not a staffing or booking decision.
 */
export function rosterGapCategoryFilters(
  category: RosterGapCategory,
  selectedKind: WorkforceResourceTypeFilter,
): RosterGapCategoryFilters {
  if (category === "equipment") {
    return { resourceKind: "Equipment", enrollment: "all" };
  }
  return {
    resourceKind: selectedKind === "Equipment" ? "all" : selectedKind,
    enrollment: category,
  };
}
