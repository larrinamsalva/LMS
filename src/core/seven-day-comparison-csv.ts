import type { summarizeDailyOperations } from "./daily-operations";
import { compareSevenDayWorkloadTotals, sevenDayWorkload, summarizeSevenDayWorkload } from "./daily-operations-workload";
import { csvSafeCell } from "./daily-operations-csv";
import { shiftDate } from "./time";

type Overview = ReturnType<typeof summarizeDailyOperations>;
export type ComparisonDirection = "previous" | "following";

/**
 * Local, organization-scoped aggregate export of two adjacent business-local
 * seven-date windows. Inputs must be authorized snapshots of the same
 * workspace, provided by the caller. No names, record IDs or amounts.
 */
export function sevenDayComparisonCsv(
  current: Overview,
  compared: Overview,
  zone: string,
  includeEquipment: boolean,
  direction: ComparisonDirection,
): string {
  const expectedComparedDate = shiftDate(
    current.date, direction === "previous" ? -7 : 7,
  );
  if (compared.date !== expectedComparedDate) {
    throw new Error("Comparison requires an adjacent seven-day window");
  }

  const currentDays = sevenDayWorkload(current, zone);
  const comparedDays = sevenDayWorkload(compared, zone);
  if (currentDays.length !== 7 || comparedDays.length !== 7) {
    throw new Error("Comparison requires two full seven-day windows");
  }
  const currentTotals = summarizeSevenDayWorkload(currentDays, includeEquipment);
  const comparedTotals = summarizeSevenDayWorkload(comparedDays, includeEquipment);
  const change = direction === "previous"
    ? compareSevenDayWorkloadTotals(comparedTotals, currentTotals)
    : compareSevenDayWorkloadTotals(currentTotals, comparedTotals);
  const windowLabel = (days: typeof currentDays) =>
    days[0].date + " through " + days[days.length - 1].date;

  const header = [
    "Saved activity", "Current seven dates", "Compared seven dates",
    "Comparison direction", "Current count", "Compared count",
    direction === "previous" ? "Change to current" : "Change to following",
    "Business time zone",
  ];
  const rows: string[][] = [
    ["Appointment starts", String(currentTotals.appointments),
      String(comparedTotals.appointments), String(change.appointments)],
    ["Unfinished work due", String(currentTotals.unfinishedWork),
      String(comparedTotals.unfinishedWork), String(change.unfinishedWork)],
    ...(includeEquipment ? [[
      "Equipment inspections", String(currentTotals.inspections),
      String(comparedTotals.inspections), String(change.inspections),
    ]] : []),
    ["Days with saved activity", String(currentTotals.daysWithActivity),
      String(comparedTotals.daysWithActivity), String(change.daysWithActivity)],
  ].map(([metric, currentCount, comparedCount, signedChange]) => [
    metric, windowLabel(currentDays), windowLabel(comparedDays),
    direction, currentCount, comparedCount, signedChange, zone,
  ]);

  return [header, ...rows]
    .map((row) => row.map(csvSafeCell).join(","))
    .join("\r\n") + "\r\n";
}
