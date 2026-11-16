import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import {
  summarizeDailyOperations,
  type DueWork,
} from "../../src/core/daily-operations";
import { dailyOperationsCsv } from "../../src/core/daily-operations-csv";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function record(
  id: string,
  entity: string,
  data: WorkspaceRecord["data"],
  organization_id = ORG,
  archived = false,
): WorkspaceRecord {
  return {
    id, entity, data, organization_id, archived,
    revision: 1, config_revision: 1,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };
}

// Independent reference from verified merged five-green LMS #179.
// Intentionally sorts the eligible work first and filters the same sorted
// rows THREE separate times, exactly as the original Daily Operations code.
function previousWorkSections(
  records: readonly WorkspaceRecord[], org: string, date: string,
  upcomingThrough: string,
): {
  dueToday: DueWork[];
  overdue: DueWork[];
  upcoming: DueWork[];
  needsScheduling: WorkspaceRecord[];
} {
  const authorized = records.filter(
    (r) => r.organization_id === org && !r.archived,
  );
  const activeWork = authorized.filter(
    (r) => (r.entity === "tasks" || r.entity === "jobs") &&
      !["Done", "Completed", "Cancelled"].includes(String(r.data.status)),
  );
  const needsScheduling = activeWork.filter((item) => {
    const value = item.entity === "jobs" ? item.data.date : item.data.due;
    return value === null || value === undefined ||
      (typeof value === "string" && value.trim() === "");
  }).sort((a, b) =>
    String(a.data.title).localeCompare(String(b.data.title)) ||
    a.id.localeCompare(b.id),
  );
  const unfinished = activeWork.flatMap((item): DueWork[] => {
    const value = item.entity === "jobs" ? item.data.date : item.data.due;
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? [{ record: item, due: value }] : [];
  }).sort((a, b) =>
    a.due.localeCompare(b.due) ||
    String(a.record.data.title).localeCompare(String(b.record.data.title)),
  );
  return {
    dueToday: unfinished.filter((item) => item.due === date),
    overdue: unfinished.filter((item) => item.due < date),
    needsScheduling,
    upcoming: unfinished.filter(
      (item) => item.due > date && item.due <= upcomingThrough,
    ),
  };
}

function assertSameWorkRows(actual: readonly DueWork[], old: readonly DueWork[]) {
  expect(actual).toHaveLength(old.length);
  expect(actual).toEqual(old);
  actual.forEach((row, i) => expect(row.record).toBe(old[i].record));
}

it("preserves exact due, overdue and seven-day work rows across 720 fictional revisions", () => {
  const dueDates: unknown[] = [
    "2026-10-31", "2026-11-01", "2026-11-04",
    "2026-11-05", "2026-11-06", "2026-11-12",
    "2026-11-13", "2026-03-08", "2026-03-09",
    "2028-02-28", "2028-02-29", "2028-03-01",
    "2026-02-30", "2026-11-5", "not a date",
    "", " ", null, undefined, 17,
  ];
  const statuses = [
    "Open", "Planned", "In progress", "Done", "Completed",
    "Cancelled", "Waiting", "On hold",
  ];
  const titles = [
    "Fictional repair", "Fictional repair", "Deep cleaning",
    "Zürich equipment", "İstanbul supplies", "=FAKEFORMULA()",
    "Low-voltage check",
  ];
  const records: WorkspaceRecord[] = Array.from({ length: 720 }, (_, i) => {
    const entity = i % 2 === 0 ? "tasks" : "jobs";
    const due = dueDates[i % dueDates.length];
    const data: WorkspaceRecord["data"] = {
      title: titles[i % titles.length],
      status: statuses[i % statuses.length],
      notes: "PRIVATE WORK NOTES",
    };
    // The schema permits only string/number saved fields. Simulate null
    // and undefined legacy due dates by omitting the saved due field.
    if (typeof due === "string" || typeof due === "number") {
      data[entity === "tasks" ? "due" : "date"] = due;
    }
    return record("work-" + (i % 227), entity, data,
      i % 29 === 0 ? FOREIGN : ORG, i % 31 === 0);
  });
  const repeated = record("repeated", "tasks", {
    title: "Repeated row", status: "Open", due: "2026-11-05",
  });
  records.push(
    repeated, repeated,
    record("repeated", "tasks", {
      title: "Different retained revision", status: "Open",
      due: "2026-11-06",
    }),
    record("not-work", "equipment", {
      name: "Not a work item", date: "2026-11-05", status: "Open",
    }),
    record("foreign", "tasks", {
      title: "FOREIGN PRIVATE TASK", status: "Open", due: "2026-11-05",
    }, FOREIGN),
    record("archived", "jobs", {
      title: "ARCHIVED PRIVATE JOB", status: "Open", date: "2026-11-05",
    }, ORG, true),
  );
  const before = structuredClone(records);
  for (const zone of ["UTC", "America/Los_Angeles", "America/New_York"]) {
    for (const date of [
      "2026-11-01", "2026-11-05", "2026-11-06",
      "2026-03-07", "2028-02-26",
    ]) {
      const overview = summarizeDailyOperations(
        { organizationId: ORG, records, equipmentStates: [] }, zone, date,
      );
      const previous = previousWorkSections(
        records, ORG, date, overview.upcomingThrough,
      );
      assertSameWorkRows(overview.dueToday, previous.dueToday);
      assertSameWorkRows(overview.overdue, previous.overdue);
      assertSameWorkRows(overview.upcoming, previous.upcoming);
      expect(overview.needsScheduling).toEqual(previous.needsScheduling);
      overview.needsScheduling.forEach((item, i) => {
        expect(item).toBe(previous.needsScheduling[i]);
      });
      for (const row of [
        ...overview.dueToday, ...overview.overdue, ...overview.upcoming,
      ]) {
        expect(row.record.organization_id).toBe(ORG);
        expect(row.record.archived).toBe(false);
        expect(row.record.entity === "jobs" || row.record.entity === "tasks")
          .toBe(true);
      }
      // The existing CSV exports the same pre-classified due/overdue rows.
      const output = dailyOperationsCsv(overview, zone, false);
      expect(output).not.toContain("FOREIGN PRIVATE TASK");
      expect(output).not.toContain("PRIVATE WORK NOTES");
    }
  }
  expect(records).toEqual(before);
});

it("keeps date boundaries and stable title ties without inventing work deadlines", () => {
  const records = [
    record("a", "tasks", {
      title: "Same title", status: "Open", due: "2026-11-05",
    }),
    record("b", "jobs", {
      title: "Same title", status: "Planned", date: "2026-11-05",
    }),
    record("c", "tasks", {
      title: "Overdue", status: "Open", due: "2026-11-04",
    }),
    record("d", "tasks", {
      title: "First future", status: "Open", due: "2026-11-06",
    }),
    record("e", "jobs", {
      title: "Last future", status: "Planned", date: "2026-11-12",
    }),
    record("f", "tasks", {
      title: "Eighth day", status: "Open", due: "2026-11-13",
    }),
    record("g", "jobs", {
      title: "Undated", status: "Planned", date: "   ",
    }),
    record("h", "tasks", {
      title: "No saved due", status: "Open",
    }),
    record("i", "tasks", {
      title: "Cancelled", status: "Cancelled", due: "2026-11-05",
    }),
  ];
  const overview = summarizeDailyOperations({
    organizationId: ORG, records, equipmentStates: [],
  }, "America/Los_Angeles", "2026-11-05");
  expect(overview.dueToday.map(({ record: r }) => r.id)).toEqual(["a", "b"]);
  expect(overview.overdue.map(({ record: r }) => r.id)).toEqual(["c"]);
  expect(overview.upcoming.map(({ record: r }) => r.id)).toEqual(["d", "e"]);
  expect(overview.needsScheduling.map((r) => r.id)).toEqual(["h", "g"]);
  const previous = previousWorkSections(
    records, ORG, "2026-11-05", overview.upcomingThrough,
  );
  assertSameWorkRows(overview.dueToday, previous.dueToday);
  assertSameWorkRows(overview.overdue, previous.overdue);
  assertSameWorkRows(overview.upcoming, previous.upcoming);
});

it("reclassifies each new summary after due dates, statuses or organizations change", () => {
  const item = record("mutable", "tasks", {
    title: "Fictional work", status: "Open", due: "2026-11-05",
  });
  const records = [item, item];
  function verify(organizationId: string, date: string) {
    const overview = summarizeDailyOperations({
      organizationId, records, equipmentStates: [],
    }, "UTC", date);
    const previous = previousWorkSections(
      records, organizationId, date, overview.upcomingThrough,
    );
    assertSameWorkRows(overview.dueToday, previous.dueToday);
    assertSameWorkRows(overview.overdue, previous.overdue);
    assertSameWorkRows(overview.upcoming, previous.upcoming);
    expect(overview.needsScheduling).toEqual(previous.needsScheduling);
    return overview;
  }
  expect(verify(ORG, "2026-11-05").dueToday).toHaveLength(2);
  item.data.due = "2026-11-12";
  expect(verify(ORG, "2026-11-05").upcoming).toHaveLength(2);
  item.data.status = "Completed";
  expect(verify(ORG, "2026-11-05").upcoming).toEqual([]);
  item.data.status = "Open";
  item.organization_id = FOREIGN;
  expect(verify(ORG, "2026-11-05").upcoming).toEqual([]);
  expect(verify(FOREIGN, "2026-11-05").upcoming).toHaveLength(2);
});
