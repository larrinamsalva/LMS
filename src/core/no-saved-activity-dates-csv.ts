import type { summarizeDailyOperations } from "./daily-operations";
import { csvSafeCell } from "./daily-operations-csv";
import { datesWithoutSavedActivity, sevenDayWorkload } from "./daily-operations-workload";

type Overview = ReturnType<typeof summarizeDailyOperations>;

// Every row is an observation of missing SAVED activity only, not a claim
// that any resource, staff member, space or appointment slot is available.
const planningNote = "NOT CONFIRMED AVAILABILITY - check schedules before planning";

/**
 * Export only the dates with no saved activity in the complete authorized
 * seven-day business-local snapshot. Recompute the dates from the overview:
 * never accept caller-provided dates, counts or filtered UI day cards.
 *
 * The CSV contains no customer names, IDs, notes, contacts or amounts.
 * Keep the explicit availability warning on every exported date.
 */
export function noSavedActivityDatesCsv(
  overview: Overview,
  zone: string,
  includeEquipment: boolean,
): string {
  const dates = datesWithoutSavedActivity(
    sevenDayWorkload(overview, zone),
    includeEquipment,
  );
  const rows = [
    [
      "Starting after", "Through (inclusive)", "Business-local date",
      "Saved activity", "Planning note", "Business time zone",
    ],
    ...dates.map((day) => [
      overview.date, overview.upcomingThrough, day.date,
      "None recorded", planningNote, zone,
    ]),
  ];
  return rows
    .map((row) => row.map(csvSafeCell).join(","))
    .join("\r\n") + "\r\n";
}
