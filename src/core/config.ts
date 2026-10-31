import { z } from "zod";
import {
  isTimeZone,
  normalizeInstant,
  validateAppointment,
  appointmentStatuses,
} from "./time";
import { moduleById } from "../modules/registry";
const reserved = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "organization_id",
  "id",
  "revision",
  "created_by",
  "updated_by",
]);
const key = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,39}$/)
  .refine((v) => !reserved.has(v), "Reserved identifier");
const label = z.string().trim().min(1).max(80);
export const fieldSchema = z
  .object({
    key,
    label,
    type: z.enum([
      "text",
      "longtext",
      "email",
      "date",
      "number",
      "select",
      "reference",
      "datetime",
    ]),
    required: z.boolean(),
    options: z.array(label).min(1).max(20).optional(),
    target: key.optional(),
  })
  .strict()
  .superRefine((f, ctx) => {
    if ((f.type === "select") !== !!f.options)
      ctx.addIssue({
        code: "custom",
        message: "Only select fields must have options.",
      });
    if ((f.type === "reference") !== !!f.target)
      ctx.addIssue({
        code: "custom",
        message: "Only reference fields must name a target entity.",
      });
    if (f.options && new Set(f.options).size !== f.options.length)
      ctx.addIssue({ code: "custom", message: "Duplicate options." });
  });
export const entitySchema = z
  .object({
    id: key,
    module: key,
    singular: label,
    plural: label,
    titleField: key,
    fields: z.array(fieldSchema).min(1).max(16),
  })
  .strict()
  .superRefine((entity, ctx) => {
    const keys = entity.fields.map((f) => f.key);
    if (new Set(keys).size !== keys.length || !keys.includes(entity.titleField))
      ctx.addIssue({
        code: "custom",
        message: "Fields must be unique and include titleField.",
      });
    const title = entity.fields.find((f) => f.key === entity.titleField);
    if (title && (!title.required || !["text", "email"].includes(title.type)))
      ctx.addIssue({
        code: "custom",
        message: "Title must be required text or email.",
      });
  });
export const businessConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: key,
    name: label,
    timeZone: z
      .string()
      .max(80)
      .refine(isTimeZone, "Use an IANA business time zone.")
      .optional(),
    industry: z.enum(["property", "cleaning", "custom"]),
    modules: z
      .array(z.object({ id: key, version: z.literal("1.0.0") }).strict())
      .min(1)
      .max(12),
    entities: z.array(entitySchema).min(1).max(20),
    navigation: z.array(key).min(1).max(20),
  })
  .strict()
  .superRefine((config, ctx) => {
    const enabled = new Set(config.modules.map((m) => m.id));
    const error = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (enabled.size !== config.modules.length) error("Duplicate modules.");
    for (const m of config.modules) {
      const manifest = moduleById.get(m.id);
      if (
        !manifest ||
        manifest.version !== m.version ||
        manifest.engineApi !== 1
      )
        error(`Unsupported module ${m.id}.`);
      if (manifest?.dependencies.some((d) => !enabled.has(d)))
        error(`Missing dependencies for ${m.id}.`);
    }
    const ids = config.entities.map((e) => e.id);
    if (
      new Set(ids).size !== ids.length ||
      new Set(config.navigation).size !== config.navigation.length
    )
      error("Duplicate entity or navigation.");
    for (const entity of config.entities) {
      const manifest = moduleById.get(entity.module);
      if (
        !manifest ||
        !(
          manifest.entities.includes(entity.id) ||
          (entity.module === "custom-records" &&
            entity.id.startsWith("custom-"))
        )
      )
        error(`Entity ${entity.id} is not provided by ${entity.module}.`);
    }
    for (const entity of config.entities) {
      for (const field of entity.fields.filter((f) => f.type === "reference")) {
        const target = config.entities.find((e) => e.id === field.target);
        if (
          !target ||
          (field.required &&
            enabled.has(entity.module) &&
            !enabled.has(target.module))
        )
          error(`Reference target ${field.target} is unavailable.`);
      }
      if (entity.id === "appointments") {
        if (
          JSON.stringify(
            entity.fields.find((f) => f.key === "status")?.options,
          ) !== JSON.stringify(appointmentStatuses)
        )
          error("Scheduling status options must match the module contract.");

        const work = config.entities.find(
          (e) => e.id === entity.fields.find((f) => f.key === "work")?.target,
        );
        if (
          !work?.fields.some(
            (f) =>
              f.key === "customer" &&
              f.type === "reference" &&
              f.target === "customers",
          )
        )
          error("Scheduled work needs a customer reference.");
        const required = {
          title: "text",
          customer: "reference",
          work: "reference",
          resource: "reference",
          start: "datetime",
          end: "datetime",
          scheduled_date: "date",
          time_zone: "text",
          status: "select",
        };
        for (const [key, type] of Object.entries(required))
          if (
            !entity.fields.some(
              (f) => f.key === key && f.type === type && f.required,
            )
          )
            error(`Scheduling requires ${key}.`);
        if (
          entity.fields.find((f) => f.key === "customer")?.target !==
            "customers" ||
          entity.fields.find((f) => f.key === "resource")?.target !==
            "resources"
        )
          error("Scheduling needs customer and resource targets.");
      }
    }
    for (const id of config.navigation) {
      const entity = config.entities.find((e) => e.id === id);
      if (!entity || !enabled.has(entity.module))
        error(`Navigation ${id} is unavailable.`);
    }
    for (const entity of config.entities)
      if (enabled.has(entity.module) && !config.navigation.includes(entity.id))
        error(`Enabled entity ${entity.id} needs navigation.`);
  });
export class ConfigurationError extends Error {}
export type BusinessConfig = z.infer<typeof businessConfigSchema>;
export type EntityDefinition = z.infer<typeof entitySchema>;
export type FieldDefinition = z.infer<typeof fieldSchema>;
export type RecordData = Record<string, string | number>;
export const validateConfig = (value: unknown): BusinessConfig =>
  businessConfigSchema.parse(value);
export const activeEntities = (config: BusinessConfig) =>
  config.entities.filter((e) => config.modules.some((m) => m.id === e.module));
export function getEntity(
  config: BusinessConfig,
  entityId: string,
): EntityDefinition {
  const entity = activeEntities(config).find((e) => e.id === entityId);
  if (!entity) throw new ConfigurationError("Module or entity is disabled.");
  return entity;
}
export function validateRecord(
  entity: EntityDefinition,
  value: unknown,
): RecordData {
  const fields: Record<string, z.ZodType> = {};
  for (const field of entity.fields) {
    let schema: z.ZodType =
      field.type === "reference"
        ? z.uuid()
        : field.type === "datetime"
          ? z.iso.datetime({ offset: true })
          : field.type === "number"
            ? z.number().finite().min(0).max(1000000)
            : field.type === "select"
              ? z.enum(field.options as [string, ...string[]])
              : field.type === "date"
                ? z.iso.date()
                : field.type === "email"
                  ? z.email().max(254)
                  : z
                      .string()
                      .trim()
                      .max(field.type === "longtext" ? 2000 : 200)
                      .min(field.required ? 1 : 0);
    if (!field.required) schema = z.union([schema, z.literal("")]).optional();
    fields[field.key] = schema;
  }
  const result = z.object(fields).strict().parse(value) as RecordData;
  for (const field of entity.fields)
    if (field.type === "datetime" && result[field.key])
      result[field.key] = normalizeInstant(String(result[field.key]));
  if (entity.id === "appointments") validateAppointment(result);
  return result;
}
