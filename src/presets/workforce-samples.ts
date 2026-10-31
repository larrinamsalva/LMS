import type { Engine, Principal, WorkspaceRecord } from "../core/engine";
import { wallToInstant } from "../core/time";
/** Fictional roster only; profiles are not authentication identities. */
export async function seedWorkforce(
  engine: Engine,
  owner: Principal,
  org: string,
  resource: WorkspaceRecord,
  date: string,
  zone: string,
) {
  const names =
    resource.data.kind === "Crew"
      ? ["Sam Example", "Riley Sample"]
      : ["Taylor Example"];
  for (const name of names) {
    const person = await engine.saveRecord(owner, org, "employees", {
      name,
      role:
        resource.data.kind === "Crew"
          ? "Cleaning specialist"
          : "Maintenance worker",
      skills:
        resource.data.kind === "Crew"
          ? "Cleaning, room preparation"
          : "Inspection, minor repairs",
      status: "Active",
      email: name.toLowerCase().split(" ")[0] + "@example.test",
      notes: "Fictional profile; no login access.",
    });
    await engine.saveRecord(owner, org, "resource-memberships", {
      title: name + " / " + resource.data.name,
      employee: person.id,
      resource: resource.id,
      start: wallToInstant("2026-01-01T00:00", zone),
      end: wallToInstant("2027-01-01T00:00", zone),
      time_zone: zone,
    });
    for (const day of new Set([date, "2026-11-01"]))
      await engine.saveRecord(owner, org, "availability", {
        title: name + " work window " + day,
        employee: person.id,
        kind: "Working hours",
        start: wallToInstant(day + "T00:00", zone),
        end: wallToInstant(day + "T17:00", zone),
        time_zone: zone,
        notes: "Explicit fictional shift; weekly recurrence is deferred.",
      });
  }
}
