import type { summarizeDailyOperations } from "./daily-operations";
import { csvSafeCell } from "./daily-operations-csv";

type DailyOverview = ReturnType<typeof summarizeDailyOperations>;

/**
 * Export only the exact records the authorized workspace already identified
 * as unfinished and missing a due date. The selected date is a review date,
 * NEVER an assigned due date. No notes, contacts, clients, or financial data.
 */
export function needsSchedulingCsv(overview: DailyOverview, zone: string): string {
  const rows: string[][] = [[
    "Reviewed on (not due date)", "Type", "Title", "Status",
    "Due date (not assigned)", "Business time zone",
  ]];
  for (const item of overview.needsScheduling) {
    rows.push([
      overview.date,
      item.entity === "jobs" ? "Cleaning job" : "Task",
      String(item.data.title),
      String(item.data.status),
      "", // Explicitly blank: never infer, invent or persist a deadline.
      zone,
    ]);
  }
  return rows.map((row) => row.map(csvSafeCell).join(",")).join("\r\n") + "\r\n";
}
