import type { Engine, Principal } from "../core/engine";
import { wallToInstant } from "../core/time";
/** Fictional fixtures only; industry choices are configuration target IDs, never alternate services. */
export async function seedSchedule(
  engine: Engine,
  principal: Principal,
  organizationId: string,
) {
  const snapshot = await engine.snapshot(principal, organizationId),
    config = snapshot.config.document;
  const appointment = config.entities.find((e) => e.id === "appointments");
  if (!appointment) return;
  const customer = snapshot.records.find((r) => r.entity === "customers")!,
    target = appointment.fields.find((f) => f.key === "work")!.target!;
  const work = snapshot.records.find((r) => r.entity === target)!,
    site = snapshot.records.find((r) => r.entity === "units");
  const data = {
    ...work.data,
    customer: customer.id,
    ...(site ? { site: site.id } : {}),
  };
  await engine.saveRecord(principal, organizationId, target, data, {
    id: work.id,
    revision: work.revision,
  });
  const resource = await engine.saveRecord(
    principal,
    organizationId,
    "resources",
    {
      name: target === "jobs" ? "Blue crew" : "Garden worker",
      kind: target === "jobs" ? "Crew" : "Worker",
      notes: "Fictional exclusive resource.",
    },
  );
  const date = String(work.data.date ?? work.data.due),
    zone = config.timeZone ?? "UTC";
  await engine.saveRecord(principal, organizationId, "appointments", {
    title:
      target === "jobs"
        ? "Maple House scheduled clean"
        : "Scheduled porch inspection",
    customer: customer.id,
    work: work.id,
    resource: resource.id,
    ...(site ? { site: site.id } : {}),
    start: wallToInstant(date + "T09:00", zone),
    end: wallToInstant(date + "T10:00", zone),
    time_zone: zone,
    scheduled_date: date,
    status: "Scheduled",
    notes: "Fictional appointment; no messages are sent.",
  });
}
