import { z } from "zod";
import type { EntityDefinition, RecordData } from "./config";
export const pricingEntities = [
  "pricing-zones",
  "services",
  "service-rates",
  "estimates",
];
export const pricingModes = [
  "Fixed",
  "Hourly",
  "Per unit",
  "Quantity",
] as const;
export const estimateStatuses = ["Draft", "Reviewed draft", "Void"] as const;
export const estimateAcknowledgement = "FICTIONAL DRAFT ONLY" as const;
export const MAX_MINOR = 999_999_999_999n;
export class PricingError extends Error {}
const integer = /^(0|[1-9]\d*)$/;
export const minorSchema = z.string().regex(/^(0|[1-9]\d{0,11})$/);
export function decimalToMinor(value: string): string {
  if (!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(value))
    throw new PricingError(
      "Use a nonnegative USD amount with at most two decimal places.",
    );
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (result > MAX_MINOR)
    throw new PricingError("Amount exceeds the supported limit.");
  return result.toString();
}
export function minorToDecimal(value: string) {
  if (!minorSchema.safeParse(value).success)
    throw new PricingError("Invalid minor-unit amount.");
  return `${BigInt(value) / 100n}.${(BigInt(value) % 100n).toString().padStart(2, "0")}`;
}
export const money = (value: string) => `USD ${minorToDecimal(value)}`;
export function quantityUnits(value: string): bigint {
  if (!/^(0|[1-9]\d{0,6})(\.\d{1,3})?$/.test(value))
    throw new PricingError(
      "Quantity must be positive, up to 1,000,000 with three decimal places.",
    );
  const [whole, fraction = ""] = value.split(".");
  const scaled = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
  if (scaled <= 0n || scaled > 1_000_000_000n)
    throw new PricingError("Quantity is outside the supported range.");
  return scaled;
}
export function normalizeQuantity(value: string) {
  const units = quantityUnits(value),
    part = (units % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return (units / 1000n).toString() + (part ? "." + part : "");
}
const quantity = z
  .string()
  .refine((v) => {
    try {
      quantityUnits(v);
      return true;
    } catch {
      return false;
    }
  }, "Invalid quantity")
  .transform(normalizeQuantity);
const basisPoints = z
  .string()
  .regex(/^(0|[1-9]\d{0,4})$/)
  .refine((v) => BigInt(v) <= 10000n, "Use 0–10000 basis points.");
export const estimateInputSchema = z
  .object({
    currency: z.literal("USD"),
    lines: z
      .array(
        z.object({
          id: z.uuid(),
          rateId: z.uuid(),
          rateRevision: z.number().int().min(1).max(2147483647),
          serviceRevision: z.number().int().min(1).max(2147483647),
          quantity,
          note: z.string().trim().max(500).default(""),
        }),
      )
      .min(1)
      .max(10),
    discount: z
      .object({
        kind: z.enum(["None", "Amount", "Percent"]),
        value: minorSchema,
      })
      .strict(),
    tax: z
      .object({
        mode: z.enum(["None", "Manual"]),
        basisPoints,
        label: z.string().trim().max(80),
      })
      .strict(),
    acknowledgement: z.literal(estimateAcknowledgement),
  })
  .superRefine((p, ctx) => {
    const error = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (new Set(p.lines.map((l) => l.id)).size !== p.lines.length)
      error("Line identifiers must be unique.");
    if (p.discount.kind === "None" && p.discount.value !== "0")
      error("No discount requires a zero value.");
    if (p.discount.kind === "Percent" && BigInt(p.discount.value) > 10000n)
      error("Discount cannot exceed 100%.");
    if (
      p.tax.mode === "None" &&
      (p.tax.basisPoints !== "0" || p.tax.label !== "")
    )
      error("No tax requires zero rate and an empty label.");
    if (p.tax.mode === "Manual" && !p.tax.label)
      error("Label the manually configured tax.");
  });
export type EstimateInput = z.infer<typeof estimateInputSchema>;
export interface RateSnapshot {
  serviceId: string;
  serviceRevision: number;
  rateId: string;
  rateRevision: number;
  name: string;
  description: string;
  category: string;
  mode: (typeof pricingModes)[number];
  unit: string;
  kind: "Service" | "Extra";
  parent: string | null;
  amountMinor: string;
  zoneId: string;
  zoneName: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
}
export interface EstimatePricing extends EstimateInput {
  lines: (EstimateInput["lines"][number] & {
    snapshot: RateSnapshot;
    amountMinor: string;
  })[];
  customerName: string;
  workTitle: string;
  appointmentTitle: string;
  subtotalMinor: string;
  discountMinor: string;
  taxMinor: string;
  totalMinor: string;
}
export interface EstimateVersion {
  organization_id: string;
  record_id: string;
  revision: number;
  data: RecordData;
  archived: boolean;
  occurred_at: Date | string;
}
const bounded = (n: bigint) => {
  if (n < 0n || n > MAX_MINOR)
    throw new PricingError("Calculated amount exceeds the supported limit.");
  return n;
};
const round = (n: bigint, d: bigint) => (n + d / 2n) / d;
/** Nonnegative exact integers only. Half-up per line, then discount, then exclusive tax on net. */
export function calculateEstimate(
  input: EstimateInput,
  snapshots: RateSnapshot[],
) {
  const clean = estimateInputSchema.parse(input);
  const lines = clean.lines.map((l, index) => {
    const snapshot = snapshots[index];
    if (
      !snapshot ||
      snapshot.rateId !== l.rateId ||
      snapshot.rateRevision !== l.rateRevision ||
      snapshot.serviceRevision !== l.serviceRevision
    )
      throw new PricingError(
        "Select an available rate or retain its saved snapshot.",
      );
    const units = quantityUnits(l.quantity);
    if (snapshot.mode === "Fixed" && units !== 1000n)
      throw new PricingError("Fixed-price services require quantity 1.");
    const price = BigInt(minorSchema.parse(snapshot.amountMinor));
    return {
      ...l,
      snapshot,
      amountMinor: bounded(round(price * units, 1000n)).toString(),
    };
  });
  for (const l of lines)
    if (
      l.snapshot.kind === "Extra" &&
      !lines.some(
        (base) =>
          base.snapshot.kind === "Service" &&
          base.snapshot.serviceId === l.snapshot.parent,
      )
    )
      throw new PricingError("An extra requires its matching base service.");
  const subtotal = bounded(
    lines.reduce((n, l) => n + BigInt(l.amountMinor), 0n),
  );
  const discount =
    clean.discount.kind === "None"
      ? 0n
      : clean.discount.kind === "Amount"
        ? BigInt(clean.discount.value)
        : round(subtotal * BigInt(clean.discount.value), 10000n);
  if (discount > subtotal)
    throw new PricingError("Discount cannot exceed the subtotal.");
  const tax =
    clean.tax.mode === "None"
      ? 0n
      : round((subtotal - discount) * BigInt(clean.tax.basisPoints), 10000n);
  return {
    lines,
    subtotalMinor: subtotal.toString(),
    discountMinor: discount.toString(),
    taxMinor: bounded(tax).toString(),
    totalMinor: bounded(subtotal - discount + tax).toString(),
  };
}
export function pricingContract(entity: EntityDefinition) {
  if (!pricingEntities.includes(entity.id))
    return entity.fields.every((f) => f.type !== "estimate");
  const required: Record<string, string> =
    entity.id === "pricing-zones"
      ? { name: "text" }
      : entity.id === "services"
        ? { name: "text", mode: "select", unit: "text", kind: "select" }
        : entity.id === "service-rates"
          ? {
              title: "text",
              service: "reference",
              zone: "reference",
              amount: "money",
              effective_from: "date",
            }
          : {
              title: "text",
              customer: "reference",
              zone: "reference",
              as_of: "date",
              status: "select",
              pricing: "estimate",
            };
  const refs =
    entity.id === "service-rates"
      ? { service: "services", zone: "pricing-zones" }
      : entity.id === "estimates"
        ? { customer: "customers", zone: "pricing-zones" }
        : entity.id === "services"
          ? { parent: "services" }
          : {};
  return (
    entity.module === "estimates" &&
    Object.entries(required).every(([key, type]) =>
      entity.fields.some((f) => f.key === key && f.type === type && f.required),
    ) &&
    Object.entries(refs).every(([key, target]) =>
      entity.fields.some(
        (f) => f.key === key && f.type === "reference" && f.target === target,
      ),
    ) &&
    entity.fields.every(
      (f) =>
        f.type !== "estimate" ||
        (entity.id === "estimates" && f.key === "pricing"),
    ) &&
    (entity.id !== "services" ||
      (JSON.stringify(entity.fields.find((f) => f.key === "mode")?.options) ===
        JSON.stringify(pricingModes) &&
        JSON.stringify(entity.fields.find((f) => f.key === "kind")?.options) ===
          JSON.stringify(["Service", "Extra"]))) &&
    (entity.id !== "estimates" ||
      JSON.stringify(entity.fields.find((f) => f.key === "status")?.options) ===
        JSON.stringify(estimateStatuses))
  );
}
export function validatePricingRecord(entity: string, data: RecordData) {
  if (entity === "services" && (data.kind === "Extra") !== !!data.parent)
    throw new PricingError("Only extras require a parent service.");
  if (
    entity === "service-rates" &&
    (String(data.effective_from) < "2020-01-01" ||
      String(data.effective_from) > "2100-12-31" ||
      (data.effective_until &&
        (String(data.effective_until) <= String(data.effective_from) ||
          String(data.effective_until) > "2101-01-01")))
  )
    throw new PricingError(
      "Use a positive effective date range within 2020–2100.",
    );
  if (
    entity === "estimates" &&
    (String(data.as_of) < "2020-01-01" || String(data.as_of) > "2100-12-31")
  )
    throw new PricingError("Use an estimate pricing date within 2020–2100.");
}
