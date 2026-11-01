import { z } from "zod";
import { brandingSchema, type Branding } from "./branding";
import {
  ConfigurationError,
  validateConfig,
  type BusinessConfig,
  type EntityDefinition,
  type FieldDefinition,
} from "./config";
import { presets } from "../presets";
import { manifests, moduleById } from "../modules/registry";
export const BUILD_PLAN_LIMIT = 49152;
export const publishPlanConfirmation = "PUBLISH FICTIONAL CONFIGURATION";
export const templates = ["property", "cleaning", "custom"] as const;
export type Template = (typeof templates)[number];
export const customFieldTypes = [
  "text",
  "longtext",
  "email",
  "date",
  "number",
] as const;
export const customFieldEntities = [
  "customers",
  "tasks",
  "jobs",
  "units",
  "custom-notes",
];
const notes: EntityDefinition = {
  id: "custom-notes",
  module: "custom-records",
  singular: "Custom note",
  plural: "Custom notes",
  titleField: "title",
  fields: [
    { key: "title", label: "Title", type: "text", required: true },
    { key: "notes", label: "Notes", type: "longtext", required: false },
  ],
};
export function builderTemplate(template: Template): BusinessConfig {
  const config = structuredClone(
    template === "cleaning" ? presets.cleaning : presets.property,
  );
  if (template === "custom") {
    config.id = "custom-starter";
    config.industry = "custom";
    config.name = "My fictional business";
    config.entities = config.entities
      .filter((e) => e.id !== "units")
      .map((e) => ({
        ...e,
        fields: e.fields.filter((f) => f.target !== "units"),
        ...(e.id === "tasks"
          ? { singular: "Work item", plural: "Work items" }
          : {}),
      }));
    config.modules = config.modules.filter((m) => m.id !== "property");
    config.navigation = config.navigation.filter((id) => id !== "units");
  }
  config.entities.push(structuredClone(notes));
  return validateConfig(config);
}
export function moduleRequirements(
  config: BusinessConfig,
  id: string,
): string[] {
  const deps = new Set(moduleById.get(id)?.dependencies ?? []);
  for (const entity of config.entities.filter((e) => e.module === id))
    for (const field of entity.fields.filter(
      (f) => f.type === "reference" && f.required,
    )) {
      const target = config.entities.find((e) => e.id === field.target);
      if (target && target.module !== id) deps.add(target.module);
    }
  return [...deps];
}
export function selectModules(
  config: BusinessConfig,
  choices: string[],
): BusinessConfig {
  const available = new Set(config.entities.map((e) => e.module)),
    selected = new Set([...choices, "customers", "tasks"]);
  for (const id of selected) {
    if (!available.has(id) || !moduleById.has(id))
      throw new ConfigurationError(
        "This feature is unavailable in this template.",
      );
    for (const dep of moduleRequirements(config, id)) selected.add(dep);
  }
  return validateConfig({
    ...config,
    modules: manifests
      .filter((m) => selected.has(m.id))
      .map((m) => ({ id: m.id, version: m.version })),
    navigation: [
      ...config.navigation.filter((id) =>
        selected.has(config.entities.find((e) => e.id === id)!.module),
      ),
      ...config.entities
        .filter(
          (e) => selected.has(e.module) && !config.navigation.includes(e.id),
        )
        .map((e) => e.id),
    ],
  });
}
const envelope = z
  .object({
    format: z.literal("lms-build-plan"),
    version: z.union([z.literal(1), z.literal(2)]),
    engineApi: z.literal(1),
    templateVersion: z.literal(1),
    template: z.enum(templates),
    configuration: z.unknown(),
  })
  .strict();
export interface BuildPlan {
  format: "lms-build-plan";
  version: 1 | 2;
  engineApi: 1;
  templateVersion: 1;
  template: Template;
  configuration: BusinessConfig;
}
export function validateBuildPlan(input: unknown): BuildPlan {
  const raw = envelope.parse(input),
    config = validateConfig(raw.configuration),
    base = builderTemplate(raw.template);
  if (raw.version !== config.schemaVersion)
    throw new ConfigurationError(
      "BuildPlan 1 needs configuration schema 1; branded BuildPlan 2 needs schema 2.",
    );
  if (config.industry !== raw.template)
    throw new ConfigurationError("BuildPlan template and industry differ.");
  if (
    !["customers", "tasks"].every((id) =>
      config.modules.some((m) => m.id === id),
    )
  )
    throw new ConfigurationError(
      "BuildPlan needs Customers and Tasks as its safe foundation.",
    );
  if (config.entities.length !== base.entities.length)
    throw new ConfigurationError(
      "This BuildPlan contains unsupported entities. Use the reviewed templates.",
    );
  let extraCount = 0;
  for (const entity of config.entities) {
    const original = base.entities.find((e) => e.id === entity.id);
    if (
      !original ||
      entity.module !== original.module ||
      entity.titleField !== original.titleField
    )
      throw new ConfigurationError(
        "BuildPlan cannot replace reviewed entity identities.",
      );
    for (const field of original.fields)
      if (
        JSON.stringify(entity.fields.find((f) => f.key === field.key)) !==
        JSON.stringify(field)
      )
        throw new ConfigurationError(
          "Core field definitions are locked. Add a supported optional field instead.",
        );
    for (const field of entity.fields.filter(
      (f) => !original.fields.some((o) => o.key === f.key),
    )) {
      extraCount++;
      if (
        !customFieldEntities.includes(entity.id) ||
        !/^extra_[a-z0-9_]{1,30}$/.test(field.key) ||
        field.required ||
        !customFieldTypes.includes(
          field.type as (typeof customFieldTypes)[number],
        )
      )
        throw new ConfigurationError(
          "Only supported optional extra fields are allowed.",
        );
    }
  }
  if (extraCount > 4)
    throw new ConfigurationError(
      "This phase supports four optional custom fields per plan.",
    );
  const result = { ...raw, configuration: config } as BuildPlan;
  if (
    new TextEncoder().encode(JSON.stringify(result)).length > BUILD_PLAN_LIMIT
  )
    throw new ConfigurationError("BuildPlan exceeds the 48 KiB limit.");
  return result;
}
export function newBuildPlan(template: Template): BuildPlan {
  return validateBuildPlan({
    format: "lms-build-plan",
    version: 1,
    engineApi: 1,
    templateVersion: 1,
    template,
    configuration: builderTemplate(template),
  });
}
export function planForConfig(config: BusinessConfig): BuildPlan {
  const next = structuredClone(config);
  if (!next.entities.some((e) => e.id === notes.id)) {
    next.entities.push(structuredClone(notes));
    if (next.modules.some((m) => m.id === notes.module))
      next.navigation.push(notes.id);
  }
  return validateBuildPlan({
    ...newBuildPlan(config.industry),
    version: config.schemaVersion,
    configuration: next,
  });
}
export function brandBuildPlan(plan: BuildPlan, branding: Branding): BuildPlan {
  return validateBuildPlan({
    ...plan,
    version: 2,
    configuration: {
      ...plan.configuration,
      schemaVersion: 2,
      branding: brandingSchema.parse(branding),
    },
  });
}
export function unbrandBuildPlan(plan: BuildPlan): BuildPlan {
  const { branding: _branding, ...configuration } = plan.configuration;
  return validateBuildPlan({
    ...plan,
    version: 1,
    configuration: { ...configuration, schemaVersion: 1 },
  });
}
export function parseBuildPlanText(text: string): BuildPlan {
  if (new TextEncoder().encode(text).length > BUILD_PLAN_LIMIT)
    throw new ConfigurationError(
      "Choose a BuildPlan JSON file no larger than 48 KiB.",
    );
  return validateBuildPlan(
    JSON.parse(text, (key, value) => {
      if (["__proto__", "prototype", "constructor"].includes(key))
        throw new ConfigurationError("Unsafe object keys are not allowed.");
      return value;
    }),
  );
}
export function addCustomField(
  config: BusinessConfig,
  entityId: string,
  field: FieldDefinition,
): BusinessConfig {
  return validateConfig({
    ...config,
    entities: config.entities.map((e) =>
      e.id === entityId ? { ...e, fields: [...e.fields, field] } : e,
    ),
  });
}
export interface BuildPlanRevision {
  id: string;
  revision: number;
  base_revision: number;
  document: BuildPlan;
  created_by: string;
  created_at: Date | string;
}
