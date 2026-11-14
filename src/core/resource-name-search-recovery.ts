import type { WorkspaceRecord } from "./engine";
import {
  filterWorkforceResourceDirectory,
  type WorkforceResourceEnrollmentFilter,
  type WorkforceResourceTypeFilter,
} from "./workforce-resource-directory";

/**
 * Count directory resources that would return if an unmatched name search
 * alone were cleared. Keep current/archived tab, type and enrollment.
 *
 * Only suggest this action when the search is nonblank and the current
 * selection has zero matches but clearing just its search would find
 * authorized resources. Never return names, search terms, IDs or records.
 */
export function resourceNameSearchRecoveryCount(
  resources: readonly WorkspaceRecord[],
  memberships: readonly WorkspaceRecord[],
  organizationId: string,
  showArchived: boolean,
  search: string,
  kind: WorkforceResourceTypeFilter,
  enrollment: WorkforceResourceEnrollmentFilter,
): number {
  if (!search.trim()) return 0;
  const scopedResources = resources.filter((record) =>
    record.organization_id === organizationId,
  );
  const scopedMemberships = memberships.filter((record) =>
    record.organization_id === organizationId,
  );
  if (filterWorkforceResourceDirectory(
    scopedResources, scopedMemberships, showArchived, search, kind, enrollment,
  ).length > 0) return 0;
  return filterWorkforceResourceDirectory(
    scopedResources, scopedMemberships, showArchived, "", kind, enrollment,
  ).length;
}

/**
 * Count authorized directory resources restored by clearing ONLY an active
 * employee enrollment filter. Preserve resource name search, type and
 * current/archived tab, and all roster membership review filters in the UI.
 *
 * A proposal is useful only when the current directory selection is empty
 * but the same selection with All enrollment contains records. Archived
 * retained memberships still count as enrolled; Equipment has no enrollment.
 * Never return names, search strings, record IDs or any private details.
 */
export function resourceEnrollmentRecoveryCount(
  resources: readonly WorkspaceRecord[],
  memberships: readonly WorkspaceRecord[],
  organizationId: string,
  showArchived: boolean,
  search: string,
  kind: WorkforceResourceTypeFilter,
  enrollment: WorkforceResourceEnrollmentFilter,
): number {
  if (enrollment === "all") return 0;
  const scopedResources = resources.filter((record) =>
    record.organization_id === organizationId,
  );
  const scopedMemberships = memberships.filter((record) =>
    record.organization_id === organizationId,
  );
  if (filterWorkforceResourceDirectory(
    scopedResources, scopedMemberships, showArchived, search, kind, enrollment,
  ).length !== 0) return 0;
  return filterWorkforceResourceDirectory(
    scopedResources, scopedMemberships, showArchived, search, kind, "all",
  ).length;
}
