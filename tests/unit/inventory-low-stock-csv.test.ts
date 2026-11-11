import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import { lowStockPlanningCsv } from "../../src/core/inventory-low-stock-csv";
import type { StockBalance } from "../../src/core/inventory";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const foreign = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const record = (
  id: string,
  entity: string,
  data: WorkspaceRecord["data"],
  archived = false,
  organization_id = org,
): WorkspaceRecord => ({
  id, entity, data, archived, organization_id,
  revision: 1, config_revision: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

it("exports current per-location shortages with exact whole-case planning counts", () => {
  const records = [
    record("gloves", "items", {
      name: "Gloves", sku: "GLOVE-13", unit: "glove",
      case_size: "12", minimum: "25",
    }),
    record("van", "stock-locations", { name: "Supply van" }),
    record("shelf", "stock-locations", { name: "Supply shelf" }),
    record("archived", "items", { name: "Retired", minimum: "999" }, true),
    record("retired-location", "stock-locations", { name: "Closed" }, true),
    record("foreign-product", "items", {
      name: "Private foreign supply", minimum: "999",
    }, false, foreign),
    record("foreign-location", "stock-locations", {
      name: "Private foreign room",
    }, false, foreign),
  ];
  const balances: StockBalance[] = [
    { organization_id: org, product_id: "gloves", location_id: "shelf", units: "21" },
    { organization_id: org, product_id: "gloves", location_id: "van", units: "24" },
    { organization_id: foreign, product_id: "foreign-product",
      location_id: "foreign-location", units: "0" },
  ];
  const original = structuredClone({ records, balances });
  const csv = lowStockPlanningCsv(records, balances, org);
  const rows = csv.trimEnd().split("\r\n");
  expect(rows).toHaveLength(3);
  expect(rows[0]).toContain('"Whole cases to cover shortfall (planning only)"');
  expect(rows[1]).toBe(
    '"Gloves","GLOVE-13","Supply shelf","21","25","4","glove","12","1"',
  );
  expect(rows[2]).toBe(
    '"Gloves","GLOVE-13","Supply van","24","25","1","glove","12","1"',
  );
  expect(csv).not.toContain("Private foreign");
  expect(csv).not.toContain("Retired");
  expect(csv).not.toContain("Closed");
  expect(lowStockPlanningCsv(records, balances, org, "shelf").trimEnd()
    .split("\r\n")).toHaveLength(2);
  expect(lowStockPlanningCsv(records, balances, org, "foreign-location")
    .trimEnd().split("\r\n")).toHaveLength(1);
  expect({ records, balances }).toEqual(original);
});

it("rounds suggested cases up using integers, handles zero balances and formula-safe labels", () => {
  const records = [
    record("soap", "items", {
      name: "=TRICK()", sku: "+BAD",
      minimum: "25", case_size: "12",
    }),
    record("bucket", "items", { name: "Bucket", minimum: "0" }),
    record("room", "stock-locations", { name: "@Warehouse" }),
  ];
  const csv = lowStockPlanningCsv(records, [], org);
  const rows = csv.trimEnd().split("\r\n");
  expect(rows).toHaveLength(2);
  expect(rows[1]).toContain('"0","25","25","units","12","3"');
  expect(rows[1]).toContain('"\'=TRICK()"');
  expect(rows[1]).toContain("\"'+BAD\"");
  expect(rows[1]).toContain('"\'@Warehouse"');
  const fullStock: StockBalance[] = [
    { organization_id: org, product_id: "soap", location_id: "room", units: "25" },
  ];
  expect(lowStockPlanningCsv(records, fullStock, org).trimEnd()
    .split("\r\n")).toHaveLength(1);
});


it("exports exactly the filtered and shortfall-sorted alerts, excluding other organizations", () => {
  const records = [
    record("gloves", "items", {
      name: "Gloves", sku: "GLOVE-A", barcode: "BAR-13",
      category: "PPE", case_size: "12", minimum: "25",
    }),
    record("soap", "items", {
      name: "Soap", sku: "SOAP-S", category: "Cleaning",
      case_size: "6", minimum: "10",
    }),
    record("shelf", "stock-locations", { name: "Shelf" }),
    record("van", "stock-locations", { name: "Van" }),
    record("outside", "items", {
      name: "Private foreign", sku: "FOREIGN-1", minimum: "99",
    }, false, foreign),
    record("foreign-room", "stock-locations", { name: "Foreign room" }, false, foreign),
  ];
  const balances: StockBalance[] = [
    { organization_id: org, product_id: "gloves", location_id: "shelf", units: "20" },
    { organization_id: org, product_id: "soap", location_id: "shelf", units: "8" },
    { organization_id: org, product_id: "soap", location_id: "van", units: "1" },
    { organization_id: foreign, product_id: "outside",
      location_id: "foreign-room", units: "0" },
  ];
  const sorted = lowStockPlanningCsv(records, balances, org, "", { sort: "shortfall" });
  const rows = sorted.trimEnd().split("\r\n");
  expect(rows).toHaveLength(5);
  expect(rows[1]).toContain('"Gloves","GLOVE-A","Van","0","25","25"');
  expect(rows[2]).toContain('"Soap","SOAP-S","Van","1","10","9"');
  expect(rows[3]).toContain('"Gloves","GLOVE-A","Shelf","20","25","5"');
  expect(rows[4]).toContain('"Soap","SOAP-S","Shelf","8","10","2"');
  expect(sorted).not.toContain("Private foreign");
  const filtered = lowStockPlanningCsv(records, balances, org, "", {
    query: "bar-13", outOfStockOnly: true, sort: "shortfall",
  });
  expect(filtered.trimEnd().split("\r\n")).toHaveLength(2);
  expect(filtered).toContain('"Gloves","GLOVE-A","Van","0","25","25"');
  expect(filtered).not.toContain('"Shelf"');
  expect(lowStockPlanningCsv(records, balances, org, "shelf", {
    outOfStockOnly: true,
  }).trimEnd().split("\r\n")).toHaveLength(1);
});
