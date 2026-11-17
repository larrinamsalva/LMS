import { expect, it } from "vitest";
import { summarizeDailyOperations } from "../../src/core/daily-operations";
import {
  recordedActivityBars,
  focusedRecordedItemCount,
  sevenDayWorkload,
  type DailyWorkload,
} from "../../src/core/daily-operations-workload";
import type { WorkspaceRecord } from "../../src/core/engine";
import type { EquipmentState } from "../../src/core/equipment";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function record(
  entity: string, id: string, data: WorkspaceRecord["data"],
  organization_id = ORG, archived = false,
): WorkspaceRecord {
  return {
    entity, id, data, organization_id, archived,
    revision: 1, config_revision: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function state(
  record_id: string, next_inspection: string,
  organization_id = ORG,
): EquipmentState {
  return {
    record_id, organization_id, revision: 1,
    asset_key: record_id, barcode_key: null,
    condition: "Serviceable", maintenance: "Clear",
    work_id: null, technician_id: null,
    last_service: null, next_inspection,
  };
}

// Independent oracle via existing focused day-count logic and a sorted
// copy; use only counts, never booking slots or staff/resource capacity.
function originalCountBars(days: readonly DailyWorkload[], includeInspections: boolean) {
  const rows = days.map((day) => ({
    date: day.date,
    savedItems: focusedRecordedItemCount(day, includeInspections, "all"),
  }));
  const max = [...rows].sort((a, b) => b.savedItems - a.savedItems)[0]?.savedItems ?? 0;
  return rows.map((row) => ({
    ...row,
    relativePercent: max > 0 && row.savedItems > 0
      ? Math.max(1, Math.round(100 * row.savedItems / max)) : 0,
  }));
}

it("shows the exact seven saved counts and relative bars, not assumed utilization", () => {
  const days: DailyWorkload[] = [
    { date: "2026-11-06", appointments: 1, unfinishedWork: 2, inspections: 1 },
    { date: "2026-11-07", appointments: 0, unfinishedWork: 0, inspections: 2 },
    { date: "2026-11-08", appointments: 0, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-09", appointments: 0, unfinishedWork: 3, inspections: 0 },
    { date: "2026-11-10", appointments: 10, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-11", appointments: 0, unfinishedWork: 1, inspections: 0 },
    { date: "2026-11-12", appointments: 0, unfinishedWork: 0, inspections: 0 },
  ];
  const before = structuredClone(days);
  expect(recordedActivityBars(days, true)).toEqual([
    { date: "2026-11-06", savedItems: 4, relativePercent: 40 },
    { date: "2026-11-07", savedItems: 2, relativePercent: 20 },
    { date: "2026-11-08", savedItems: 0, relativePercent: 0 },
    { date: "2026-11-09", savedItems: 3, relativePercent: 30 },
    { date: "2026-11-10", savedItems: 10, relativePercent: 100 },
    { date: "2026-11-11", savedItems: 1, relativePercent: 10 },
    { date: "2026-11-12", savedItems: 0, relativePercent: 0 },
  ]);
  expect(recordedActivityBars(days, false)).toEqual([
    { date: "2026-11-06", savedItems: 3, relativePercent: 30 },
    { date: "2026-11-07", savedItems: 0, relativePercent: 0 },
    { date: "2026-11-08", savedItems: 0, relativePercent: 0 },
    { date: "2026-11-09", savedItems: 3, relativePercent: 30 },
    { date: "2026-11-10", savedItems: 10, relativePercent: 100 },
    { date: "2026-11-11", savedItems: 1, relativePercent: 10 },
    { date: "2026-11-12", savedItems: 0, relativePercent: 0 },
  ]);
  expect(days).toEqual(before);
});

it("remains exact on 720 reordered fictional day cards, including ties and tiny positives", () => {
  const days: DailyWorkload[] = Array.from({ length: 720 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
    appointments: i % 19 === 0 ? i + 1 : 0,
    unfinishedWork: i % 13 === 0 ? 2 : 0,
    inspections: i % 11 === 0 ? 1 : 0,
  }));
  const repeated = {
    date: "2026-11-06", appointments: 0, unfinishedWork: 1, inspections: 0,
  };
  days.push(repeated, repeated);
  const original = structuredClone(days);
  for (const input of [days, [...days].reverse(), days.slice(-7), []]) {
    const frozen = Object.freeze([...input]);
    for (const enabled of [true, false]) {
      const expected = originalCountBars(frozen, enabled);
      const actual = recordedActivityBars(frozen, enabled);
      expect(actual).toEqual(expected);
      expect(actual.map((bar) => bar.date)).toEqual(frozen.map((day) => day.date));
      expect(actual.every((bar) => bar.relativePercent >= 0 &&
        bar.relativePercent <= 100)).toBe(true);
      expect(actual.filter((bar) => bar.savedItems === 0)
        .every((bar) => bar.relativePercent === 0)).toBe(true);
      expect(actual.filter((bar) => bar.savedItems > 0)
        .every((bar) => bar.relativePercent >= 1)).toBe(true);
    }
    expect(frozen).toEqual(input);
  }
  expect(days).toEqual(original);
});

it("keeps empty weeks at zero and never fabricates a bar from disabled inspections", () => {
  const empty = Array.from({ length: 7 }, (_, i) => ({
    date: ["2026-11-06", "2026-11-07", "2026-11-08",
      "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"][i],
    appointments: 0, unfinishedWork: 0, inspections: 0,
  }));
  expect(recordedActivityBars(empty, true)).toEqual(empty.map((d) => ({
    date: d.date, savedItems: 0, relativePercent: 0,
  })));
  expect(recordedActivityBars([], true)).toEqual([]);
  const inspectionOnly: DailyWorkload[] = [{
    date: "2026-11-06", appointments: 0, unfinishedWork: 0, inspections: 1000,
  }, {
    date: "2026-11-07", appointments: 1, unfinishedWork: 0, inspections: 0,
  }];
  expect(recordedActivityBars(inspectionOnly, true)[1].relativePercent).toBe(1);
  expect(recordedActivityBars(inspectionOnly, false)).toEqual([
    { date: "2026-11-06", savedItems: 0, relativePercent: 0 },
    { date: "2026-11-07", savedItems: 1, relativePercent: 100 },
  ]);
});

it("uses only the authorized business-local seven-day summary over DST and leap dates", () => {
  const records: WorkspaceRecord[] = [
    record("appointments", "visit", {
      title: "Fictional DST booking", status: "Scheduled",
      start: "2026-11-01T09:30:00Z", end: "2026-11-01T10:30:00Z",
    }),
    record("tasks", "task", { title: "Fictional due work", status: "Open", due: "2026-11-02" }),
    record("tasks", "foreign", { title: "PRIVATE FOREIGN TASK", status: "Open", due: "2026-11-01" }, FOREIGN),
    record("jobs", "archived", { title: "PRIVATE ARCHIVED JOB", status: "Planned", date: "2026-11-01" }, ORG, true),
    record("equipment", "asset", { name: "Fictional vacuum" }),
    record("tasks", "leap", { title: "Fictional leap work", status: "Open", due: "2028-02-29" }),
  ];
  const states = [state("asset", "2026-11-01")];
  const original = structuredClone({ records, states });
  const overview = summarizeDailyOperations({
    organizationId: ORG, records, equipmentStates: states,
  }, "America/Los_Angeles", "2026-10-31");
  const days = sevenDayWorkload(overview, "America/Los_Angeles");
  const bars = recordedActivityBars(days, true);
  expect(bars).toHaveLength(7);
  expect(bars[0]).toEqual({ date: "2026-11-01", savedItems: 2, relativePercent: 100 });
  expect(bars[1]).toEqual({ date: "2026-11-02", savedItems: 1, relativePercent: 50 });
  expect(recordedActivityBars(days, false)[0]).toEqual({
    date: "2026-11-01", savedItems: 1, relativePercent: 100,
  });
  const leap = summarizeDailyOperations({
    organizationId: ORG, records, equipmentStates: states,
  }, "America/Los_Angeles", "2028-02-26");
  const leapBars = recordedActivityBars(
    sevenDayWorkload(leap, "America/Los_Angeles"), false,
  );
  expect(leapBars[2]).toEqual({ date: "2028-02-29", savedItems: 1, relativePercent: 100 });
  expect({ records, states }).toEqual(original);
});

it("compares each chart-only category against independent exact 720-day counts", () => {
  const days: DailyWorkload[] = Array.from({ length: 720 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
    appointments: i % 7 === 0 ? i + 1 : 0,
    unfinishedWork: i % 11 === 0 ? i + 2 : 0,
    inspections: i % 13 === 0 ? i + 3 : 0,
  }));
  const before = structuredClone(days);
  const reversed = [...days].reverse();
  for (const input of [days, reversed, [], days.slice(0, 7)]) {
    for (const enabled of [true, false]) {
      for (const category of ["all", "appointments", "work", "inspections"] as const) {
        const selectedCounts = input.map((day) => {
          if (category === "appointments") return day.appointments;
          if (category === "work") return day.unfinishedWork;
          if (category === "inspections") return enabled ? day.inspections : 0;
          return day.appointments + day.unfinishedWork +
            (enabled ? day.inspections : 0);
        });
        const largest = Math.max(0, ...selectedCounts);
        const bars = recordedActivityBars(input, enabled, category);
        expect(bars).toEqual(input.map((day, index) => ({
          date: day.date,
          savedItems: selectedCounts[index],
          relativePercent: largest > 0 && selectedCounts[index] > 0
            ? Math.max(1, Math.round(100 * selectedCounts[index] / largest)) : 0,
        })));
        expect(bars).toHaveLength(input.length);
      }
    }
  }
  expect(recordedActivityBars(days, true)).toEqual(
    recordedActivityBars(days, true, "all"),
  );
  expect(days).toEqual(before);
});

it("keeps all seven dates and zero height when a selected category has no records", () => {
  const days: DailyWorkload[] = [
    { date: "2026-11-06", appointments: 4, unfinishedWork: 0, inspections: 2 },
    { date: "2026-11-07", appointments: 0, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-08", appointments: 1, unfinishedWork: 0, inspections: 3 },
    { date: "2026-11-09", appointments: 0, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-10", appointments: 0, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-11", appointments: 0, unfinishedWork: 0, inspections: 0 },
    { date: "2026-11-12", appointments: 0, unfinishedWork: 0, inspections: 0 },
  ];
  expect(recordedActivityBars(days, true, "work")).toEqual(
    days.map((day) => ({ date: day.date, savedItems: 0, relativePercent: 0 })),
  );
  expect(recordedActivityBars(days, false, "inspections")).toEqual(
    days.map((day) => ({ date: day.date, savedItems: 0, relativePercent: 0 })),
  );
  expect(recordedActivityBars(days, true, "inspections")[2]).toEqual({
    date: "2026-11-08", savedItems: 3, relativePercent: 100,
  });
});
