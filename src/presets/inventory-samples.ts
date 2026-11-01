import { randomUUID } from "node:crypto";
import type { Engine, Principal } from "../core/engine";
export async function seedInventory(
  engine: Engine,
  principal: Principal,
  organizationId: string,
) {
  const snap = await engine.snapshot(principal, organizationId);
  const item = snap.records.find((r) => r.entity === "items")!;
  const property = snap.config.document.industry === "property";
  const product = await engine.saveRecord(
    principal,
    organizationId,
    "items",
    {
      ...item.data,
      unit: property ? "fitting" : "cloth",
      category: property ? "Plumbing" : "Cleaning supplies",
      sku: property ? "RV-FIT-01" : "CL-CLOTH-01",
      barcode: property ? "DEMO-RV-001" : "DEMO-CL-001",
      case_size: "12",
      minimum: "8",
    },
    item,
  );
  const shelf = await engine.saveRecord(
    principal,
    organizationId,
    "stock-locations",
    { name: property ? "Maintenance store" : "Supply shelf" },
  );
  await engine.saveRecord(principal, organizationId, "stock-locations", {
    name: property ? "Park workshop" : "Crew kit",
  });
  const work = snap.records.find(
    (r) => r.entity === (property ? "tasks" : "jobs"),
  );
  await engine.saveRecord(
    principal,
    organizationId,
    "stock-movements",
    {
      title: "Fictional opening receipt",
      product: product.id,
      product_revision: product.revision,
      action: "Receiving",
      quantity: "2",
      package: "Cases",
      location: shelf.id,
      occurred_on: "2026-11-01",
      reason: "Two fictional cases; no purchase or accounting entry.",
    },
    undefined,
    randomUUID(),
  );
  await engine.saveRecord(
    principal,
    organizationId,
    "stock-movements",
    {
      title: "Fictional job usage",
      product: product.id,
      product_revision: product.revision,
      action: "Usage",
      quantity: "3",
      package: "Units",
      location: shelf.id,
      occurred_on: "2026-11-01",
      reason: "Fictional supplies used on sample work.",
      ...(work ? { work: work.id } : {}),
    },
    undefined,
    randomUUID(),
  );
}
