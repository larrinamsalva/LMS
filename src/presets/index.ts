import {
  validateConfig,
  type BusinessConfig,
  type FieldDefinition,
} from "../core/config";
import { appointmentStatuses } from "../core/time";
import { pricingModes, estimateStatuses } from "../core/pricing";
import { availabilityKinds } from "../core/workforce";
const field = (
  key: string,
  label: string,
  type: FieldDefinition["type"] = "text",
  required = false,
  options?: string[],
): FieldDefinition => ({
  key,
  label,
  type,
  required,
  ...(options ? { options } : {}),
});
const reference = (
  key: string,
  label: string,
  target: string,
  required = false,
): FieldDefinition => ({ key, label, type: "reference", target, required });
const scheduling = (industry: "property" | "cleaning") => [
  {
    id: "resources",
    module: "scheduling",
    singular:
      industry === "cleaning" ? "Crew or resource" : "Worker or resource",
    plural:
      industry === "cleaning" ? "Crews & resources" : "Workers & resources",
    titleField: "name",
    fields: [
      field("name", "Resource name", "text", true),
      field("kind", "Resource type", "select", true, [
        "Crew",
        "Worker",
        "Equipment",
      ]),
      field("notes", "Resource notes", "longtext"),
    ],
  },
  {
    id: "appointments",
    module: "scheduling",
    singular:
      industry === "cleaning"
        ? "Cleaning appointment"
        : "Maintenance appointment",
    plural:
      industry === "cleaning"
        ? "Cleaning appointments"
        : "Maintenance appointments",
    titleField: "title",
    fields: [
      field("title", "Appointment title", "text", true),
      reference("customer", "Customer", "customers", true),
      reference(
        "work",
        industry === "cleaning" ? "Cleaning job" : "Maintenance request",
        industry === "cleaning" ? "jobs" : "tasks",
        true,
      ),
      ...(industry === "property"
        ? [reference("site", "Site or unit", "units")]
        : []),
      reference(
        "resource",
        industry === "cleaning"
          ? "Assigned crew / resource"
          : "Assigned worker / resource",
        "resources",
        true,
      ),
      field("start", "Start time", "datetime", true),
      field("end", "End time", "datetime", true),
      field("scheduled_date", "Scheduled date", "date", true),
      field("time_zone", "Booking time zone", "text", true),
      field("status", "Appointment status", "select", true, [
        ...appointmentStatuses,
      ]),
      field("notes", "Appointment notes", "longtext"),
    ],
  },
];
const common = [
  {
    id: "customers",
    module: "customers",
    singular: "Customer",
    plural: "Customers",
    titleField: "name",
    fields: [
      field("name", "Name", "text", true),
      field("email", "Email", "email"),
      field("phone", "Phone"),
      field("notes", "Notes", "longtext"),
    ],
  },
  {
    id: "tasks",
    module: "tasks",
    singular: "Task",
    plural: "Tasks",
    titleField: "title",
    fields: [
      field("title", "Task title", "text", true),
      reference("customer", "Customer", "customers"),
      field("status", "Status", "select", true, [
        "Open",
        "In progress",
        "Done",
      ]),
      field("due", "Due date", "date"),
      field("notes", "Notes", "longtext"),
    ],
  },
  {
    id: "items",
    module: "inventory",
    singular: "Supply item",
    plural: "Supply catalog",
    titleField: "name",
    fields: [
      field("name", "Item name", "text", true),
      field("unit", "Unit / package"),
      field("notes", "Reorder notes", "longtext"),
    ],
  },
];
const workforce = [
  {
    id: "employees",
    module: "workforce",
    singular: "Employee profile",
    plural: "Employees",
    titleField: "name",
    fields: [
      field("name", "Employee name", "text", true),
      field("role", "Work role", "text", true),
      field("skills", "Skills", "longtext"),
      field("status", "Employee status", "select", true, [
        "Active",
        "Inactive",
      ]),
      field("email", "Contact email", "email"),
      field("phone", "Contact phone"),
      field("notes", "Profile notes", "longtext"),
    ],
  },
  {
    id: "resource-memberships",
    module: "workforce",
    singular: "Dated membership",
    plural: "Dated memberships",
    titleField: "title",
    fields: [
      field("title", "Membership title", "text", true),
      reference("employee", "Employee", "employees", true),
      reference("resource", "Worker or crew", "resources", true),
      field("start", "Effective start", "datetime", true),
      field("end", "Effective end", "datetime", true),
      field("time_zone", "Membership time zone", "text", true),
      field("notes", "Membership notes", "longtext"),
    ],
  },
  {
    id: "availability",
    module: "workforce",
    singular: "Availability period",
    plural: "Availability periods",
    titleField: "title",
    fields: [
      field("title", "Period title", "text", true),
      reference("employee", "Employee", "employees"),
      reference("resource", "Resource", "resources"),
      field("kind", "Period type", "select", true, [...availabilityKinds]),
      field("start", "Period start", "datetime", true),
      field("end", "Period end", "datetime", true),
      field("time_zone", "Period time zone", "text", true),
      field("notes", "Availability notes", "longtext"),
    ],
  },
];
const pricing = (industry: "property" | "cleaning") => [
  {
    id: "pricing-zones",
    module: "estimates",
    singular: "Pricing zone",
    plural: "Pricing zones",
    titleField: "name",
    fields: [
      field("name", "Area name", "text", true),
      field("description", "Area description", "longtext"),
    ],
  },
  {
    id: "services",
    module: "estimates",
    singular: "Service",
    plural: "Services",
    titleField: "name",
    fields: [
      field("name", "Service name", "text", true),
      field("description", "Service description", "longtext"),
      field("category", "Service category"),
      field("mode", "Pricing method", "select", true, [...pricingModes]),
      field("unit", "Pricing unit", "text", true),
      field("kind", "Service kind", "select", true, ["Service", "Extra"]),
      reference("parent", "Extra for service", "services"),
      field("notes", "Service notes", "longtext"),
    ],
  },
  {
    id: "service-rates",
    module: "estimates",
    singular: "Service rate",
    plural: "Rates",
    titleField: "title",
    fields: [
      field("title", "Rate title", "text", true),
      reference("service", "Service", "services", true),
      reference("zone", "Pricing zone", "pricing-zones", true),
      field("amount", "Unit price (USD)", "money", true),
      field("effective_from", "Effective from", "date", true),
      field("effective_until", "Effective until (exclusive)", "date"),
      field("notes", "Rate notes", "longtext"),
    ],
  },
  {
    id: "estimates",
    module: "estimates",
    singular: "Estimate draft",
    plural: "Estimates",
    titleField: "title",
    fields: [
      field("title", "Estimate title", "text", true),
      reference("customer", "Customer", "customers", true),
      reference(
        "work",
        industry === "cleaning" ? "Cleaning job" : "Maintenance request",
        industry === "cleaning" ? "jobs" : "tasks",
      ),
      reference("appointment", "Appointment", "appointments"),
      reference("zone", "Pricing zone", "pricing-zones", true),
      field("as_of", "Pricing date", "date", true),
      field("status", "Draft status", "select", true, [...estimateStatuses]),
      field("pricing", "Pricing details", "estimate", true),
      field("notes", "Estimate notes", "longtext"),
    ],
  },
];
export const presets: Record<"property" | "cleaning", BusinessConfig> = {
  property: validateConfig({
    schemaVersion: 1,
    id: "property-starter",
    name: "Cedar Grove Property",
    industry: "property",
    timeZone: "America/Los_Angeles",
    modules: [
      "customers",
      "tasks",
      "property",
      "inventory",
      "scheduling",
      "workforce",
      "estimates",
    ].map((id) => ({
      id,
      version: "1.0.0",
    })),
    entities: [
      ...common.map((e) =>
        e.id === "tasks"
          ? {
              ...e,
              singular: "Maintenance request",
              plural: "Maintenance requests",
              fields: [...e.fields, reference("site", "Site or unit", "units")],
            }
          : e,
      ),
      ...scheduling("property"),
      ...workforce,
      ...pricing("property"),
      {
        id: "units",
        module: "property",
        singular: "Site or unit",
        plural: "Sites & units",
        titleField: "label",
        fields: [
          field("label", "Site / unit label", "text", true),
          field("kind", "Unit type", "select", true, [
            "RV site",
            "Apartment",
            "Cabin",
          ]),
          field("condition", "Physical condition", "select", true, [
            "Ready",
            "Needs preparation",
            "Out of service",
          ]),
          field("notes", "Maintenance notes", "longtext"),
        ],
      },
    ],
    navigation: [
      "customers",
      "units",
      "tasks",
      "resources",
      "appointments",
      "employees",
      "resource-memberships",
      "availability",
      "pricing-zones",
      "services",
      "service-rates",
      "estimates",
      "items",
    ],
  }),
  cleaning: validateConfig({
    schemaVersion: 1,
    id: "cleaning-starter",
    name: "Bright Path Cleaning",
    industry: "cleaning",
    timeZone: "America/Los_Angeles",
    modules: [
      "customers",
      "tasks",
      "cleaning",
      "inventory",
      "scheduling",
      "workforce",
      "estimates",
    ].map((id) => ({
      id,
      version: "1.0.0",
    })),
    entities: [
      ...common,
      ...scheduling("cleaning"),
      ...workforce,
      ...pricing("cleaning"),
      {
        id: "jobs",
        module: "cleaning",
        singular: "Cleaning job",
        plural: "Cleaning jobs",
        titleField: "title",
        fields: [
          field("title", "Job title", "text", true),
          reference("customer", "Customer", "customers"),
          field("service", "Service", "select", true, [
            "Standard clean",
            "Move-out clean",
            "Deep clean",
          ]),
          field("date", "Service date", "date", true),
          field("crew", "Crew notes"),
          field("status", "Status", "select", true, [
            "Planned",
            "In progress",
            "Done",
          ]),
          field("notes", "Job notes", "longtext"),
        ],
      },
    ],
    navigation: [
      "customers",
      "jobs",
      "tasks",
      "resources",
      "appointments",
      "employees",
      "resource-memberships",
      "availability",
      "pricing-zones",
      "services",
      "service-rates",
      "estimates",
      "items",
    ],
  }),
};
export const sampleRecords = {
  property: [
    {
      entity: "customers",
      data: {
        name: "Alex Example",
        email: "alex@example.test",
        phone: "555-0101",
        notes: "Fictional customer.",
      },
    },
    {
      entity: "units",
      data: {
        label: "RV-014",
        kind: "RV site",
        condition: "Ready",
        notes: "Shaded site near the garden.",
      },
    },
    {
      entity: "units",
      data: {
        label: "Cabin 02",
        kind: "Cabin",
        condition: "Needs preparation",
        notes: "Inspect porch light.",
      },
    },
    {
      entity: "tasks",
      data: {
        title: "Inspect porch light",
        status: "Open",
        due: "2026-11-04",
        notes: "Cabin 02; fictional maintenance task.",
      },
    },
    {
      entity: "items",
      data: {
        name: "Water fittings",
        unit: "Box",
        notes: "Check shelf before reordering.",
      },
    },
  ],
  cleaning: [
    {
      entity: "customers",
      data: {
        name: "Jordan Sample",
        email: "jordan@example.test",
        phone: "555-0102",
        notes: "Fictional customer.",
      },
    },
    {
      entity: "jobs",
      data: {
        title: "Maple House move-out",
        service: "Move-out clean",
        date: "2026-11-03",
        crew: "Blue crew",
        status: "Planned",
        notes: "Kitchen, windows and final walkthrough.",
      },
    },
    {
      entity: "tasks",
      data: {
        title: "Restock the crew kit",
        status: "Open",
        due: "2026-11-02",
        notes: "Cloths and gloves.",
      },
    },
    {
      entity: "items",
      data: {
        name: "Microfiber cloths",
        unit: "Pack of 12",
        notes: "Separate colors for each surface.",
      },
    },
  ],
} satisfies Record<string, { entity: string; data: Record<string, string> }[]>;
