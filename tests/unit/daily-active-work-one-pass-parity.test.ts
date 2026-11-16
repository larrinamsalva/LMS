import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import {
  summarizeDailyOperations,
  type DueWork,
} from "../../src/core/daily-operations";

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

// Independently reconstructed from verified merged five-green #181.
// The original code scans the same active-work array separately for
// unscheduled items and YYYY-MM-DD-shaped due items, sorts each array,
// then classifies its sorted due-work list into three date sections.
function previousWorkLists(
  allRecords: readonly WorkspaceRecord[],
  organizationId: string,
  date: string,
  upcomingThrough: string,
): {
  needsScheduling: WorkspaceRecord[];
  dueToday: DueWork[];
  overdue: DueWork[];
  upcoming: DueWork[];
} {
  const records = allRecords.filter(
    (r) => r.organization_id === organizationId && !r.archived,
  );
  const activeWork = records.filter(
    (r) => (r.entity === "tasks" || r.entity === "jobs") &&
      !["Done", "Completed", "Cancelled"].includes(String(r.data.status)),
  );
  const needsScheduling = activeWork
    .filter((r) => {
      const value = r.entity === "jobs" ? r.data.date : r.data.due;
      return value === null || value === undefined ||
        (typeof value === "string" && value.trim() === "");
    })
    .sort((a, b) =>
      String(a.data.title).localeCompare(String(b.data.title)) ||
      a.id.localeCompare(b.id),
    );
  const unfinished = activeWork
    .flatMap((r): DueWork[] => {
      const value = r.entity === "jobs" ? r.data.date : r.data.due;
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? [{ record: r, due: value }] : [];
    })
    .sort((a, b) =>
      a.due.localeCompare(b.due) ||
      String(a.record.data.title).localeCompare(String(b.record.data.title)),
    );
  const dueToday: DueWork[] = [];
  const overdue: DueWork[] = [];
  const upcoming: DueWork[] = [];
  for (const item of unfinished) {
    if (item.due === date) dueToday.push(item);
    else if (item.due < date) overdue.push(item);
    else if (item.due > date && item.due <= upcomingThrough) {
      upcoming.push(item);
    }
  }
  return { needsScheduling, dueToday, overdue, upcoming };
}

function assertSameDueRows(actual: readonly DueWork[], expected: readonly DueWork[]) {
  expect(actual).toHaveLength(expected.length);
  expect(actual).toEqual(expected);
  actual.forEach((item, i) => expect(item.record).toBe(expected[i].record));
}

function assertWorkMatches(
  records: readonly WorkspaceRecord[],
  organizationId: string,
  date: string,
  zone: string,
) {
  const overview = summarizeDailyOperations(
    { organizationId, records: [...records], equipmentStates: [] },
    zone, date,
  );
  const expected = previousWorkLists(
    records, organizationId, date, overview.upcomingThrough,
  );
  expect(overview.needsScheduling).toEqual(expected.needsScheduling);
  overview.needsScheduling.forEach((row, i) => {
    expect(row).toBe(expected.needsScheduling[i]);
  });
  assertSameDueRows(overview.dueToday, expected.dueToday);
  assertSameDueRows(overview.overdue, expected.overdue);
  assertSameDueRows(overview.upcoming, expected.upcoming);
  for (const row of [
    ...overview.needsScheduling,
    ...overview.dueToday.map((item) => item.record),
    ...overview.overdue.map((item) => item.record),
    ...overview.upcoming.map((item) => item.record),
  ]) {
    expect(row.organization_id).toBe(organizationId);
    expect(row.archived).toBe(false);
    expect(row.entity === "jobs" || row.entity === "tasks").toBe(true);
  }
  return overview;
}

it("preserves four work panels over 720 fictional job/task revisions", () => {
  const dates: Array<string | number | undefined> = [
    "2026-10-31", "2026-11-04", "2026-11-05",
    "2026-11-06", "2026-11-12", "2026-11-13",
    "2026-03-08", "2026-03-09", "2028-02-29",
    "2026-02-30", "2026-11-5", "bad-date",
    "", "   ", undefined, 17, 0,
  ];
  const statuses = [
    "Open", "Planned", "In progress", "On hold", "Waiting",
    "Done", "Completed", "Cancelled",
  ];
  const titles = [
    "Fictional repair", "Fictional repair", "Deep clean",
    "Zürich supplies", "İstanbul equipment", "=FAKEFORMULA()",
  ];
  const records: WorkspaceRecord[] = Array.from({ length: 720 }, (_, i) => {
    const entity = i % 2 === 0 ? "tasks" : "jobs";
    const field = entity === "jobs" ? "date" : "due";
    const data: WorkspaceRecord["data"] = {
      title: titles[i % titles.length],
      status: statuses[i % statuses.length],
      notes: "PRIVATE FICTIONAL JOB NOTES",
    };
    const value = dates[i % dates.length];
    if (value !== undefined) data[field] = value;
    return record("work-" + (i % 211), entity, data,
      i % 29 === 0 ? FOREIGN : ORG, i % 31 === 0);
  });
  const repeat = record("duplicate", "tasks", {
    title: "Repeated task", status: "Open", due: "2026-11-05",
  });
  records.push(
    repeat, repeat,
    record("duplicate", "tasks", {
      title: "Another historic revision", status: "Open",
      due: "2026-11-06",
    }),
    record("same-title", "jobs", { title: "Repeated task", status: "Planned" }),
    record("other-entity", "equipment", { name: "Not a work item" }),
    record("foreign-work", "tasks", {
      title: "PRIVATE FOREIGN TASK", status: "Open", due: "2026-11-05",
    }, FOREIGN),
    record("archived-work", "jobs", {
      title: "ARCHIVED JOB", status: "Planned", date: "2026-11-05",
    }, ORG, true),
  );
  const untouched = structuredClone(records);
  for (const zone of ["UTC", "America/Los_Angeles", "America/New_York"]) {
    for (const date of [
      "2026-11-04", "2026-11-05", "2026-11-06",
      "2026-03-07", "2028-02-26",
    ]) {
      assertWorkMatches(records, ORG, date, zone);
    }
  }
  expect(records).toEqual(untouched);
});

it("preserves missing/blank, shaped-but-invalid, and numeric date distinctions", () => {
  const records = [
    record("missing", "tasks", { title: "Unscheduled", status: "Open" }),
    record("blank", "jobs", { title: "Blank", status: "Planned", date: "  " }),
    record("invalid", "jobs", {
      title: "Bad date", status: "Planned", date: "2026-02-30",
    }),
    record("malformed", "tasks", {
      title: "Malformed", status: "Open", due: "2026-11-5",
    }),
    record("numeric", "tasks", { title: "Numeric", status: "Open", due: 17 }),
    record("today", "jobs", {
      title: "Today", status: "Planned", date: "2026-11-05",
    }),
    record("overdue", "tasks", {
      title: "Overdue", status: "Open", due: "2026-11-04",
    }),
    record("future", "tasks", {
      title: "Future", status: "Open", due: "2026-11-12",
    }),
    record("outside", "tasks", {
      title: "Outside", status: "Open", due: "2026-11-13",
    }),
    record("cancelled", "jobs", {
      title: "Cancelled", status: "Cancelled", date: "2026-11-05",
    }),
  ];
  const actual = assertWorkMatches(
    records, ORG, "2026-11-05", "America/Los_Angeles",
  );
  expect(actual.needsScheduling.map((r) => r.id)).toEqual(["blank", "missing"]);
  expect(actual.dueToday.map((r) => r.record.id)).toEqual(["today"]);
  expect(actual.overdue.map((r) => r.record.id)).toEqual([
    "invalid", "overdue",
  ]);
  expect(actual.upcoming.map((r) => r.record.id)).toEqual(["future"]);
});

it("rebuilds the work lists after saved dates, status and organization change", () => {
  const item = record("editable", "tasks", {
    title: "Mutable fictional task", status: "Open",
  });
  const records = [item, item];
  expect(assertWorkMatches(records, ORG, "2026-11-05", "UTC")
    .needsScheduling).toHaveLength(2);
  item.data.due = "2026-11-05";
  expect(assertWorkMatches(records, ORG, "2026-11-05", "UTC")
    .dueToday).toHaveLength(2);
  item.data.due = "2026-11-12";
  expect(assertWorkMatches(records, ORG, "2026-11-05", "UTC")
    .upcoming).toHaveLength(2);
  item.data.status = "Done";
  expect(assertWorkMatches(records, ORG, "2026-11-05", "UTC")
    .upcoming).toEqual([]);
  item.data.status = "Open";
  item.organization_id = FOREIGN;
  expect(assertWorkMatches(records, ORG, "2026-11-05", "UTC")
    .upcoming).toEqual([]);
  expect(assertWorkMatches(records, FOREIGN, "2026-11-05", "UTC")
    .upcoming).toHaveLength(2);
});
