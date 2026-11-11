import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import type { StockBalance } from "../../src/core/inventory";
import {
  physicalCountRows,
  physicalCountSheetCsv,
} from "../../src/core/inventory-count-sheet-csv";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const record = (
  id: string, entity: string, data: WorkspaceRecord["data"],
  archived = false, organization_id = org,
): WorkspaceRecord => ({
  id, entity, data, archived, organization_id, revision: 1,
  config_revision: 1, created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

it("lists every active product/location including zeros and blank manual count fields", () => {
  const records = [
    record("soap", "items", {
      name: "Soap", sku: "SOAP-1", barcode: "BAR-1",
      unit: "bottle", case_size: "12", category: "Cleaning",
    }),
    record("gloves", "items", {
      name: "Gloves", sku: "GLOVE-2", unit: "glove", case_size: "24",
    }),
    record("retired", "items", { name: "Retired" }, true),
    record("shelf", "stock-locations", { name: "A Shelf" }),
    record("van", "stock-locations", { name: "B Van" }),
    record("retired-room", "stock-locations", { name: "Closed" }, true),
    record("foreign", "items", { name: "Other owner's supplies" }, false, other),
    record("foreign-room", "stock-locations", { name: "Hidden room" }, false, other),
  ];
  const balances: StockBalance[] = [
    { organization_id: org, product_id: "soap", location_id: "shelf", units: "12" },
    { organization_id: org, product_id: "soap", location_id: "van", units: "999999999999" },
    { organization_id: other, product_id: "gloves", location_id: "shelf", units: "88" },
  ];
  const original = structuredClone({ records, balances });
  const rows = physicalCountRows(records, balances, org);
  expect(rows).toHaveLength(4);
  expect(rows.map((row) => [row.locationName, row.productName, row.recordedUnits]))
    .toEqual([
      ["A Shelf", "Gloves", "0"],
      ["A Shelf", "Soap", "12"],
      ["B Van", "Gloves", "0"],
      ["B Van", "Soap", "999999999999"],
    ]);
  const csv = physicalCountSheetCsv(records, balances, org);
  const lines = csv.trimEnd().split("\r\n");
  expect(lines).toHaveLength(5);
  expect(lines[0]).toContain('"Counted units (fill manually)"');
  expect(lines[0]).toContain('"Difference (fill manually)"');
  expect(lines[1]).toBe(
    '"Gloves","GLOVE-2","","A Shelf","0","","","glove","24",""',
  );
  expect(lines[4]).toContain('"999999999999","","","bottle","12",""');
  expect(csv).not.toContain("Other owner's supplies");
  expect(csv).not.toContain("Hidden room");
  expect(csv).not.toContain("Retired");
  expect({ records, balances }).toEqual(original);
});

it("respects selected location and search regardless of shortage status", () => {
  const records = [
    record("soap", "items", {
      name: "Soap", sku: "SOAP-1", barcode: "ABC123",
      category: "Cleaning",
    }),
    record("gloves", "items", { name: "Gloves", sku: "GLOVE-9" }),
    record("shelf", "stock-locations", { name: "Shelf" }),
    record("van", "stock-locations", { name: "Van" }),
  ];
  expect(physicalCountRows(records, [], org, "shelf", "abc123"))
    .toMatchObject([{ productName: "Soap", locationName: "Shelf", recordedUnits: "0" }]);
  expect(physicalCountRows(records, [], org, "", "cleaning")).toHaveLength(2);
  expect(physicalCountRows(records, [], org, "not-a-location")).toEqual([]);
  expect(physicalCountSheetCsv(records, [], org, "", "none").trimEnd()
    .split("\r\n")).toHaveLength(1);
});

it("escapes spreadsheet formulas and blocks invalid or duplicate balances", () => {
  const records = [
    record("item", "items", { name: "=SUM(1,1)", sku: "+BAD", barcode: "@SCAN" }),
    record("room", "stock-locations", { name: "-ROOM" }),
  ];
  const csv = physicalCountSheetCsv(records, [], org);
  expect(csv).toContain('"'+ "'"+'=SUM(1,1)"');
  expect(csv).toContain('"'+ "'"+'+BAD"');
  expect(csv).toContain('"'+ "'"+'@SCAN"');
  expect(csv).toContain('"'+ "'"+'-ROOM"');
  const balance = {
    organization_id: org, product_id: "item", location_id: "room", units: "4",
  };
  expect(() => physicalCountRows(records, [balance, balance], org))
    .toThrow("Duplicate recorded inventory balance");
  expect(() => physicalCountRows(records, [
    { ...balance, units: "-1" },
  ], org)).toThrow("Invalid recorded inventory balance");
  expect(physicalCountRows(records, [
    { ...balance, organization_id: other, units: "not-a-number" },
  ], org)).toHaveLength(1);
});
