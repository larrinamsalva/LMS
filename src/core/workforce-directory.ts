import type { WorkspaceRecord } from "./engine";

export type EmployeeDirectoryStatus = "all" | "active" | "inactive";

/**
 * Presentation-only filters over employee records already authorized for
 * the current workspace. No fetching, contact-field search, writes or
 * permissions are conferred; always preserve the caller's original order.
 */
export function filterEmployeeDirectory(
  records: readonly WorkspaceRecord[],
  showArchived: boolean,
  search: string,
  status: EmployeeDirectoryStatus = "all",
): WorkspaceRecord[] {
  const query = search.trim().toLocaleLowerCase();
  return records.filter((record) => {
    if (record.entity !== "employees" || record.archived !== showArchived) {
      return false;
    }
    if (status === "active" && record.data.status !== "Active") return false;
    if (status === "inactive" && record.data.status !== "Inactive") return false;
    if (!query) return true;
    return [record.data.name, record.data.role, record.data.skills]
      .some((value) =>
        typeof value === "string" &&
        value.toLocaleLowerCase().includes(query),
      );
  });
}
