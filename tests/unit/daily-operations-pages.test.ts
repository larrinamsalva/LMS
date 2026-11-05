import { expect, it } from "vitest";
import { dailyPage, DAILY_OPERATIONS_PAGE_SIZE } from "../../src/core/daily-operations-pages";

it("begins with four records without hiding or misstating the total", () => {
  expect(DAILY_OPERATIONS_PAGE_SIZE).toBe(4);
  expect(dailyPage(0, 4)).toEqual({
    visible: 0, remaining: 0, next: 0, canCollapse: false,
  });
  expect(dailyPage(3, 4)).toEqual({
    visible: 3, remaining: 0, next: 0, canCollapse: false,
  });
  expect(dailyPage(9, 4)).toEqual({
    visible: 4, remaining: 5, next: 4, canCollapse: false,
  });
});

it("reveals additional items in bounded increments with a clear collapse option", () => {
  expect(dailyPage(9, 8)).toEqual({
    visible: 8, remaining: 1, next: 1, canCollapse: true,
  });
  expect(dailyPage(9, 12)).toEqual({
    visible: 9, remaining: 0, next: 0, canCollapse: true,
  });
  expect(dailyPage(9, 4)).toEqual({
    visible: 4, remaining: 5, next: 4, canCollapse: false,
  });
});

it("clamps visible records when totals shrink, avoiding stale or inflated counts", () => {
  expect(dailyPage(2, 100)).toEqual({
    visible: 2, remaining: 0, next: 0, canCollapse: false,
  });
  expect(dailyPage(5, 100)).toEqual({
    visible: 5, remaining: 0, next: 0, canCollapse: true,
  });
});
