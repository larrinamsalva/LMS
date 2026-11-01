import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  decimalToMinor,
  minorToDecimal,
  quantityUnits,
  calculateEstimate,
  estimateInputSchema,
  estimateAcknowledgement,
  type EstimateInput,
  type RateSnapshot,
} from "../../src/core/pricing";
const rateId = randomUUID(),
  serviceId = randomUUID(),
  zoneId = randomUUID();
const snapshot: RateSnapshot = {
  rateId,
  rateRevision: 1,
  serviceId,
  serviceRevision: 1,
  zoneId,
  zoneName: "Local",
  name: "Service",
  description: "Original",
  category: "",
  mode: "Hourly",
  unit: "hour",
  kind: "Service",
  parent: null,
  amountMinor: "1001",
  effectiveFrom: "2026-01-01",
  effectiveUntil: null,
};
const input = (quantity = "1"): EstimateInput => ({
  currency: "USD",
  lines: [
    {
      id: randomUUID(),
      rateId,
      rateRevision: 1,
      serviceRevision: 1,
      quantity,
      note: "",
    },
  ],
  discount: { kind: "None", value: "0" },
  tax: { mode: "None", basisPoints: "0", label: "" },
  acknowledgement: estimateAcknowledgement,
});
it("converts exact USD strings without binary floating point and rejects ambiguous input", () => {
  expect(decimalToMinor("0.10")).toBe("10");
  expect(decimalToMinor("9999999999.99")).toBe("999999999999");
  expect(minorToDecimal("1")).toBe("0.01");
  for (const s of [
    "1e2",
    "1.001",
    "-1",
    "NaN",
    "Infinity",
    "01.00",
    "1,000",
    " 1",
    "10000000000",
  ])
    expect(() => decimalToMinor(s)).toThrow();
});
it("rounds each fractional line half up, then an explicit discount and tax on the net", () => {
  const p = input("0.5");
  p.discount = { kind: "Percent", value: "1000" };
  p.tax = { mode: "Manual", basisPoints: "825", label: "Fictional manual tax" };
  expect(calculateEstimate(p, [snapshot])).toMatchObject({
    subtotalMinor: "501",
    discountMinor: "50",
    taxMinor: "37",
    totalMinor: "488",
  });
});
it("sums individually rounded pennies, supports free services and refuses a negative net or overflow", () => {
  const p = input("0.5");
  p.lines.push({ ...p.lines[0], id: randomUUID() });
  expect(
    calculateEstimate(p, [
      { ...snapshot, amountMinor: "1" },
      { ...snapshot, amountMinor: "1" },
    ]).subtotalMinor,
  ).toBe("2");
  expect(
    calculateEstimate(input(), [{ ...snapshot, amountMinor: "0" }]).totalMinor,
  ).toBe("0");
  expect(() =>
    calculateEstimate(
      { ...input(), discount: { kind: "Amount", value: "1002" } },
      [snapshot],
    ),
  ).toThrow(/Discount/);
  expect(() =>
    calculateEstimate(input("1000000"), [
      { ...snapshot, amountMinor: "999999999999" },
    ]),
  ).toThrow(/limit/);
});
it("validates fractional quantities and a fixed service quantity of one", () => {
  expect(quantityUnits("0.125")).toBe(125n);
  expect(() => quantityUnits("0")).toThrow();
  expect(() => quantityUnits("1.0001")).toThrow();
  expect(() => quantityUnits("1000000.001")).toThrow();
  expect(() =>
    calculateEstimate(input("2"), [{ ...snapshot, mode: "Fixed" }]),
  ).toThrow(/quantity 1/);
});
it("requires the matching base for an extra and strict manual-tax/discount/confirmation input", () => {
  expect(() =>
    calculateEstimate(input(), [
      { ...snapshot, kind: "Extra", parent: randomUUID() },
    ]),
  ).toThrow(/base service/);
  for (const p of [
    { ...input(), acknowledgement: "APPROVE PAYMENT" },
    { ...input(), tax: { mode: "None", basisPoints: "10", label: "" } },
    { ...input(), discount: { kind: "Percent", value: "10001" } },
  ])
    expect(() => estimateInputSchema.parse(p)).toThrow();
  const p = input();
  p.lines.push(p.lines[0]);
  expect(() => estimateInputSchema.parse(p)).toThrow();
});
