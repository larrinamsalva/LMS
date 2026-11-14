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
