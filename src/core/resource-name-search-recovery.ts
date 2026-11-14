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

/**
 * Count authorized resource records restored by clearing only a restrictive
 * Worker/Crew/Equipment type filter. Preserve resource-name search,
 * employee enrollment, current/archived resource tab and all roster review
 * filters. Equipment remains excluded under enrollment-only views.
 *
 * Return zero unless the current directory selection is empty and switching
 * just the resource kind to "all" would restore matching records. Revalidate
 * organization scope, including retained foreign memberships with shared IDs.
 * No record identities or private search terms are returned.
 */
export function resourceTypeRecoveryCount(
  resources: readonly WorkspaceRecord[],
  memberships: readonly WorkspaceRecord[],
  organizationId: string,
  showArchived: boolean,
  search: string,
  kind: WorkforceResourceTypeFilter,
  enrollment: WorkforceResourceEnrollmentFilter,
): number {
  if (kind === "all") return 0;
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
    scopedResources, scopedMemberships, showArchived, search, "all", enrollment,
  ).length;
}

/**
 * Last-resort directory recovery when a *combination* of active name/type/
 * enrollment filters hides every resource and none of the single-filter
 * recovery shortcuts can help. Keep the current/archived resource tab and
 * all roster history filters when the operator deliberately chooses it.
 *
 * Return only the number of in-scope records restored by clearing the three
 * directory filters together. Never expose names or internal identifiers.
 */
export function combinedResourceDirectoryRecoveryCount(
  resources: readonly WorkspaceRecord[],
  memberships: readonly WorkspaceRecord[],
  organizationId: string,
  showArchived: boolean,
  search: string,
  kind: WorkforceResourceTypeFilter,
  enrollment: WorkforceResourceEnrollmentFilter,
): number {
  const activeCount = Number(search.trim().length > 0) +
    Number(kind !== "all") + Number(enrollment !== "all");
  if (activeCount < 2) return 0;
  const scopedResources = resources.filter((resource) =>
    resource.organization_id === organizationId,
  );
  const scopedMemberships = memberships.filter((membership) =>
    membership.organization_id === organizationId,
  );
  if (filterWorkforceResourceDirectory(
    scopedResources, scopedMemberships, showArchived, search, kind, enrollment,
  ).length > 0) return 0;
  // Prefer the smaller, context-preserving recovery when it suffices.
  if (resourceNameSearchRecoveryCount(
    scopedResources, scopedMemberships, organizationId, showArchived,
    search, kind, enrollment,
  ) > 0 || resourceEnrollmentRecoveryCount(
    scopedResources, scopedMemberships, organizationId, showArchived,
    search, kind, enrollment,
  ) > 0 || resourceTypeRecoveryCount(
    scopedResources, scopedMemberships, organizationId, showArchived,
    search, kind, enrollment,
  ) > 0) return 0;
  return filterWorkforceResourceDirectory(
    scopedResources, scopedMemberships, showArchived, "", "all", "all",
  ).length;
}
