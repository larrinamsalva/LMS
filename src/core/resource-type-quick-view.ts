import type { WorkspaceRecord } from "./engine";
import {
  filterWorkforceResourceDirectory,
  type WorkforceResourceEnrollmentFilter,
  type WorkforceResourceTypeFilter,
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


export interface ResourceTypePreviewCounts {
  crews: number;
  workers: number;
  equipment: number;
  all: number;
}

/**
 * Predict the directory resources a quick-view click will display, before
 * selecting the type. Apply the exact same resource name, archived and
 * enrollment rules as that action, independently of the currently selected
 * type or membership card-only visibility.
 *
 * Equipment explicitly resets enrollment to All (as its button does).
 * Exclude foreign-resource and foreign-membership records, even if their IDs
 * collide with local records. No record is changed.
 */
export function previewResourceTypeQuickViews(
  resources: readonly WorkspaceRecord[],
  memberships: readonly WorkspaceRecord[],
  organizationId: string,
  showArchived: boolean,
  search: string,
  enrollment: WorkforceResourceEnrollmentFilter,
): ResourceTypePreviewCounts {
  const scopedResources = resources.filter((record) =>
    record.organization_id === organizationId,
  );
  const scopedMemberships = memberships.filter((record) =>
    record.organization_id === organizationId,
  );
  const count = (kind: WorkforceResourceTypeFilter) => {
    const filters = resourceTypeQuickView(kind, enrollment);
    return filterWorkforceResourceDirectory(
      scopedResources, scopedMemberships, showArchived, search,
      filters.kind, filters.enrollment,
    ).length;
  };
  return {
    crews: count("Crew"),
    workers: count("Worker"),
    equipment: count("Equipment"),
    all: count("all"),
  };
}
