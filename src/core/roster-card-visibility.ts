import type { WorkspaceRecord } from "./engine";

/** UI-only key: different organizations never share a card's collapse state. */
export function rosterCardCollapseKey(
  organizationId: string,
  resourceId: string,
): string {
  return organizationId + ":" + resourceId;
}

/**
 * Apply bulk collapse/expand to only the resource cards currently shown in
 * this organization. Cards hidden by a directory filter, or belonging to
 * another organization, keep their previous view state. No records change.
 */
export function setShownRosterCardsCollapsed(
  previous: readonly string[],
  shownResources: readonly WorkspaceRecord[],
  organizationId: string,
  collapsed: boolean,
): string[] {
  const keys = new Set(
    shownResources
      .filter((resource) =>
        resource.entity === "resources" &&
        resource.organization_id === organizationId)
      .map((resource) => rosterCardCollapseKey(organizationId, resource.id)),
  );
  if (collapsed) return [...new Set([...previous, ...keys])];
  return previous.filter((key) => !keys.has(key));
}
