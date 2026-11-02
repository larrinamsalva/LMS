import { randomUUID } from "node:crypto";
import type { Engine, Principal } from "../../src/core/engine";
import { invoiceLabel } from "../../src/core/invoices";
import { catalog, selection } from "./pricing";
export async function reviewedEstimate(
  engine: Engine,
  p: Principal,
  org: string,
  mode = "Hourly",
  amount = "1001",
) {
  const c = await catalog(engine, p, org, mode, amount);
  const customer = await engine.saveRecord(p, org, "customers", {
    name: "Fictional customer",
  });
  const target = (await engine.snapshot(p, org)).config.document.entities
    .find((e) => e.id === "estimates")!
    .fields.find((f) => f.key === "work")!.target!;
  const work = await engine.saveRecord(p, org, target, {
    title: "Fictional work",
    status: target === "jobs" ? "Planned" : "Open",
    customer: customer.id,
    ...(target === "jobs"
      ? { service: "Standard clean", date: "2026-11-06" }
      : {}),
  });
  const draft = await engine.saveRecord(p, org, "estimates", {
    title: "Fictional invoice example",
    customer: customer.id,
    work: work.id,
    zone: c.zone.id,
    as_of: "2026-11-06",
    status: "Draft",
    pricing: selection(c.rate, c.service, mode === "Fixed" ? "1" : "0.5"),
    notes: "Internal fictional notes",
  });
  const estimate = await engine.saveRecord(
    p,
    org,
    "estimates",
    { ...draft.data, status: "Reviewed draft" },
    draft,
  );
  return { ...c, customer, work, estimate };
}
export const conversion = (
  estimate: { id: string; revision: number },
  configRevision = 1,
) => ({
  kind: "convert" as const,
  estimateId: estimate.id,
  estimateRevision: estimate.revision,
  configRevision,
  acknowledgement: invoiceLabel,
});
export const newOperation = randomUUID;
