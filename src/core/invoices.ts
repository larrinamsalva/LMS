import { z } from "zod";
import type { BusinessConfig, EntityDefinition, RecordData } from "./config";
import {
  estimateInputSchema,
  calculateEstimate,
  type EstimatePricing,
} from "./pricing";
export const invoiceLabel = "FICTIONAL DRAFT — NOT ISSUED";
const revision = z.number().int().min(1).max(2147483647);
const common = {
  configRevision: revision,
  acknowledgement: z.literal(invoiceLabel),
};
const reason = z.string().trim().min(8).max(500);
export const invoiceCommandSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...common,
      kind: z.literal("convert"),
      estimateId: z.uuid(),
      estimateRevision: revision,
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("correct"),
      invoiceId: z.uuid(),
      revision,
      reason,
      notes: z.string().trim().max(4000),
      pricing: estimateInputSchema,
    })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal("void"),
      invoiceId: z.uuid(),
      revision,
      reason,
    })
    .strict(),
]);
export type InvoiceCommand = z.infer<typeof invoiceCommandSchema>;
export interface InvoiceVersion {
  organization_id: string;
  record_id: string;
  revision: number;
  config_revision: number;
  data: RecordData;
  actor_id: string;
  operation_id: string;
  occurred_at: Date | string;
}
/** A reviewed optional module extension; absent from all historical starter configurations. */
export function invoiceDefinition(config: BusinessConfig): EntityDefinition {
  const estimate = config.entities.find((e) => e.id === "estimates")!;
  return {
    id: "invoice-drafts",
    module: "invoice-drafts",
    singular: "Invoice draft",
    plural: "Invoice Drafts",
    titleField: "title",
    fields: [
      {
        key: "notice",
        label: "Unissued draft notice",
        type: "text",
        required: true,
      },
      { key: "title", label: "Draft title", type: "text", required: true },
      ...estimate.fields
        .filter((f) =>
          ["customer", "work", "appointment", "zone", "as_of"].includes(f.key),
        )
        .map((f) => ({ ...f })),
      {
        key: "estimate",
        label: "Originating estimate",
        type: "reference",
        target: "estimates",
        required: true,
      },
      {
        key: "estimate_revision",
        label: "Estimate revision",
        type: "number",
        required: true,
      },
      {
        key: "status",
        label: "Draft status",
        type: "select",
        options: ["Draft", "Void"],
        required: true,
      },
      {
        key: "pricing",
        label: "Saved pricing",
        type: "estimate",
        required: true,
      },
      {
        key: "notes",
        label: "Internal notes",
        type: "longtext",
        required: false,
      },
      {
        key: "reason",
        label: "Revision reason",
        type: "longtext",
        required: true,
      },
    ].map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type as EntityDefinition["fields"][number]["type"],
      required: f.required,
      ...("options" in f ? { options: f.options } : {}),
      ...("target" in f ? { target: f.target } : {}),
    })),
  };
}
export function invoiceContract(
  entity: EntityDefinition,
  config: BusinessConfig,
) {
  if (entity.id !== "invoice-drafts") return entity.module !== "invoice-drafts";
  if (!config.entities.some((e) => e.id === "estimates")) return false;
  const expected = invoiceDefinition(config);
  return (
    entity.module === expected.module &&
    entity.titleField === expected.titleField &&
    JSON.stringify(entity.fields) === JSON.stringify(expected.fields)
  );
}
/** Uses the same calculator and saved snapshots, never today's service catalog. */
export function correctInvoicePricing(
  original: EstimatePricing,
  input: unknown,
): EstimatePricing {
  const clean = estimateInputSchema.parse(input);
  if (
    clean.lines.length !== original.lines.length ||
    clean.lines.some((l, i) => l.id !== original.lines[i].id)
  )
    throw new Error(
      "Retain the saved lines and their order; this phase supports quantity, line-note, discount and manual-tax corrections only.",
    );
  return {
    ...original,
    ...clean,
    ...calculateEstimate(
      clean,
      original.lines.map((l) => l.snapshot),
    ),
  };
}
