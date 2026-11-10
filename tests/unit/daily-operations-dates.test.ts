import { expect, it } from "vitest";
import {
  adjacentOperationsDate,
  weeklyOperationsDate,
  operationsToday,
  OPERATIONS_DATE_MIN,
  OPERATIONS_DATE_MAX,
} from "../../src/core/daily-operations-dates";

it("moves by business-calendar days through leap days and DST boundaries", () => {
  expect(adjacentOperationsDate("2028-02-28", 1)).toBe("2028-02-29");
  expect(adjacentOperationsDate("2028-03-01", -1)).toBe("2028-02-29");
  expect(adjacentOperationsDate("2026-03-08", 1)).toBe("2026-03-09");
  expect(adjacentOperationsDate("2026-11-01", -1)).toBe("2026-10-31");
  expect(adjacentOperationsDate("2026-12-31", 1)).toBe("2027-01-01");
});

it("refuses invalid dates and stops at existing date picker bounds", () => {
  expect(adjacentOperationsDate(OPERATIONS_DATE_MIN, -1)).toBeNull();
  expect(adjacentOperationsDate(OPERATIONS_DATE_MAX, 1)).toBeNull();
  expect(adjacentOperationsDate("2026-02-30", 1)).toBeNull();
  expect(adjacentOperationsDate("", -1)).toBeNull();
  expect(adjacentOperationsDate("2026-11-05T00:00", 1)).toBeNull();
});

it("returns today for the business, not the browser or UTC calendar day", () => {
  const now = "2026-11-06T02:30:00Z";
  expect(operationsToday("America/Los_Angeles", now)).toBe("2026-11-05");
  expect(operationsToday("Asia/Tokyo", now)).toBe("2026-11-06");
});


it("shifts seven-date planning windows by calendar weeks across DST and leap days", () => {
  expect(weeklyOperationsDate("2026-11-06", 1)).toBe("2026-11-13");
  expect(weeklyOperationsDate("2026-11-13", -1)).toBe("2026-11-06");
  expect(weeklyOperationsDate("2026-10-30", 1)).toBe("2026-11-06");
  expect(weeklyOperationsDate("2026-03-06", 1)).toBe("2026-03-13");
  expect(weeklyOperationsDate("2028-02-24", 1)).toBe("2028-03-02");
  expect(weeklyOperationsDate("2028-03-02", -1)).toBe("2028-02-24");
  expect(weeklyOperationsDate("2026-12-29", 1)).toBe("2027-01-05");
});

it("disables seven-day window jumps outside the date-picker bounds", () => {
  expect(weeklyOperationsDate(OPERATIONS_DATE_MIN, -1)).toBeNull();
  expect(weeklyOperationsDate(OPERATIONS_DATE_MAX, 1)).toBeNull();
  expect(weeklyOperationsDate("2020-01-06", -1)).toBeNull();
  expect(weeklyOperationsDate("2100-12-26", 1)).toBeNull();
  expect(weeklyOperationsDate("2028-02-30", 1)).toBeNull();
  expect(weeklyOperationsDate("", -1)).toBeNull();
  expect(adjacentOperationsDate("2026-11-06", 1)).toBe("2026-11-07");
});
