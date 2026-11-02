import { randomUUID } from "node:crypto";
import type { Engine, Principal, WorkspaceRecord } from "../../src/core/engine";
import { selectModules } from "../../src/core/buildplan";
import { mappingConfirmation } from "../../src/core/equipment-reservations";
import { equipmentFixture, releaseEquipment } from "./equipment";
import { workflow, appointmentData } from "./scheduling";
export const mappingRequest = (
  equipment: WorkspaceRecord,
  resource: WorkspaceRecord,
  configRevision: number,
  mappingRevision = 0,
  kind: "map" | "unmap" = "map",
) => ({
  kind,
  equipmentId: equipment.id,
  equipmentRevision: equipment.revision,
  resourceId: resource.id,
  resourceRevision: resource.revision,
  configRevision,
  mappingRevision,
  acknowledgement: mappingConfirmation,
  notes: "Reviewed fictional calendar mapping",
});
export async function reservationFixture(
  engine: Engine,
  actor: Principal,
  org: string,
  industry: "property" | "cleaning" = "property",
) {
  const current = (await engine.snapshot(actor, org)).config;
  if (!current.document.modules.some((m) => m.id === "equipment-reservations"))
    await engine.publishConfig(
      actor,
      org,
      selectModules(current.document, [
        ...current.document.modules.map((m) => m.id),
        "equipment-reservations",
      ]),
      current.revision,
    );
  const f = await equipmentFixture(engine, actor, org);
  f.equipment = await releaseEquipment(
    engine,
    actor,
    org,
    f.equipment,
    f.employee,
  );
  const w = await workflow(engine, actor, org, industry);
  w.resource = await engine.saveRecord(
    actor,
    org,
    "resources",
    { name: "Fictional scrubber calendar", kind: "Equipment" },
    undefined,
    randomUUID(),
  );
  const config = (await engine.snapshot(actor, org)).config;
  const request = mappingRequest(f.equipment, w.resource, config.revision);
  const mapping = await engine.mapEquipment(actor, org, request, randomUUID());
  return { ...f, workflow: w, request, mapping, data: appointmentData(w) };
}
