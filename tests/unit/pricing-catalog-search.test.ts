import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import { filterPricingCatalogCards } from "../../src/core/pricing-catalog-search";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const foreign = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const rec = (
  id: string, entity: string, data: WorkspaceRecord["data"],
  archived = false, organization_id = org,
): WorkspaceRecord => ({
  id, entity, data, archived, organization_id, revision: 1,
  config_revision: 1, created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

it("searches active services, saved rate titles and safe linked names case-insensitively", () => {
  const records = [
    rec("home", "services", { name: "House Cleaning", description: "Kitchen prep",
      category: "Residential", kind: "Service", mode: "Hourly", unit: "hour" }),
    rec("windows", "services", { name: "Window Detail", description: "Window washing",
      kind: "Extra", mode: "Fixed", unit: "visit" }),
    rec("local", "pricing-zones", { name: "Local service area" }),
    rec("outer", "pricing-zones", { name: "Outer service area" }),
    rec("a", "service-rates", {
      title: "Standard visit", service: "home", zone: "local",
      effective_from: "2026-01-01", effective_until: "2027-01-01",
    }),
    rec("b", "service-rates", {
      title: "Outer hourly rate", service: "home", zone: "outer",
      effective_from: "2026-01-01", effective_until: "2027-01-01",
    }),
    rec("c", "service-rates", {
      title: "Window rate", service: "windows", zone: "local",
      effective_from: "2026-01-01", effective_until: "2027-01-01",
    }),
  ];
  const before = structuredClone(records);
  const search = (query: string, area = "") =>
    filterPricingCatalogCards(records, org, false, "2026-11-06", area, query);
  expect(search("  OUTER  ").rates.map((r) => r.id)).toEqual(["b"]);
  expect(search("  OUTER  ").zones.map((r) => r.id)).toEqual(["outer"]);
  expect(search("HOUSE cleanING").services.map((r) => r.id)).toEqual(["home"]);
  expect(search("HOUSE cleanING").rates.map((r) => r.id)).toEqual(["a", "b"]);
  expect(search("residential").services.map((r) => r.id)).toEqual(["home"]);
  expect(search("window").rates.map((r) => r.id)).toEqual(["c"]);
  expect(search("hourly", "local").rates.map((r) => r.id)).toEqual([]);
  expect(search("").rates.map((r) => r.id)).toEqual(["a", "b", "c"]);
  expect(records).toEqual(before);
});

it("respects archived status, date boundaries and area filters for saved rate cards", () => {
  const records = [
    rec("service", "services", { name: "Carpet Cleaning" }),
    rec("zone", "pricing-zones", { name: "East region" }),
    rec("active", "service-rates", {
      title: "Spring rate", service: "service", zone: "zone",
      effective_from: "2026-01-01", effective_until: "2027-01-01",
    }),
    rec("archived", "service-rates", {
      title: "Past rate", service: "service", zone: "zone",
      effective_from: "2025-01-01", effective_until: "2026-01-01",
    }, true),
  ];
  const find = (archived: boolean, date: string, zone: string, query: string) =>
    filterPricingCatalogCards(records, org, archived, date, zone, query);
  expect(find(false, "2026-01-01", "zone", "carpet").rates.map((r) => r.id))
    .toEqual(["active"]);
  expect(find(false, "2027-01-01", "zone", "carpet").rates).toEqual([]);
  expect(find(true, "2025-12-31", "zone", "past").rates.map((r) => r.id))
    .toEqual(["archived"]);
  expect(find(true, "2026-01-01", "zone", "past").rates).toEqual([]);
  expect(find(false, "2026-11-06", "other", "").rates).toEqual([]);
  expect(find(false, "2026-02-30", "", "").rates).toEqual([]);
});

it("never returns foreign business catalog cards or searches their referenced names", () => {
  const records = [
    rec("own", "services", { name: "Oven cleaning" }),
    rec("zone", "pricing-zones", { name: "Current area" }),
    rec("private", "services", { name: "SECRET competing price" }, false, foreign),
    rec("private-zone", "pricing-zones", { name: "SECRET area" }, false, foreign),
    rec("rate", "service-rates", {
      title: "Our rate", service: "private", zone: "private-zone",
      effective_from: "2026-01-01",
    }),
    rec("private-rate", "service-rates", {
      title: "SECRET rate", service: "own", zone: "zone",
      effective_from: "2026-01-01",
    }, false, foreign),
  ];
  const visible = filterPricingCatalogCards(records, org, false, "", "", "SECRET");
  expect(visible.services).toEqual([]);
  expect(visible.rates).toEqual([]);
  expect(visible.zones).toEqual([]);
  const all = filterPricingCatalogCards(records, org, false, "", "", "");
  expect(all.services.map((r) => r.id)).toEqual(["own"]);
  expect(all.rates.map((r) => r.id)).toEqual(["rate"]);
  expect(all.zones.map((r) => r.id)).toEqual(["zone"]);
});
