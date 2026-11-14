import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import { instant } from "../../src/core/time";
import {
  orderResourceMembershipsByStart,
  type ResourceMembershipStartSort,
} from "../../src/core/resource-membership-review";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function record(id: string, start: string, archived = false): WorkspaceRecord {
  return {
    id, entity: "resource-memberships",
    organization_id: ORG, archived,
    data: {
      resource: "crew-1", employee: "employee-1", title: id,
      start, end: "2026-12-01T00:00:00Z",
    },
    revision: 1, config_revision: 1,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };
}

// Independent reference reproducing the previous eager timestamp-parsing
// implementation for every order. No sorting semantics should change.
function previousOrder(
  memberships: readonly WorkspaceRecord[],
  order: ResourceMembershipStartSort,
): WorkspaceRecord[] {
  const indexed = memberships.map((item, index) => {
    let start: bigint | null = null;
    try {
      start = instant(String(item.data.start)).epochNanoseconds;
    } catch {
      // Previous behavior preserves malformed dates as unsortable history.
    }
    return { item, index, start };
  });
  if (order === "retained") return indexed.map(({ item }) => item);
  indexed.sort((a, b) => {
    if (a.start === null || b.start === null) {
      if (a.start === null && b.start === null) return a.index - b.index;
      return a.start === null ? 1 : -1;
    }
    if (a.start === b.start) return a.index - b.index;
    const compared = a.start < b.start ? -1 : 1;
    return order === "oldest" ? compared : -compared;
  });
  return indexed.map(({ item }) => item);
}

it("retained ordering skips date reads and returns a new array with the same records", () => {
  const sample = [record("a", "2026-11-06T00:00:00Z"),
    record("b", "invalid", true)];
  let reads = 0;
  for (const item of sample) {
    Object.defineProperty(item.data, "start", {
      configurable: true,
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("retained ordering must not parse timestamps");
      },
    });
  }
  const result = orderResourceMembershipsByStart(sample, "retained");
  expect(reads).toBe(0);
  expect(result).not.toBe(sample);
  expect(result).toHaveLength(2);
  expect(result[0]).toBe(sample[0]);
  expect(result[1]).toBe(sample[1]);
});

it("all roster start orders agree with the original behavior across 720 fictional records", () => {
  const source: WorkspaceRecord[] = [];
  const possibleStarts = [
    "2026-11-01T08:30:00Z", // first repeated autumn DST clock hour
    "2026-11-01T09:30:00Z", // second repeated autumn DST clock hour
    "2026-03-08T09:30:00Z", // spring-forward boundary
    "2026-03-08T10:30:00Z",
    "2026-11-06T08:00:00Z",
    "2026-11-06T00:00:00-08:00", // equal instant: stable tie
    "2026-11-06T09:00:00+01:00", // equal instant: stable tie
    "2026-01-01T00:00:00Z",
    "2025-12-31T23:59:59Z",
    "", "not-a-date", "2026-13-01", "2026-11-01", // invalid instants
  ];
  for (let i = 0; i < 720; i++) {
    source.push(record("membership-" + i,
      possibleStarts[(i * 7) % possibleStarts.length], i % 5 === 0));
  }
  // Include unrelated entities; order should never mutate/filter the input.
  const unrelated = record("other-entity", "bad-date");
  unrelated.entity = "availability";
  source.splice(17, 0, unrelated);
  const before = structuredClone(source);
  for (const order of ["retained", "oldest", "newest"] as const) {
    const expected = previousOrder(source, order).map((item) => item.id);
    const actual = orderResourceMembershipsByStart(source, order);
    expect(actual.map((item) => item.id)).toEqual(expected);
    expect(actual).not.toBe(source);
  }
  expect(source).toEqual(before);
});

it("an empty roster remains empty under all three ordering modes", () => {
  for (const order of ["retained", "oldest", "newest"] as const) {
    expect(orderResourceMembershipsByStart([], order)).toEqual([]);
  }
});
