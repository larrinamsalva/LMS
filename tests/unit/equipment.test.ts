import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  equipmentCommandSchema,
  equipmentConfirmation,
  equipmentDefinition,
  equipmentIndicators,
  equipmentStatus,
  releaseEquipmentConfirmation,
  type EquipmentState,
  type EquipmentCheckout,
} from "../../src/core/equipment";
import {
  newBuildPlan,
  selectModules,
  validateBuildPlan,
  brandBuildPlan,
} from "../../src/core/buildplan";
import { validateConfig, validateRecord } from "../../src/core/config";
import { defaultBranding } from "../../src/core/branding";
import {
  createBlueprintPackage,
  importBlueprintPackage,
} from "../../src/core/blueprint";
const state: EquipmentState = {
  organization_id: randomUUID(),
  record_id: randomUUID(),
  revision: 1,
  asset_key: "TOOL-01",
  barcode_key: null,
  condition: "Serviceable",
  maintenance: "Clear",
  work_id: null,
  technician_id: null,
  last_service: null,
  next_inspection: "2026-11-08",
};
const checkout: EquipmentCheckout = {
  organization_id: state.organization_id,
  id: randomUUID(),
  equipment_id: state.record_id,
  revision: 1,
  employee_id: randomUUID(),
  employee_revision: 1,
  resource_id: null,
  membership_id: null,
  membership_revision: null,
  work_id: null,
  checked_out_at: "2026-11-06T16:00:00Z",
  expected_return_at: "2026-11-07T16:00:00Z",
  returned_at: null,
  status: "Checked out",
  return_condition: null,
  checked_out_by: randomUUID(),
  returned_by: null,
};
const command = {
  kind: "checkout",
  equipmentId: state.record_id,
  revision: 1,
  configRevision: 1,
  acknowledgement: equipmentConfirmation,
  notes: "Fictional reviewed checkout",
  employeeId: checkout.employee_id,
  employeeRevision: 1,
  resourceId: null,
  resourceRevision: null,
  workId: null,
  workRevision: null,
  checkedOutAt: "2026-11-06T08:00:00-08:00",
  expectedReturnAt: "2026-11-07T16:00:00Z",
};
it.each(["property", "cleaning", "custom"] as const)(
  "keeps %s starters unchanged and explicitly resolves equipment dependencies",
  (template) => {
    const plan = newBuildPlan(template),
      before = structuredClone(plan);
    expect(plan.configuration.modules.some((m) => m.id === "equipment")).toBe(
      false,
    );
    const config = selectModules(plan.configuration, ["equipment"]);
    expect(config.modules.map((m) => m.id)).toEqual(
      expect.arrayContaining([
        "equipment",
        "inventory",
        "workforce",
        "scheduling",
        "customers",
        "tasks",
      ]),
    );
    expect(
      validateBuildPlan({
        ...plan,
        configuration: config,
      }).configuration.entities.find((e) => e.id === "equipment"),
    ).toEqual(equipmentDefinition);
    expect(plan).toEqual(before);
    const unsafe = structuredClone(config);
    unsafe.modules = unsafe.modules.filter((m) => m.id !== "workforce");
    expect(() => validateConfig(unsafe)).toThrow();
  },
);
it.each([1, 2])(
  "round-trips equipment through unchanged BuildPlan and Blueprint version %i",
  async (version) => {
    let plan = newBuildPlan("cleaning");
    plan.configuration = selectModules(plan.configuration, [
      "equipment",
      "invoice-drafts",
    ]);
    if (version === 2) plan = brandBuildPlan(plan, defaultBranding("cleaning"));
    const bytes = await createBlueprintPackage(plan, {
      name: "Fictional equipment starter",
      description: "No operational records or deployment",
    });
    const read = await importBlueprintPackage(bytes);
    expect(read.plan).toEqual(plan);
    expect(read.manifest.version).toBe(version);
  },
);
it("keeps the reviewed equipment schema locked and separates reusable equipment from stock quantities", () => {
  const config = selectModules(newBuildPlan("property").configuration, [
    "equipment",
  ]);
  const e = config.entities.find((e) => e.id === "equipment")!;
  e.fields.push({
    key: "quantity",
    label: "Stock",
    type: "stock",
    required: false,
  });
  expect(() => validateConfig(config)).toThrow();
  expect(() =>
    validateRecord(equipmentDefinition, {
      name: "Tool",
      asset_id: "../unsafe",
      location: randomUUID(),
    }),
  ).toThrow();
  expect(
    validateRecord(equipmentDefinition, {
      name: "Tool",
      asset_id: "TOOL-01",
      location: randomUUID(),
      purchase_cost: "12345",
      serial: "NOT-GLOBALLY-UNIQUE",
    }).purchase_cost,
  ).toBe("12345");
});
it("normalizes explicit-offset whole-minute times and binds all record revisions", () => {
  const parsed = equipmentCommandSchema.parse(command);
  expect(parsed.kind === "checkout" && parsed.checkedOutAt).toBe(
    "2026-11-06T16:00:00Z",
  );
  for (const change of [
    { checkedOutAt: "2026-11-06T08:00" },
    { checkedOutAt: "2026-11-06T16:00:01Z" },
    { expectedReturnAt: "2026-11-06T16:00:00Z" },
    { expectedReturnAt: "2028-11-06T16:00:00Z" },
    { resourceId: randomUUID() },
    { revision: 0 },
    { notes: "" },
  ])
    expect(() =>
      equipmentCommandSchema.parse({ ...command, ...change }),
    ).toThrow();
});
it("refuses executable/authority fields and missing confirmation on sensitive actions", () => {
  for (const change of [
    { sql: "drop table x" },
    { userId: randomUUID() },
    { acknowledgement: "ASSIGN" },
  ])
    expect(() =>
      equipmentCommandSchema.parse({ ...command, ...change }),
    ).toThrow();
  const release = {
    kind: "release",
    equipmentId: state.record_id,
    revision: 1,
    configRevision: 1,
    acknowledgement: equipmentConfirmation,
    notes: "Reviewed fictional inspection",
    employeeId: checkout.employee_id,
    employeeRevision: 1,
    serviceDate: "2026-11-06",
    nextInspection: "2026-11-07",
    confirmation: releaseEquipmentConfirmation,
  };
  expect(equipmentCommandSchema.parse(release)).toEqual(release);
  expect(() =>
    equipmentCommandSchema.parse({ ...release, nextInspection: "2026-11-06" }),
  ).toThrow();
  expect(() =>
    equipmentCommandSchema.parse({ ...release, confirmation: "" }),
  ).toThrow();
});
it("keeps custody visible when physical condition is blocked, and computes indicators in the business zone", () => {
  expect(equipmentStatus(state)).toBe("Available");
  expect(
    equipmentStatus({ ...state, condition: "Under maintenance" }, checkout),
  ).toBe("Checked out");
  expect(
    equipmentIndicators(
      state,
      checkout,
      "2026-11-08T07:30:00Z",
      "America/Los_Angeles",
    ),
  ).toEqual({ overdue: true, inspectionDue: false, inspectionSoon: true });
  expect(
    equipmentIndicators(
      state,
      checkout,
      "2026-11-08T09:30:00Z",
      "America/Los_Angeles",
    ),
  ).toEqual({ overdue: true, inspectionDue: true, inspectionSoon: false });
  expect(
    equipmentIndicators(
      { ...state, next_inspection: null },
      { ...checkout, status: "Returned", returned_at: "2026-11-07T15:00:00Z" },
      "2026-11-08T09:30:00Z",
      "UTC",
    ),
  ).toEqual({ overdue: false, inspectionDue: false, inspectionSoon: false });
});
