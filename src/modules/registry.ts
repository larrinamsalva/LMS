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
    description: "Customer-linked job records and crew notes.",
    dependencies: ["customers", "tasks"],
    entities: ["jobs"],
    capabilities: ["records:read", "records:write"],
  },
  {
    id: "scheduling",
    version: "1.0.0",
    engineApi: 1,
    name: "Shared scheduling",
    description:
      "Customer-linked appointments with exclusive resource conflict checks.",
    dependencies: ["customers"],
    entities: ["resources", "appointments"],
    capabilities: ["records:read", "records:write"],
  },
  {
    id: "workforce",
    version: "1.0.0",
    engineApi: 1,
    name: "Employees & crews",
    description:
      "Fictional profiles, dated crew membership and finite availability windows.",
    dependencies: ["scheduling"],
    entities: ["employees", "resource-memberships", "availability"],
    capabilities: ["records:read", "records:write"],
  },
  {
    id: "estimates",
    version: "1.0.0",
    engineApi: 1,
    name: "Services & estimates",
    description:
      "Saved service-area rates and fictional internal estimate drafts.",
    dependencies: ["customers"],
    entities: ["pricing-zones", "services", "service-rates", "estimates"],
    capabilities: ["records:read", "records:write"],
  },
  {
    id: "inventory",
    version: "1.0.0",
    engineApi: 1,
    name: "Inventory & stock",
    description:
      "Shared products, storage locations and an immutable exact stock ledger.",
    dependencies: [],
    entities: ["items", "stock-locations", "stock-movements"],
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
  "Invoices",
  "Documents",
  "Reports",
  "Workflow rules",
  "Optional AI",
] as const;
