import { z } from "zod";
import type { WorkspaceRecord } from "./engine";
import type { EquipmentMapping } from "./equipment-reservations";
export const coordinatedConfirmation = "CONFIRM FICTIONAL RESOURCE RESERVATION";
const revision = z.number().int().positive().max(2147483647);
export const appointmentResourcesSchema = z
  .object({
    version: z.literal(1),
    configRevision: revision,
    primaryId: z.uuid(),
    primaryRevision: revision,
    equipment: z
      .object({
        resourceId: z.uuid(),
        resourceRevision: revision,
        equipmentId: z.uuid(),
        equipmentRevision: revision,
        mappingRevision: revision,
      })
      .strict()
      .nullable(),
    acknowledgement: z.literal(coordinatedConfirmation),
  })
  .strict();
export type AppointmentResources = z.infer<typeof appointmentResourcesSchema>;
export interface AppointmentAllocation {
  organization_id: string;
  appointment_id: string;
  slot: "Primary" | "Equipment";
  appointment_revision: number;
  config_revision: number;
  resource_id: string;
  resource_revision: number;
  resource_name: string;
  resource_kind: "Crew" | "Worker" | "Equipment";
  equipment_id: string | null;
  equipment_revision: number | null;
  mapping_revision: number | null;
  equipment_asset_id: string | null;
  starts_at: string | Date;
  ends_at: string | Date;
  blocking: boolean;
  present: boolean;
  recorded_by: string;
  operation_id: string | null;
  origin:
    | "Reviewed"
    | "Single resource"
    | "Legacy observed"
    | "Retained release";
  recorded_at: string | Date;
}
/** Builds an exact review from the caller's observed snapshot; never authorizes or promises availability. */
export function reviewAppointmentResources(
  configRevision: number,
  records: WorkspaceRecord[],
  mappings: EquipmentMapping[],
  primaryId: string,
  equipmentResourceId: string | null,
): AppointmentResources {
  const primary = records.find(
    (r) => r.id === primaryId && r.entity === "resources",
  );
  if (
    !primary ||
    primary.archived ||
    !["Crew", "Worker"].includes(String(primary.data.kind))
  )
    throw Error("Choose an active Crew or Worker as the primary resource.");
  let equipment: AppointmentResources["equipment"] = null;
  if (equipmentResourceId) {
    const resource = records.find(
        (r) =>
          r.id === equipmentResourceId &&
          r.entity === "resources" &&
          !r.archived &&
          r.data.kind === "Equipment",
      ),
      map = mappings.find(
        (m) => m.resource_id === equipmentResourceId && m.active,
      ),
      machine = records.find(
        (r) =>
          r.id === map?.equipment_id && r.entity === "equipment" && !r.archived,
      );
    if (!resource || !map || !machine)
      throw Error(
        "Review an explicitly mapped, same-workspace Equipment resource first.",
      );
    equipment = {
      resourceId: resource.id,
      resourceRevision: resource.revision,
      equipmentId: machine.id,
      equipmentRevision: machine.revision,
      mappingRevision: map.revision,
    };
  }
  return appointmentResourcesSchema.parse({
    version: 1,
    configRevision,
    primaryId,
    primaryRevision: primary.revision,
    equipment,
    acknowledgement: coordinatedConfirmation,
  });
}
