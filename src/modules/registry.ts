/** Modules are reviewed data contracts, never downloaded executable code. */
export interface ModuleManifest {
  id: string;
  version: "1.0.0";
  engineApi: 1;
  name: string;
  description: string;
  dependencies: readonly string[];
  entities: readonly string[];
  capabilities: readonly ("records:read" | "records:write")[];
}
export const manifests: readonly ModuleManifest[] = [
  {
    id: "customers",
    version: "1.0.0",
    engineApi: 1,
    name: "Customers",
    description: "Customer contact records.",
    dependencies: [],
    entities: ["customers"],
    capabilities: ["records:read", "records:write"],
  },
  {
    id: "tasks",
    version: "1.0.0",
    engineApi: 1,
    name: "Tasks",
    description: "Operational task records; no automatic actions.",
    dependencies: [],
    entities: ["tasks"],
    capabilities: ["records:read", "records:write"],
  },
  {
    id: "property",
    version: "1.0.0",
    engineApi: 1,
    name: "Property units",
    description: "Site and unit catalog; no occupancy or rent ledger.",
    dependencies: ["customers", "tasks"],
    entities: ["units"],
    capabilities: ["records:read", "records:write"],
  },
  {
    id: "cleaning",
    version: "1.0.0",
    engineApi: 1,
    name: "Cleaning jobs",
    description:
      "Job records and crew notes; no scheduling collision guarantee.",
    dependencies: ["customers", "tasks"],
    entities: ["jobs"],
    capabilities: ["records:read", "records:write"],
  },
  {
    id: "inventory",
    version: "1.0.0",
    engineApi: 1,
    name: "Item catalog",
    description:
      "Supply descriptions and reorder notes; stock movements come later.",
    dependencies: [],
    entities: ["items"],
    capabilities: ["records:read", "records:write"],
  },
  {
    id: "custom-records",
    version: "1.0.0",
    engineApi: 1,
    name: "Custom records",
    description: "Operational entities with the custom- prefix.",
    dependencies: [],
    entities: ["custom-*"],
    capabilities: ["records:read", "records:write"],
  },
];
export const moduleById = new Map(manifests.map((m) => [m.id, m]));
export const plannedModules = [
  "Staff assignments",
  "Scheduling",
  "Service rates & quotes",
  "Inventory movements",
  "Invoices",
  "Documents",
  "Reports",
  "Workflow rules",
  "Optional AI",
] as const;
