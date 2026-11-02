import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  invoiceCommandSchema,
  invoiceLabel,
  correctInvoicePricing,
} from "../../src/core/invoices";
import {
  builderTemplate,
  selectModules,
  newBuildPlan,
  validateBuildPlan,
} from "../../src/core/buildplan";
import {
  calculateEstimate,
  estimateAcknowledgement,
  MAX_MINOR,
  type RateSnapshot,
  type EstimatePricing,
} from "../../src/core/pricing";
import {
  createBlueprintPackage,
  importBlueprintPackage,
} from "../../src/core/blueprint";
const rateId = randomUUID(),
  serviceId = randomUUID();
const snap: RateSnapshot = {
  serviceId,
  serviceRevision: 1,
  rateId,
  rateRevision: 1,
  name: "Fictional saved service",
  description: "Original",
  category: "Test",
  mode: "Hourly",
  unit: "hour",
  kind: "Service",
  parent: null,
  amountMinor: "1001",
  zoneId: randomUUID(),
  zoneName: "Saved service area",
  effectiveFrom: "2026-01-01",
  effectiveUntil: null,
};
function original(quantity = "0.5", snapshot = snap): EstimatePricing {
  const input = {
    currency: "USD" as const,
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
    discount: { kind: "None" as const, value: "0" },
    tax: { mode: "None" as const, basisPoints: "0", label: "" },
    acknowledgement: estimateAcknowledgement,
  };
  return {
    ...input,
    ...calculateEstimate(input, [snapshot]),
    customerName: "Snapshot customer",
    workTitle: "Historical work",
    appointmentTitle: "",
  };
}
it("keeps all historical starters opt-in and adds dependencies through existing module selection", () => {
  for (const template of ["cleaning", "property", "custom"] as const) {
    const before = newBuildPlan(template);
    expect(
      before.configuration.modules.some((m) => m.id === "invoice-drafts"),
    ).toBe(false);
    const enabled = selectModules(before.configuration, ["invoice-drafts"]);
    expect(enabled.modules.map((m) => m.id)).toEqual(
      expect.arrayContaining([
        "invoice-drafts",
        "estimates",
        "customers",
        "tasks",
      ]),
    );
    expect(
      validateBuildPlan({ ...before, configuration: enabled }),
    ).toMatchObject({ version: 1 });
    expect(validateBuildPlan(before)).toEqual(before);
  }
});
it("round-trips opt-in capability without changing v1 ZIP format or accepting altered core fields", async () => {
  const plan = newBuildPlan("property");
  plan.configuration = selectModules(plan.configuration, ["invoice-drafts"]);
  const bytes = await createBlueprintPackage(plan, {
    name: "Fictional draft blueprint",
    description: "Optional unissued draft capability",
  });
  expect((await importBlueprintPackage(bytes)).plan).toEqual(plan);
  plan.configuration.entities.find(
    (e) => e.id === "invoice-drafts",
  )!.fields[0].type = "email";
  expect(() => validateBuildPlan(plan)).toThrow();
});
it.each(["Fixed", "Hourly", "Per unit", "Quantity"] as const)(
  "uses existing exact arithmetic for %s saved snapshots",
  (mode) => {
    const p = original("1", { ...snap, mode });
    const q = mode === "Fixed" ? "1" : "0.5";
    const next = correctInvoicePricing(p, {
      ...p,
      lines: p.lines.map((l) => ({ ...l, quantity: q })),
    });
    expect(next.totalMinor).toBe(mode === "Fixed" ? "1001" : "501");
    expect(next.lines[0].snapshot).toEqual(p.lines[0].snapshot);
  },
);
it("uses exact half-up line, percentage discount and exclusive manual tax rounding", () => {
  const p = original();
  const next = correctInvoicePricing(p, {
    ...p,
    discount: { kind: "Percent", value: "1000" },
    tax: {
      mode: "Manual",
      basisPoints: "825",
      label: "Fictional configured tax",
    },
  });
  expect(next).toMatchObject({
    subtotalMinor: "501",
    discountMinor: "50",
    taxMinor: "37",
    totalMinor: "488",
  });
});
it.each(["0", "-1", "1e3", "0.0001", "1000000.001"])(
  "rejects invalid invoice quantity %s",
  (quantity) => {
    const p = original();
    expect(() =>
      correctInvoicePricing(p, {
        ...p,
        lines: p.lines.map((l) => ({ ...l, quantity })),
      }),
    ).toThrow();
  },
);
it("refuses overflow, fixed quantity changes, missing base extras, changed lines or forged source rates", () => {
  const p = original();
  for (const input of [
    { ...p, lines: [] },
    { ...p, lines: p.lines.map((l) => ({ ...l, id: randomUUID() })) },
    { ...p, lines: p.lines.map((l) => ({ ...l, rateRevision: 2 })) },
  ])
    expect(() => correctInvoicePricing(p, input)).toThrow();
  const huge = original("1", { ...snap, amountMinor: MAX_MINOR.toString() });
  expect(() =>
    correctInvoicePricing(huge, {
      ...huge,
      lines: huge.lines.map((l) => ({ ...l, quantity: "2" })),
    }),
  ).toThrow();
  expect(() => original("2", { ...snap, mode: "Fixed" })).toThrow();
  expect(() =>
    original("1", { ...snap, kind: "Extra", parent: randomUUID() }),
  ).toThrow();
});
it("requires an explicit fictional acknowledgement and rejects authority, SQL and issuance fields", () => {
  const req = {
    kind: "convert",
    estimateId: randomUUID(),
    estimateRevision: 2,
    configRevision: 1,
    acknowledgement: invoiceLabel,
  };
  expect(invoiceCommandSchema.parse(req)).toEqual(req);
  for (const input of [
    { ...req, sql: "select 1" },
    { ...req, userId: randomUUID() },
    { ...req, issue: true },
    { ...req, acknowledgement: "SEND" },
    { ...req, estimateRevision: 0 },
  ])
    expect(() => invoiceCommandSchema.parse(input)).toThrow();
  const config = builderTemplate("property");
  config.modules.push({ id: "invoice-drafts", version: "1.0.0" });
  expect(() =>
    validateBuildPlan({ ...newBuildPlan("property"), configuration: config }),
  ).toThrow();
});
