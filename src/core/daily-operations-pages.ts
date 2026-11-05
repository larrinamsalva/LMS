/** UI-only list sizing for the read-only Daily Operations overview. */
export const DAILY_OPERATIONS_PAGE_SIZE = 4;

export function dailyPage(total: number, requested: number) {
  const visible = Math.min(
    total,
    Math.max(DAILY_OPERATIONS_PAGE_SIZE, requested),
  );
  const remaining = Math.max(0, total - visible);
  return {
    visible,
    remaining,
    next: Math.min(DAILY_OPERATIONS_PAGE_SIZE, remaining),
    canCollapse: visible > DAILY_OPERATIONS_PAGE_SIZE,
  };
}
