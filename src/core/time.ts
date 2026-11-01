import { Temporal } from "@js-temporal/polyfill";
export class TimeError extends Error {}
export const appointmentStatuses = [
  "Scheduled",
  "In progress",
  "Completed",
  "Cancelled",
] as const;
export function isTimeZone(value: string) {
  try {
    return (
      (value === "UTC" || value.includes("/")) &&
      !/^[+-]/.test(value) &&
      !!new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions()
        .timeZone
    );
  } catch {
    return false;
  }
}
export function instant(value: string) {
  try {
    return Temporal.Instant.from(value);
  } catch {
    throw new TimeError("Use a valid time with an explicit UTC offset.");
  }
}
export function normalizeInstant(value: string) {
  return instant(value).toString();
}
export function localTime(value: string, zone: string) {
  return instant(value)
    .toZonedDateTimeISO(zone)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });
}
export function localDate(value: string, zone: string) {
  return instant(value).toZonedDateTimeISO(zone).toPlainDate().toString();
}
export function wallToInstant(
  value: string,
  zone: string,
  choice: "reject" | "earlier" | "later" = "reject",
) {
  if (!isTimeZone(zone)) throw new TimeError("Choose a valid IANA time zone.");
  let wall: Temporal.PlainDateTime;
  try {
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) throw 0;
    wall = Temporal.PlainDateTime.from(value, { overflow: "reject" });
    if (wall.year < 2020 || wall.year > 2100) throw 0;
  } catch {
    throw new TimeError("Use a valid local date/time between 2020 and 2100.");
  }
  const fields = {
    timeZone: zone,
    year: wall.year,
    month: wall.month,
    day: wall.day,
    hour: wall.hour,
    minute: wall.minute,
  };
  const early = Temporal.ZonedDateTime.from(fields, {
      disambiguation: "earlier",
    }),
    late = Temporal.ZonedDateTime.from(fields, { disambiguation: "later" });
  if (
    !early.toPlainDateTime().equals(wall) ||
    !late.toPlainDateTime().equals(wall)
  )
    throw new TimeError(
      "This local time does not exist because the clock moves forward. Choose another time.",
    );
  if (early.epochNanoseconds !== late.epochNanoseconds && choice === "reject")
    throw new TimeError(
      "This local time repeats. Choose its first or second occurrence explicitly.",
    );
  return (choice === "later" ? late : early).toInstant().toString();
}
export function validateAppointment(data: Record<string, unknown>) {
  const zone = String(data.time_zone),
    start = instant(String(data.start)),
    end = instant(String(data.end));
  if (!isTimeZone(zone))
    throw new TimeError("Choose a valid IANA booking time zone.");
  const duration = end.epochNanoseconds - start.epochNanoseconds;
  if (duration <= 0n || duration > 86400_000_000_000n)
    throw new TimeError("End must follow start, within 24 hours.");
  if (
    start.epochNanoseconds % 60_000_000_000n ||
    end.epochNanoseconds % 60_000_000_000n
  )
    throw new TimeError("Appointments use whole-minute precision.");
  const date = localDate(String(data.start), zone);
  if (
    date !== data.scheduled_date ||
    date < "2020-01-01" ||
    date > "2100-12-31"
  )
    throw new TimeError(
      "Scheduled date must match the start in its booking time zone (2020–2100).",
    );
  if (
    !appointmentStatuses.includes(
      data.status as (typeof appointmentStatuses)[number],
    )
  )
    throw new TimeError("Choose an allowed appointment status.");
}
export function displayTime(value: string, zone: string) {
  try {
    return instant(value)
      .toZonedDateTimeISO(zone)
      .toString({ smallestUnit: "minute", timeZoneName: "never" })
      .replace("T", " ");
  } catch {
    return value;
  }
}
export function shiftDate(value: string, days: number) {
  return Temporal.PlainDate.from(value).add({ days }).toString();
}
