import { randomUUID } from "node:crypto";
import type { Engine, Principal, WorkspaceRecord } from "../../src/core/engine";
import type { RecordData } from "../../src/core/config";
export const period = (changes: RecordData = {}): RecordData => ({
  title: "Fictional work window",
  kind: "Working hours",
  time_zone: "America/Los_Angeles",
  start: "2026-11-06T16:00:00Z",
  end: "2026-11-07T02:00:00Z",
  ...changes,
});
export async function employee(
  engine: Engine,
  owner: Principal,
  org: string,
  name = "Avery Example",
) {
  const profile = await engine.saveRecord(owner, org, "employees", {
    name,
    role: "Cleaning and maintenance",
    skills: "Cleaning, minor repairs",
    status: "Active",
  });
  const hours = await engine.saveRecord(
    owner,
    org,
    "availability",
    period({ employee: profile.id }),
  );
  return { profile, hours };
}
export async function enroll(
  engine: Engine,
  owner: Principal,
  org: string,
  resource: WorkspaceRecord,
  person: WorkspaceRecord,
  changes: RecordData = {},
) {
  return engine.saveRecord(
    owner,
    org,
    "resource-memberships",
    {
      title: `${person.data.name} / ${resource.data.name}`,
      employee: person.id,
      resource: resource.id,
      start: "2026-01-01T08:00:00Z",
      end: "2027-01-01T08:00:00Z",
      time_zone: "America/Los_Angeles",
      ...changes,
    },
    undefined,
    randomUUID(),
  );
}
