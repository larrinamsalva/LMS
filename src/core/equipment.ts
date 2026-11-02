import { z } from "zod";
import type { EntityDefinition, RecordData } from "./config";
import { normalizeInstant, localDate, shiftDate, instant } from "./time";
export class EquipmentError extends Error {}
export const equipmentConfirmation = "CONFIRM FICTIONAL EQUIPMENT ACTION";
export const retireEquipmentConfirmation = "RETIRE FICTIONAL EQUIPMENT";
export const releaseEquipmentConfirmation =
  "RETURN FICTIONAL EQUIPMENT TO SERVICE";
export const equipmentConditions = [
  "Serviceable",
  "Needs inspection",
  "Under maintenance",
  "Out of service",
  "Retired",
] as const;
export const equipmentDefinition: EntityDefinition = {
  id: "equipment",
  module: "equipment",
  singular: "Equipment item",
  plural: "Equipment & Tools",
  titleField: "name",
  fields: [
    { key: "name", label: "Equipment name", type: "text", required: true },
    {
      key: "asset_id",
      label: "Business equipment ID (permanent)",
      type: "text",
      required: true,
    },
    { key: "category", label: "Category", type: "text", required: false },
    {
      key: "description",
      label: "Description",
      type: "longtext",
      required: false,
    },
    {
      key: "manufacturer",
      label: "Manufacturer",
      type: "text",
      required: false,
    },
    { key: "model", label: "Model", type: "text", required: false },
    { key: "serial", label: "Serial number", type: "text", required: false },
    {
      key: "barcode",
      label: "Barcode / asset tag",
      type: "text",
      required: false,
    },
    {
      key: "purchased_on",
      label: "Purchase date",
      type: "date",
      required: false,
    },
    {
      key: "purchase_cost",
      label: "Purchase cost (USD, non-accounting)",
      type: "money",
      required: false,
    },
    {
      key: "location",
      label: "Storage location",
      type: "reference",
      required: true,
      target: "stock-locations",
    },
    {
      key: "notes",
      label: "Internal notes",
      type: "longtext",
      required: false,
    },
  ],
};
export function equipmentContract(entity: EntityDefinition) {
  if (entity.id !== "equipment") return entity.module !== "equipment";
  return (
    entity.module === "equipment" &&
    entity.titleField === "name" &&
    JSON.stringify(entity.fields) === JSON.stringify(equipmentDefinition.fields)
  );
}
export function validateEquipmentRecord(entity: string, data: RecordData) {
  if (entity !== "equipment") return;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(String(data.asset_id)))
    throw new EquipmentError(
      "Use a permanent equipment ID of 1–40 letters, digits, dots, underscores or hyphens.",
    );
  if (
    data.barcode &&
    !/^[A-Za-z0-9][A-Za-z0-9 ._:/+\-]{0,79}$/.test(String(data.barcode))
  )
    throw new EquipmentError(
      "Use up to 80 plain barcode/asset-tag characters.",
    );
  if (
    data.purchased_on &&
    (String(data.purchased_on) < "1900-01-01" ||
      String(data.purchased_on) > "2100-12-31")
  )
    throw new EquipmentError("Purchase dates must be within 1900–2100.");
}
const rev = z.number().int().min(1).max(2147483647);
const date = z.iso
  .date()
  .refine(
    (v) => v >= "2020-01-01" && v <= "2100-12-31",
    "Use a date within 2020–2100.",
  );
const timestamp = z.iso
  .datetime({ offset: true })
  .refine((v) => {
    try {
      const t = instant(v);
      return (
        t.epochNanoseconds % 60_000_000_000n === 0n &&
        v.slice(0, 4) >= "2020" &&
        v.slice(0, 4) <= "2100"
      );
    } catch {
      return false;
    }
  }, "Use an explicit-offset whole-minute time within 2020–2100.")
  .transform(normalizeInstant);
const common = {
  equipmentId: z.uuid(),
  revision: rev,
  configRevision: rev,
  acknowledgement: z.literal(equipmentConfirmation),
  notes: z.string().trim().min(8).max(1000),
};
const assignment = { checkoutId: z.uuid(), checkoutRevision: rev };
const inspection = {
  employeeId: z.uuid(),
  employeeRevision: rev,
  serviceDate: date,
  nextInspection: date.nullable(),
};
export const equipmentCommandSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        ...common,
        kind: z.literal("checkout"),
        employeeId: z.uuid(),
        employeeRevision: rev,
        resourceId: z.uuid().nullable(),
        resourceRevision: rev.nullable(),
        workId: z.uuid().nullable(),
        workRevision: rev.nullable(),
        checkedOutAt: timestamp,
        expectedReturnAt: timestamp,
      })
      .strict(),
    z
      .object({ ...common, ...assignment, kind: z.literal("begin-use") })
      .strict(),
    z
      .object({
        ...common,
        ...assignment,
        kind: z.literal("return"),
        returnedAt: timestamp,
        condition: z.enum([
          "Serviceable",
          "Needs inspection",
          "Out of service",
        ]),
      })
      .strict(),
    z
      .object({
        ...common,
        kind: z.literal("report-problem"),
        condition: z.enum(["Needs inspection", "Out of service"]),
      })
      .strict(),
    z
      .object({
        ...common,
        kind: z.literal("open-maintenance"),
        workId: z.uuid(),
        workRevision: rev,
      })
      .strict(),
    z
      .object({ ...common, ...inspection, kind: z.literal("record-service") })
      .strict(),
    z
      .object({
        ...common,
        ...inspection,
        kind: z.literal("release"),
        confirmation: z.literal(releaseEquipmentConfirmation),
      })
      .strict(),
    z
      .object({
        ...common,
        kind: z.literal("retire"),
        confirmation: z.literal(retireEquipmentConfirmation),
      })
      .strict(),
  ])
  .superRefine((p, ctx) => {
    const error = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (p.kind === "checkout") {
      if (
        (p.resourceId === null) !== (p.resourceRevision === null) ||
        (p.workId === null) !== (p.workRevision === null)
      )
        error("Related IDs and revisions must be reviewed together.");
      const duration =
        instant(p.expectedReturnAt).epochNanoseconds -
        instant(p.checkedOutAt).epochNanoseconds;
      if (duration <= 0n || duration > 366n * 86400_000_000_000n)
        error("Expected return must follow checkout within 366 days.");
    }
    if (
      (p.kind === "record-service" || p.kind === "release") &&
      p.nextInspection &&
      p.nextInspection <= p.serviceDate
    )
      error("Next inspection must follow the service/inspection date.");
  });
export type EquipmentCommand = z.infer<typeof equipmentCommandSchema>;
export interface EquipmentState {
  organization_id: string;
  record_id: string;
  revision: number;
  asset_key: string;
  barcode_key: string | null;
  condition: (typeof equipmentConditions)[number];
  maintenance:
    | "Initial inspection"
    | "Clear"
    | "Problem reported"
    | "Task opened"
    | "Service recorded"
    | "Retired";
  work_id: string | null;
  technician_id: string | null;
  last_service: string | null;
  next_inspection: string | null;
}
export interface EquipmentCheckout {
  organization_id: string;
  id: string;
  equipment_id: string;
  revision: number;
  employee_id: string;
  employee_revision: number;
  resource_id: string | null;
  membership_id: string | null;
  membership_revision: number | null;
  work_id: string | null;
  checked_out_at: string | Date;
  expected_return_at: string | Date;
  returned_at: string | Date | null;
  status: "Checked out" | "In use" | "Returned";
  return_condition: string | null;
  checked_out_by: string;
  returned_by: string | null;
}
export interface EquipmentEvent {
  organization_id: string;
  record_id: string;
  revision: number;
  config_revision: number;
  action: string;
  data: RecordData;
  state: EquipmentState;
  checkout: EquipmentCheckout | null;
  notes: string;
  actor_id: string;
  operation_id: string;
  occurred_at: string | Date;
}
export function equipmentStatus(
  state: EquipmentState,
  checkout?: EquipmentCheckout,
) {
  return checkout && !checkout.returned_at
    ? checkout.status
    : state.condition === "Serviceable"
      ? "Available"
      : state.condition;
}
export function equipmentIndicators(
  state: EquipmentState,
  checkout: EquipmentCheckout | undefined,
  now: string,
  zone: string,
) {
  const today = localDate(now, zone);
  return {
    overdue:
      !!checkout &&
      !checkout.returned_at &&
      instant(new Date(checkout.expected_return_at).toISOString())
        .epochNanoseconds < instant(now).epochNanoseconds,
    inspectionDue:
      !!state.next_inspection &&
      String(state.next_inspection).slice(0, 10) <= today,
    inspectionSoon:
      !!state.next_inspection &&
      String(state.next_inspection).slice(0, 10) > today &&
      String(state.next_inspection).slice(0, 10) <= shiftDate(today, 30),
  };
}
