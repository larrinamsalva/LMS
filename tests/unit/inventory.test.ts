import { expect, it } from "vitest";
import { stockUnits, stockSchema, lowStockAlerts } from "../../src/core/inventory";
import type { WorkspaceRecord } from "../../src/core/engine";
import {
  validateConfig,
  validateRecord,
  getEntity,
} from "../../src/core/config";
import { presets } from "../../src/presets";
it("converts cases and whole units exactly and checks bounded overflow", () => {
  expect(stockUnits("999999", "Cases", "1000000")).toBe("999999000000");
  expect(stockUnits("999999999999", "Units", "12")).toBe("999999999999");
  expect(stockUnits("3", "Cases", "12")).toBe("36");
  for (const [qty, pack, size] of [
    ["0", "Units", "1"],
    ["1.5", "Cases", "12"],
    ["01", "Units", "1"],
    ["1e2", "Units", "1"],
    ["-1", "Units", "1"],
    ["1000000", "Cases", "1000000"],
    ["1", "Cases", "0"],
    ["1", "Pallet", "12"],
  ])
    expect(() => stockUnits(qty, pack, size)).toThrow();
  for (const bad of [1, 1.2, " 2", "NaN", "1000000000000"])
    expect(stockSchema.safeParse(bad).success).toBe(false);
});
it("keeps catalog compatibility while requiring reviewed movement fields and scoped target contracts", () => {
  for (const preset of Object.values(presets))
    expect(validateConfig(preset)).toEqual(preset);
  const config = structuredClone(presets.cleaning),
    stock = getEntity(config, "stock-movements");
  stock.fields.find((f) => f.key === "product")!.target = "customers";
  expect(() => validateConfig(config)).toThrow();
  expect(
    validateRecord(getEntity(presets.property, "items"), {
      name: "Legacy description",
      unit: "Box",
    }),
  ).toEqual({ name: "Legacy description", unit: "Box" });
  expect(() =>
    validateRecord(getEntity(presets.cleaning, "items"), {
      name: "Bad case",
      case_size: "0",
    }),
  ).toThrow();
});


it("builds exact per-location shortages without changing balances or archived products", () => {
  const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const foreign = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const record = (id: string, entity: string, data: WorkspaceRecord["data"],
    archived = false, organization_id = org): WorkspaceRecord => ({
    id, entity, data, organization_id, archived, revision: 1,
    config_revision: 1, created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  });
  const records = [
    record("gloves", "items", { name: "Gloves", minimum: "25", unit: "glove" }),
    record("soap", "items", { name: "Soap", minimum: "0" }),
    record("retired", "items", { name: "Retired", minimum: "99" }, true),
    record("room", "stock-locations", { name: "Store room" }),
    record("van", "stock-locations", { name: "Van" }),
    record("closed", "stock-locations", { name: "Old cabinet" }, true),
    record("foreign-room", "stock-locations", { name: "Foreign location" }, false, foreign),
  ];
  const balances = [
    { organization_id: org, product_id: "gloves", location_id: "room", units: "21" },
    { organization_id: org, product_id: "gloves", location_id: "van", units: "25" },
    { organization_id: foreign, product_id: "gloves", location_id: "room", units: "999" },
  ];
  const before = structuredClone({ records, balances });
  expect(lowStockAlerts(records, balances)).toEqual([{
    productId: "gloves", productName: "Gloves", locationId: "room",
    locationName: "Store room", units: "21", minimum: "25",
    shortfall: "4", unit: "glove",
  }]);
  expect(lowStockAlerts(records, [])).toEqual([
    expect.objectContaining({ locationName: "Store room", shortfall: "25" }),
    expect.objectContaining({ locationName: "Van", shortfall: "25" }),
  ]);
  expect({ records, balances }).toEqual(before);
});

it("handles maximum whole-unit balances and ignores invalid or missing thresholds", () => {
  const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const record = (id: string, entity: string, data: WorkspaceRecord["data"]):
    WorkspaceRecord => ({
      id, entity, data, organization_id: org, archived: false, revision: 1,
      config_revision: 1, created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
  const base = [record("warehouse", "stock-locations", { name: "Warehouse" })];
  expect(lowStockAlerts([
    ...base, record("big", "items", {
      name: "Large stock", minimum: "999999999999", unit: "units",
    }),
  ], [{ organization_id: org, product_id: "big",
    location_id: "warehouse", units: "999999999998" }]))
    .toMatchObject([{ shortfall: "1", units: "999999999998" }]);
  expect(lowStockAlerts([
    ...base,
    record("unset", "items", { name: "No minimum" }),
    record("invalid", "items", { name: "Invalid minimum", minimum: "not-a-number" }),
  ], [])).toEqual([]);
});
