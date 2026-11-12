import type { WorkspaceRecord } from "./engine";

export type WorkforceResourceTypeFilter = "all" | "Worker" | "Crew" | "Equipment";
export type WorkforceResourceEnrollmentFilter =
  "all" | "enrolled" | "resource-only";

/**
 * Presentation-only directory filter over records already scoped to the
 * current workspace. A Worker/Crew remains enrolled if ANY dated membership
 * exists, including archived memberships; removing the latest membership
 * must never display a misleading "resource-only" shortcut. Equipment has
 * no employee enrollment, so it appears only with enrollment filter "all".
 *
 * Matches only displayed resource names (not IDs, notes, or private data).
 * Never determines eligibility, employee availability or booking authority.
 */
export function filterWorkforceResourceDirectory(
  resources: readonly WorkspaceRecord[],
  memberships: readonly WorkspaceRecord[],
  showArchived: boolean,
  search: string,
  kind: WorkforceResourceTypeFilter = "all",
  enrollment: WorkforceResourceEnrollmentFilter = "all",
): WorkspaceRecord[] {
  const query = search.trim().toLocaleLowerCase();
  return resources.filter((resource) => {
    if (resource.entity !== "resources" || resource.archived !== showArchived) {
      return false;
    }
    const resourceKind = resource.data.kind;
    if (resourceKind !== "Worker" && resourceKind !== "Crew" &&
        resourceKind !== "Equipment") return false;
    if (kind !== "all" && resourceKind !== kind) return false;
    if (enrollment !== "all") {
      if (resourceKind === "Equipment") return false;
      const everEnrolled = memberships.some((membership) =>
        membership.entity === "resource-memberships" &&
        membership.organization_id === resource.organization_id &&
        membership.data.resource === resource.id,
      );
      if (enrollment === "enrolled" && !everEnrolled) return false;
      if (enrollment === "resource-only" && everEnrolled) return false;
    }
    if (!query) return true;
    return typeof resource.data.name === "string" &&
      resource.data.name.toLocaleLowerCase().includes(query);
  });
}
