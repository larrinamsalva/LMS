import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import { instant } from "../../src/core/time";
import {
  orderResourceMembershipsByStart,
  type ResourceMembershipStartSort,
} from "../../src/core/resource-membership-review";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function membership(
  index: number, start: string | number,
  organization_id = ORG,
): WorkspaceRecord {
  return {
    id: "membership-" + (index % 240),
    entity: "resource-memberships",
    organization_id,
    archived: index % 5 === 0,
    revision: 1 + (index % 7),
    config_revision: 1,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    data: {
      resource: "crew-" + (index % 15),
      employee: "employee-" + (index % 75),
      title: "Fictional retained membership " + index,
      start,
      end: "2028-01-01T00:00:00Z",
    },
  };
}

// Independent original from verified five-green, merged #164.
// It reparses each saved start separately without caching repeated values.
function previousOrder(
  memberships: readonly WorkspaceRecord[],
  order: ResourceMembershipStartSort,
): WorkspaceRecord[] {
  if (order === "retained") return [...memberships];
  const indexed = memberships.map((record, index) => {
    let start: bigint | null = null;
    try {
      start = instant(String(record.data.start)).epochNanoseconds;
    } catch {
      // Historical malformed timestamps remain visible, but never guessed.
    }
    return { record, index, start };
  });
  indexed.sort((a, b) => {
    if (a.start === null || b.start === null) {
      if (a.start === null && b.start === null) return a.index - b.index;
      return a.start === null ? 1 : -1;
    }
    if (a.start === b.start) return a.index - b.index;
    const compared = a.start < b.start ? -1 : 1;
    return order === "oldest" ? compared : -compared;
  });
  return indexed.map(({ record }) => record);
}

it("preserves exact historical record references and tie order across 720 fictional memberships", () => {
  const times: Array<string | number> = [
    "2026-11-01T08:30:00Z",
    "2026-11-01T09:30:00Z",
    "2026-11-01T09:30:00+00:00",
    "2026-11-06T18:00:00Z",
    "2026-11-07T07:30:00Z",
    "2026-11-07T08:30:00Z",
    "2028-02-29T12:00:00Z",
    "invalid-retained-start",
    "",
    17,
    Number.NaN,
  ];
  const records = Array.from({ length: 720 }, (_, index) =>
    membership(index, times[index % times.length],
      index % 19 === 0 ? FOREIGN : ORG),
  );
  const shared = membership(999, "2026-11-01T09:30:00Z");
  records.push(shared, shared, membership(999, "2026-11-01T08:30:00Z"));
  const original = [...records];
  for (const order of ["retained", "oldest", "newest"] as const) {
    const expected = previousOrder(records, order);
    const actual = orderResourceMembershipsByStart(records, order);
    expect(actual).toHaveLength(expected.length);
    expect(actual).toEqual(expected);
    for (let i = 0; i < actual.length; i++) {
      expect(actual[i]).toBe(expected[i]);
    }
    expect(actual).not.toBe(records);
  }
  records.forEach((record, i) => expect(record).toBe(original[i]));
});

it("keeps DST-fold instants ordered by UTC, invalid starts last and stable ties", () => {
  const records = [
    membership(0, "invalid"),
    membership(1, "2026-11-01T09:30:00Z"),
    membership(2, "2026-11-01T08:30:00Z"),
    membership(3, "2026-11-01T09:30:00+00:00"),
    membership(4, ""),
    membership(5, "2026-11-01T08:30:00Z"),
    membership(6, 42),
  ];
  const oldest = orderResourceMembershipsByStart(records, "oldest");
  expect(oldest.map((r) => r.data.title)).toEqual([
    "Fictional retained membership 2",
    "Fictional retained membership 5",
    "Fictional retained membership 1",
    "Fictional retained membership 3",
    "Fictional retained membership 0",
    "Fictional retained membership 4",
    "Fictional retained membership 6",
  ]);
  const newest = orderResourceMembershipsByStart(records, "newest");
  expect(newest.map((r) => r.data.title)).toEqual([
    "Fictional retained membership 1",
    "Fictional retained membership 3",
    "Fictional retained membership 2",
    "Fictional retained membership 5",
    "Fictional retained membership 0",
    "Fictional retained membership 4",
    "Fictional retained membership 6",
  ]);
  expect(oldest).toEqual(previousOrder(records, "oldest"));
  expect(newest).toEqual(previousOrder(records, "newest"));
});

it("keeps calls isolated and skips parsing in retained order", () => {
  const entries = [
    membership(0, "invalid"),
    membership(1, "2026-11-06T18:00:00Z"),
    membership(2, "2026-11-06T18:00:00Z"),
  ];
  const initial = orderResourceMembershipsByStart(entries, "newest");
  entries[0].data.start = "2027-01-01T00:00:00Z";
  const changed = orderResourceMembershipsByStart(entries, "newest");
  expect(initial).toEqual(previousOrder(
    [membership(0, "invalid"), entries[1], entries[2]], "newest",
  ));
  expect(changed).toEqual(previousOrder(entries, "newest"));
  expect(changed[0]).toBe(entries[0]);
  const retained = orderResourceMembershipsByStart(entries, "retained");
  expect(retained).toEqual(entries);
  expect(retained).not.toBe(entries);
});
