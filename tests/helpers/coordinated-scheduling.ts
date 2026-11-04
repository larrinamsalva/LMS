import { randomUUID } from "node:crypto";
import type { Engine, Principal } from "../../src/core/engine";
import { reviewAppointmentResources } from "../../src/core/coordinated-scheduling";
import { selectModules } from "../../src/core/buildplan";
import { reservationFixture } from "./equipment-reservations";
import { employee, enroll } from "./workforce";
export async function coordinatedFixture(
  engine: Engine,
  actor: Principal,
  org: string,
  industry: "property" | "cleaning" = "property",
) {
  const f = await reservationFixture(engine, actor, org, industry),
    current = (await engine.snapshot(actor, org)).config;
  await engine.publishConfig(
    actor,
    org,
    selectModules(current.document, [
      ...current.document.modules.map((m) => m.id),
      "coordinated-scheduling",
    ]),
    current.revision,
  );
  const primary = await engine.saveRecord(actor, org, "resources", {
      name:
        industry === "cleaning"
          ? "Coordinated cleaning crew"
          : "Coordinated maintenance worker",
      kind: industry === "cleaning" ? "Crew" : "Worker",
    }),
    person = await employee(engine, actor, org);
  const membership = await enroll(engine, actor, org, primary, person.profile);
  const snapshot = await engine.snapshot(actor, org),
    data = { ...f.data, resource: primary.id },
    resources = reviewAppointmentResources(
      snapshot.config.revision,
      snapshot.records,
      snapshot.equipmentMappings,
      primary.id,
      f.workflow.resource.id,
    );
  return { ...f, primary, person, membership, data, resources };
}
