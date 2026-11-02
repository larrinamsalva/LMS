import { localDate, instant } from "./time";
import { z } from "zod";
import type { WorkspaceRecord } from "./engine";
import type { EquipmentCheckout, EquipmentState } from "./equipment";
export const mappingConfirmation = "CONFIRM FICTIONAL EQUIPMENT MAPPING";
export const equipmentMappingSchema = z
  .object({
    kind: z.enum(["map", "unmap"]),
    equipmentId: z.uuid(),
    equipmentRevision: z.number().int().positive(),
    resourceId: z.uuid(),
    resourceRevision: z.number().int().positive(),
    mappingRevision: z.number().int().min(0),
    configRevision: z.number().int().positive(),
    acknowledgement: z.literal(mappingConfirmation),
    notes: z.string().trim().min(8).max(1000),
  })
  .strict();
export type EquipmentMappingCommand = z.infer<typeof equipmentMappingSchema>;
export interface EquipmentMapping {
  organization_id: string;
  equipment_id: string;
  resource_id: string;
  revision: number;
  equipment_revision: number;
  resource_revision: number;
  config_revision: number;
  active: boolean;
  actor_id: string;
  operation_id: string;
  occurred_at: string | Date;
}
export interface EquipmentReservation {
  organization_id: string;
  appointment_id: string;
  appointment_revision: number;
  equipment_id: string;
  resource_id: string;
  mapping_revision: number;
  equipment_revision: number;
  resource_revision: number;
  starts_at: string | Date;
  ends_at: string | Date;
  blocking: boolean;
}
/** A current-state warning, never a promise about future physical custody. */
export function equipmentReservationWarning(
  state: EquipmentState | undefined,
  checkouts: EquipmentCheckout[],
  equipmentId: string,
) {
  if (!state) return "Equipment evidence missing — review required";
  if (state.condition !== "Serviceable" || state.maintenance !== "Clear")
    return `${state.condition} — reservations need review`;
  if (checkouts.some((c) => c.equipment_id === equipmentId && !c.returned_at))
    return "Currently checked out — future collection is not guaranteed";
  return `Serviceable now${state.next_inspection ? "; inspection due " + state.next_inspection : ""} — future collection requires a separate checkout review`;
}
export function reservationRows(
  records: WorkspaceRecord[],
  reservations: EquipmentReservation[],
  equipmentId: string,
) {
  return reservations
    .filter((r) => r.equipment_id === equipmentId)
    .map((r) => ({
      reservation: r,
      appointment: records.find((a) => a.id === r.appointment_id),
    }));
}

export function reservationNeedsReview(
  state: EquipmentState | undefined,
  checkouts: EquipmentCheckout[],
  equipmentId: string,
  end: string,
  zone: string,
) {
  return (
    !state ||
    state.condition !== "Serviceable" ||
    state.maintenance !== "Clear" ||
    checkouts.some((c) => c.equipment_id === equipmentId && !c.returned_at) ||
    !!(
      state.next_inspection &&
      localDate(instant(end).subtract({ nanoseconds: 1 }).toString(), zone) >=
        state.next_inspection
    )
  );
}
