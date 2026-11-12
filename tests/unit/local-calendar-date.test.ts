import { expect, it } from "vitest";
import { localCalendarDate } from "../../src/core/local-calendar-date";

it("returns the local calendar day rather than UTC for explicit reviews", () => {
  expect(localCalendarDate(new Date(2026, 10, 11, 0, 1))).toBe("2026-11-11");
  expect(localCalendarDate(new Date(2026, 10, 11, 23, 59))).toBe("2026-11-11");
  expect(localCalendarDate(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
});

it("handles leap day and the next calendar day without mutating the clock", () => {
  const leap = new Date(2028, 1, 29, 23, 59, 59);
  const before = leap.getTime();
  expect(localCalendarDate(leap)).toBe("2028-02-29");
  expect(localCalendarDate(new Date(2028, 2, 1, 0, 0))).toBe("2028-03-01");
  expect(leap.getTime()).toBe(before);
});

it("rejects invalid and unsupported dates", () => {
  expect(localCalendarDate(new Date(Number.NaN))).toBeNull();
  expect(localCalendarDate(new Date(0, 0, 1))).toBe("1900-01-01");
  const outOfRange = new Date(10000, 0, 1);
  expect(localCalendarDate(outOfRange)).toBeNull();
});
