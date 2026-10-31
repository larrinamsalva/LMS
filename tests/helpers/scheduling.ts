import type { Engine, Principal, WorkspaceRecord } from "../../src/core/engine";
import type { RecordData } from "../../src/core/config";
export function appointmentData(
  workflow: {
    customer: WorkspaceRecord;
    work: WorkspaceRecord;
    resource: WorkspaceRecord;
    site?: WorkspaceRecord;
  },
  changes: RecordData = {},
): RecordData {
  return {
    title: "Fictional scheduled work",
    customer: workflow.customer.id,
    work: workflow.work.id,
    resource: workflow.resource.id,
    ...(workflow.site ? { site: workflow.site.id } : {}),
    start: "2026-11-06T18:00:00Z",
    end: "2026-11-06T19:00:00Z",
    time_zone: "America/Los_Angeles",
    scheduled_date: "2026-11-06",
    status: "Scheduled",
    notes: "Fictional test only.",
    ...changes,
  };
}
export async function workflow(
  engine: Engine,
  principal: Principal,
  org: string,
  industry: "property" | "cleaning",
) {
  const customer = await engine.saveRecord(principal, org, "customers", {
    name: "Fictional scheduling customer",
  });
  const site =
    industry === "property"
      ? await engine.saveRecord(principal, org, "units", {
          label: "Fictional Site 7",
          kind: "RV site",
          condition: "Ready",
        })
      : undefined;
  const work = await engine.saveRecord(
    principal,
    org,
    industry === "cleaning" ? "jobs" : "tasks",
    industry === "cleaning"
      ? {
          title: "Fictional cleaning job",
          service: "Deep clean",
          date: "2026-11-06",
          status: "Planned",
          customer: customer.id,
        }
      : {
          title: "Fictional maintenance request",
          status: "Open",
          customer: customer.id,
          site: site!.id,
        },
  );
  const resource = await engine.saveRecord(principal, org, "resources", {
    name: industry === "cleaning" ? "Fictional crew" : "Fictional worker",
    kind: industry === "cleaning" ? "Crew" : "Worker",
  });
  return { customer, site, work, resource };
}
