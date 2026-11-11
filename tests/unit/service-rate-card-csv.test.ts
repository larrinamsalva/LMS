import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import {
  serviceRateCardCsv,
  serviceRateCardRows,
} from "../../src/core/service-rate-card-csv";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const foreign = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const record = (
  id: string, entity: string, data: WorkspaceRecord["data"],
  archived = false, organization_id = org, revision = 1,
): WorkspaceRecord => ({
  id, entity, data, organization_id, archived, revision,
  config_revision: 1, created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

it("exports active and archived area rates separately using exact USD amounts", () => {
  const records = [
    record("clean", "services", {
      name: "House cleaning", kind: "Service", mode: "Hourly", unit: "hour",
    }),
    record("area", "pricing-zones", { name: "Local area" }),
    record("rateA", "service-rates", {
      title: "Local hourly rate", service: "clean", zone: "area",
      amount: "3501", effective_from: "2026-01-01",
      effective_until: "2027-01-01",
    }, false, org, 2),
    record("rateB", "service-rates", {
      title: "Old hourly rate", service: "clean", zone: "area",
      amount: "1200", effective_from: "2025-01-01", effective_until: "2026-01-01",
    }, true),
    record("outside", "service-rates", {
      title: "Foreign private rate", service: "clean", zone: "area",
      amount: "9999", effective_from: "2026-01-01",
    }, false, foreign),
  ];
  const before = structuredClone(records);
  const active = serviceRateCardCsv(records, org);
  const lines = active.trimEnd().split("\r\n");
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain('"Effective until (exclusive)"');
  expect(lines[1]).toBe(
    '"Local hourly rate","House cleaning","Active","Service",' +
    '"Hourly","hour","Local area","Active","35.01","2026-01-01",' +
    '"2027-01-01","2","Active"',
  );
  expect(active).not.toContain("Old hourly rate");
  expect(active).not.toContain("Foreign private rate");
  const archived = serviceRateCardCsv(records, org, true);
  expect(archived).toContain('"Old hourly rate"');
  expect(archived).toContain('"12.00"');
  expect(archived).not.toContain("Local hourly rate");
  expect(records).toEqual(before);
});

it("labels archived references and protects against formula-like catalog fields", () => {
  const records = [
    record("service", "services", {
      name: "=INJECT()", kind: "Extra", mode: "Fixed", unit: "visit",
    }, true),
    record("area", "pricing-zones", { name: "+AREA" }, true),
    record("rate", "service-rates", {
      title: "@PRICE", service: "service", zone: "area",
      amount: "999999999999", effective_from: "2026-01-01",
    }),
  ];
  const csv = serviceRateCardCsv(records, org);
  expect(csv).toContain("\"'@PRICE\"");
  expect(csv).toContain("\"'=INJECT()\"");
  expect(csv).toContain("\"'+AREA\"");
  expect(csv).toContain('"Archived"');
  expect(csv).toContain('"9999999999.99"');
});

it("does not leak cross-org links or unknown records and keeps empty exports header-only", () => {
  const records = [
    record("foreign-service", "services", { name: "Private other org service" }, false, foreign),
    record("foreign-area", "pricing-zones", { name: "Private other org zone" }, false, foreign),
    record("rate", "service-rates", {
      title: "Orphan rate", service: "foreign-service", zone: "foreign-area",
      amount: "100", effective_from: "2026-01-01",
    }),
  ];
  const rows = serviceRateCardRows(records, org);
  expect(rows).toHaveLength(1);
  expect(rows[0].slice(0, 9)).toEqual([
    "Orphan rate", "Retained service link", "Unavailable",
    "", "", "", "Retained area link", "Unavailable", "1.00",
  ]);
  const csv = serviceRateCardCsv(records, org);
  expect(csv).not.toContain("Private other org");
  expect(serviceRateCardCsv(records, org, true).trimEnd()
    .split("\r\n")).toHaveLength(1);
});


it("filters saved rate cards by effective-from inclusive and until exclusive", () => {
  const records = [
    record("service", "services", {
      name: "Cleaning", kind: "Service", mode: "Hourly", unit: "hour",
    }),
    record("area", "pricing-zones", { name: "Local" }),
    record("old", "service-rates", {
      title: "Old period", service: "service", zone: "area",
      amount: "1000", effective_from: "2025-01-01",
      effective_until: "2026-01-01",
    }, true),
    record("current", "service-rates", {
      title: "Current period", service: "service", zone: "area",
      amount: "1500", effective_from: "2026-01-01",
      effective_until: "2027-01-01",
    }),
    record("future", "service-rates", {
      title: "Future period", service: "service", zone: "area",
      amount: "2000", effective_from: "2027-01-01",
      effective_until: "",
    }),
    record("other", "service-rates", {
      title: "Private other business", service: "service", zone: "area",
      amount: "3000", effective_from: "2025-01-01",
    }, false, foreign),
  ];
  const original = structuredClone(records);
  const titles = (archived: boolean, date: string) =>
    serviceRateCardRows(records, org, archived, date).map((row) => row[0]);
  expect(titles(false, "")).toEqual(["Current period", "Future period"]);
  expect(titles(false, "2025-12-31")).toEqual([]);
  expect(titles(false, "2026-01-01")).toEqual(["Current period"]);
  expect(titles(false, "2026-12-31")).toEqual(["Current period"]);
  expect(titles(false, "2027-01-01")).toEqual(["Future period"]);
  expect(titles(true, "2025-12-31")).toEqual(["Old period"]);
  expect(titles(true, "2026-01-01")).toEqual([]);
  expect(titles(false, "2026-02-30")).toEqual([]);
  expect(titles(false, "not-a-date")).toEqual([]);
  expect(serviceRateCardCsv(records, org, false, "2026-11-06"))
    .toContain('"Current period"');
  expect(serviceRateCardCsv(records, org, false, "2026-11-06"))
    .not.toContain('"Future period"');
  expect(serviceRateCardCsv(records, org, false, "2025-11-06").trimEnd()
    .split("\r\n")).toHaveLength(1);
  expect(records).toEqual(original);
});
