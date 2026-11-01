import { expect, it } from "vitest";
import { stockUnits, stockSchema } from "../../src/core/inventory";
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
