import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import {
  filterAvailabilityPeriods,
  type AvailabilityPeriodTypeFilter,
} from "../../src/core/workforce-availability-filter";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function row(
  id: string, entity: string, data: WorkspaceRecord["data"],
  organization_id = ORG, archived = false,
): WorkspaceRecord {
  return {
    id, entity, data, organization_id, archived,
    revision: 1, config_revision: 1,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };
}

// Independent reference matching the old per-period linked-record scan,
// including first-record-wins across employees AND resources in source order.
function previousFilter(
  periods: readonly WorkspaceRecord[],
  linkedRecords: readonly WorkspaceRecord[],
  kind: AvailabilityPeriodTypeFilter,
  search: string,
): WorkspaceRecord[] {
  const query = search.trim().toLocaleLowerCase();
  return periods.filter((period) => {
    if (period.entity !== "availability") return false;
    if (kind !== "all" && period.data.kind !== kind) return false;
    if (!query) return true;
    const title = typeof period.data.title === "string"
      ? period.data.title : "";
    const subjectId = period.data.employee || period.data.resource;
    const subject = linkedRecords.find((record) =>
      record.id === subjectId &&
      record.organization_id === period.organization_id &&
      (record.entity === "employees" || record.entity === "resources"),
    );
    const subjectName = subject && typeof subject.data.name === "string"
      ? subject.data.name : "";
    return title.toLocaleLowerCase().includes(query) ||
      subjectName.toLocaleLowerCase().includes(query);
  });
}

it("matches old per-row search for 720 fictional periods, all types and privacy-restricted queries", () => {
  const periods: WorkspaceRecord[] = [];
  const linked: WorkspaceRecord[] = [];
  const kinds = ["Working hours", "Day off", "Vacation", "Unavailable"] as const;
  for (let i = 0; i < 720; i++) {
    const org = i % 13 === 0 ? FOREIGN : ORG;
    linked.push(row("person-" + i, i % 4 === 0 ? "resources" : "employees", {
      name: "Worker Zone " + (i % 17) + " Example " + i,
      notes: "HIDDEN NOTE " + i,
      phone: "PRIVATE PHONE " + i,
      email: "HIDDEN EMAIL " + i,
    }, org, i % 19 === 0));
    periods.push(row("period-" + i,
      i % 47 === 0 ? "appointments" : "availability", {
        kind: kinds[i % 4],
        title: i % 11 === 0 ? "Weekend availability " + i : "Shift " + i,
        employee: i % 2 === 0 ? "person-" + i : "",
        resource: i % 2 === 1 ? "person-" + i : "unused-resource-" + i,
        notes: "SECRET PERIOD " + i,
      }, org, i % 29 === 0));
    if (i % 31 === 0) {
      linked.unshift(row("person-" + i, "employees", {
        name: "FOREIGN PRIVATE " + i,
      }, org === ORG ? FOREIGN : ORG));
    }
  }
  const original = structuredClone({ periods, linked });
  for (const kind of ["all", ...kinds] as AvailabilityPeriodTypeFilter[]) {
    for (const search of [
      "", "  ", "weekend", "SHIFT 49", "worker zone", "zone 3",
      "example 701", "foreign private", "HIDDEN NOTE", "PRIVATE PHONE",
      "HIDDEN EMAIL", "SECRET PERIOD", "person-99", "period-100",
      "no matching text",
    ]) {
      expect(filterAvailabilityPeriods(periods, linked, kind, search))
        .toEqual(previousFilter(periods, linked, kind, search));
    }
  }
  expect({ periods, linked }).toEqual(original);
});

it("preserves first matching record even with duplicate IDs, malformed names and mixed entity types", () => {
  const periods = [
    row("p1", "availability", {
      kind: "Working hours", title: "Alpha", employee: "shared",
      resource: "also-shared",
    }),
    row("p2", "availability", {
      kind: "Vacation", title: "Beta", resource: "valid",
    }),
    row("p3", "availability", {
      kind: "Day off", title: "Gamma", employee: "missing",
      resource: "valid",
    }),
    row("p4", "availability", {
      kind: "Unavailable", title: "Delta", resource: 123,
    }),
    row("p5", "availability", {
      kind: "Working hours", title: "Epsilon", employee: "",
      resource: "valid",
    }, FOREIGN),
    row("not-availability", "appointments", {
      kind: "Vacation", title: "Ignore", employee: "valid",
    }),
  ];
  const linked = [
    row("shared", "employees", { name: "Foreign exposed" }, FOREIGN),
    row("shared", "resources", { name: 123, notes: "FIRST INVALID" }),
    row("shared", "employees", { name: "Ignored duplicate" }),
    row("also-shared", "resources", { name: "Should not fallback" }),
    row("valid", "employees", { name: "Real resource name" }),
    row("valid", "resources", { name: "Ignored resource duplicate" }),
    row("valid", "employees", { name: "Foreign valid" }, FOREIGN),
    row("123", "employees", { name: "Must not match numeric ID" }),
    row("valid", "contacts", { name: "Private contact" }),
  ];
  for (const search of [
    "", "real resource", "FOREIGN valid", "foreign exposed", "alpha",
    "ignored duplicate", "should not fallback", "first invalid",
    "private contact", "must not match numeric", "ignore",
  ]) {
    expect(filterAvailabilityPeriods(periods, linked, "all", search))
      .toEqual(previousFilter(periods, linked, "all", search));
  }
  expect(filterAvailabilityPeriods(periods, linked, "all", "ignored duplicate"))
    .toEqual([]);
  expect(filterAvailabilityPeriods(periods, linked, "all", "should not fallback"))
    .toEqual([]);
  expect(filterAvailabilityPeriods(periods, linked, "all", "real resource"))
    .map((r) => r.id).toEqual(["p2"]);
  expect(filterAvailabilityPeriods(periods, linked, "all", "foreign valid"))
    .map((r) => r.id).toEqual(["p5"]);
});

it("does not inspect linked records at all when the search is blank", () => {
  const periods = [
    row("one", "availability", { kind: "Working hours", title: "Some day" }),
    row("two", "availability", { kind: "Vacation", title: "Holiday" }),
  ];
  const linked = new Proxy([] as WorkspaceRecord[], {
    get(target, property, receiver) {
      if (property === Symbol.iterator || property === "find") {
        throw new Error("blank search should not access linked records");
      }
      return Reflect.get(target, property, receiver);
    },
  });
  expect(filterAvailabilityPeriods(periods, linked, "all", "  "))
    .toEqual(periods);
  expect(filterAvailabilityPeriods(periods, linked, "Vacation", ""))
    .toEqual([periods[1]]);
});
