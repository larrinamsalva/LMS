import { randomUUID } from "node:crypto";
import type { Engine, Principal, WorkspaceRecord } from "../../src/core/engine";
import {
  equipmentConfirmation,
  releaseEquipmentConfirmation,
} from "../../src/core/equipment";
export const equipmentAction = (
  record: Pick<WorkspaceRecord, "id" | "revision" | "config_revision">,
  kind: string,
  changes: Record<string, unknown> = {},
) => ({
  kind,
  equipmentId: record.id,
  revision: record.revision,
  configRevision: record.config_revision,
  acknowledgement: equipmentConfirmation,
  notes: "Reviewed fictional equipment action",
  ...(kind === "report-problem" ? { condition: "Needs inspection" } : {}),
  ...changes,
});
export async function equipmentFixture(
  engine: Engine,
  actor: Principal,
  org: string,
) {
  const location = await engine.saveRecord(
    actor,
    org,
    "stock-locations",
    { name: "Fictional tool room" },
    undefined,
    randomUUID(),
  );
  const employee = await engine.saveRecord(
    actor,
    org,
    "employees",
    {
      name: "Fictional equipment keeper",
      role: "Maintenance",
      status: "Active",
    },
    undefined,
    randomUUID(),
  );
  const work = await engine.saveRecord(
    actor,
    org,
    "tasks",
    { title: "Fictional equipment service", status: "Open" },
    undefined,
    randomUUID(),
  );
  const equipment = await engine.saveRecord(
    actor,
    org,
    "equipment",
    {
      name: "Fictional floor machine",
      asset_id: "MACHINE-01",
      category: "Floor care",
      serial: "SERIAL-EXAMPLE",
      barcode: "TOOL-001",
      location: location.id,
      purchase_cost: "12345",
      purchased_on: "2025-01-01",
    },
    undefined,
    randomUUID(),
  );
  return { location, employee, work, equipment };
}
export async function releaseEquipment(
  engine: Engine,
  actor: Principal,
  org: string,
  equipment: WorkspaceRecord,
  employee: WorkspaceRecord,
) {
  return engine.writeEquipment(
    actor,
    org,
    equipmentAction(equipment, "release", {
      employeeId: employee.id,
      employeeRevision: employee.revision,
      serviceDate: "2026-11-06",
      nextInspection: "2026-12-06",
      confirmation: releaseEquipmentConfirmation,
    }),
    randomUUID(),
  );
}
export const checkoutEquipment = (
  record: WorkspaceRecord,
  employee: WorkspaceRecord,
  changes: Record<string, unknown> = {},
) =>
  equipmentAction(record, "checkout", {
    employeeId: employee.id,
    employeeRevision: employee.revision,
    resourceId: null,
    resourceRevision: null,
    workId: null,
    workRevision: null,
    checkedOutAt: "2026-11-06T16:00:00Z",
    expectedReturnAt: "2026-11-07T16:00:00Z",
    ...changes,
  });
