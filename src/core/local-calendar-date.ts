/**
 * Return the device's LOCAL calendar date for an explicit user action.
 * Never derive a billing/quote/service-area date implicitly and do not
 * use toISOString(), which would instead use UTC and could select
 * yesterday or tomorrow near local midnight.
 */
export function localCalendarDate(now: Date): string | null {
  if (!Number.isFinite(now.getTime())) return null;
  const year = now.getFullYear();
  if (year < 1 || year > 9999) return null;
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return String(year).padStart(4, "0") + "-" + month + "-" + day;
}
