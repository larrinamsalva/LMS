import { z } from "zod";
import { ConfigurationError } from "./config";
import {
  newBuildPlan,
  selectModules,
  validateBuildPlan,
  type BuildPlan,
  type Template,
} from "./buildplan";
import { moduleById } from "../modules/registry";
/** Reviewed workflow claims are data about existing modules, never executable actions. */
export const galleryWorkflows = {
  customers: { name: "Customer contact records", modules: ["customers"] },
  tasks: { name: "Work requests and daily tasks", modules: ["tasks"] },
  cleaning: { name: "Customer-linked cleaning jobs", modules: ["cleaning"] },
  property: { name: "Sites and units catalog", modules: ["property"] },
  scheduling: {
    name: "Conflict-aware resource appointments",
    modules: ["scheduling"],
  },
  workforce: {
    name: "Employee profiles, dated crews and availability",
    modules: ["workforce"],
  },
  estimates: {
    name: "Service rates and fictional estimate drafts",
    modules: ["estimates"],
  },
  inventory: {
    name: "Supply locations and whole-unit stock movements",
    modules: ["inventory"],
  },
  notes: { name: "General custom notes", modules: ["custom-records"] },
} as const;
type Workflow = keyof typeof galleryWorkflows;
const metadataSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,49}$/),
    revision: z.number().int().min(1).max(999),
    name: z.string().trim().min(1).max(80),
    purpose: z.string().trim().min(1).max(400),
    workflows: z
      .array(z.enum(Object.keys(galleryWorkflows) as [Workflow, ...Workflow[]]))
      .min(1)
      .max(9),
    limitations: z.array(z.string().trim().min(1).max(250)).min(1).max(5),
  })
  .strict();
export interface GalleryEntry {
  metadata: z.infer<typeof metadataSchema>;
  plan: BuildPlan;
}
export function validateGalleryEntry(input: unknown): GalleryEntry {
  const entry = z
      .object({ metadata: metadataSchema, plan: z.unknown() })
      .strict()
      .parse(input),
    plan = validateBuildPlan(entry.plan),
    enabled = new Set(plan.configuration.modules.map((m) => m.id));
  if (
    new Set(entry.metadata.workflows).size !== entry.metadata.workflows.length
  )
    throw new ConfigurationError("Duplicate gallery workflows.");
  for (const workflow of entry.metadata.workflows)
    if (galleryWorkflows[workflow].modules.some((id) => !enabled.has(id)))
      throw new ConfigurationError(
        "Gallery workflow requires a disabled module.",
      );
  return { metadata: entry.metadata, plan };
}
export function validateGallery(input: unknown): GalleryEntry[] {
  const entries = z
    .array(z.unknown())
    .min(1)
    .max(20)
    .parse(input)
    .map(validateGalleryEntry);
  if (new Set(entries.map((e) => e.metadata.id)).size !== entries.length)
    throw new ConfigurationError("Duplicate gallery template identifiers.");
  return entries;
}
function starter(
  id: string,
  name: string,
  type: Template,
  modules: string[],
  purpose: string,
  workflows: Workflow[],
  limitations: string[],
): GalleryEntry {
  const plan = newBuildPlan(type);
  plan.configuration = selectModules(plan.configuration, modules);
  plan.configuration.name = "Fictional " + name;
  return validateGalleryEntry({
    metadata: { id, revision: 1, name, purpose, workflows, limitations },
    plan,
  });
}
const collection = validateGallery([
  starter(
    "basic-cleaning",
    "Basic Cleaning Business",
    "cleaning",
    ["cleaning"],
    "Keep customer details, cleaning job records and everyday tasks in a small starting workspace.",
    ["customers", "cleaning", "tasks"],
    [
      "Scheduling, crews, rates, estimates and inventory are not enabled. Add them deliberately in Studio.",
    ],
  ),
  starter(
    "cleaning-crews",
    "Cleaning Crew & Scheduling",
    "cleaning",
    ["cleaning", "workforce", "inventory"],
    "Plan customer-linked cleaning appointments, organize employees and crews, and track supplies.",
    ["customers", "cleaning", "scheduling", "workforce", "inventory"],
    [
      "Publish finite working hours and dated crew memberships before staffed bookings. Recurring schedules and payroll are not included.",
      "Service rates and estimate drafts are not enabled in this starter.",
    ],
  ),
  starter(
    "rv-property",
    "RV Park / Property Management",
    "property",
    ["property", "scheduling", "workforce", "estimates", "inventory"],
    "Start with customer and site records, maintenance tasks, scheduled workers, internal estimates and supplies.",
    [
      "customers",
      "property",
      "tasks",
      "scheduling",
      "workforce",
      "estimates",
      "inventory",
    ],
    [
      "This is not a complete RV-park application. Reservations, occupancy, leases, rent, meters and utility billing are not implemented.",
      "Estimates remain fictional internal drafts; no invoices or payments run.",
    ],
  ),
  starter(
    "property-maintenance",
    "Property Maintenance",
    "property",
    ["property", "scheduling", "inventory"],
    "Organize sites, customer-linked maintenance requests, resource appointments and maintenance supplies.",
    ["property", "tasks", "scheduling", "inventory"],
    [
      "Resource-only scheduling is enabled; add Employees & crews in Studio for employee-level availability and conflicts.",
      "Service rates and estimate drafts are not enabled in this starter.",
    ],
  ),
  starter(
    "general-service",
    "General Service Business",
    "custom",
    ["scheduling", "estimates", "inventory", "custom-records"],
    "Combine general customers and work items with appointments, service pricing, fictional estimates, supplies and notes.",
    ["customers", "tasks", "scheduling", "estimates", "inventory", "notes"],
    [
      "Resource-only scheduling is enabled; employee crews are optional through Studio.",
      "No invoicing, payments, messaging or specialized industry automation is included.",
    ],
  ),
]);
/** Return detached copies. Gallery revisions never remain linked to saved user configurations. */
export function reviewedGallery(): GalleryEntry[] {
  return validateGallery(structuredClone(collection));
}
export function remixGalleryEntry(entry: GalleryEntry): BuildPlan {
  return validateBuildPlan(structuredClone(validateGalleryEntry(entry).plan));
}
export function filterGallery(
  entries: readonly GalleryEntry[],
  query: string,
  type: string,
  feature: string,
): GalleryEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    const modules = entry.plan.configuration.modules;
    if (type !== "all" && entry.plan.template !== type) return false;
    if (feature !== "all" && !modules.some((m) => m.id === feature))
      return false;
    const haystack = [
      entry.metadata.name,
      entry.metadata.purpose,
      ...entry.metadata.workflows.map((w) => galleryWorkflows[w].name),
      ...modules.map((m) => moduleById.get(m.id)?.name ?? m.id),
    ]
      .join(" ")
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
