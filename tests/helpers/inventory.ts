import type { Engine, Principal, WorkspaceRecord } from "../../src/core/engine";
export async function inventory(engine: Engine, p: Principal, org: string) {
  const product = await engine.saveRecord(p, org, "items", {
    name: "Fictional supply",
    unit: "piece",
    category: "Supplies",
    sku: "TEST-001",
    barcode: "TEST0001",
    case_size: "12",
    minimum: "5",
  });
  const location = await engine.saveRecord(p, org, "stock-locations", {
    name: "Stock room",
  });
  const destination = await engine.saveRecord(p, org, "stock-locations", {
    name: "Crew kit",
  });
  return { product, location, destination };
}
export function movement(
  product: WorkspaceRecord,
  location: WorkspaceRecord,
  action = "Receiving",
  quantity = "2",
  packaging = "Cases",
) {
  return {
    title: "Fictional stock post",
    product: product.id,
    product_revision: product.revision,
    location: location.id,
    action,
    quantity,
    package: packaging,
    occurred_on: "2026-11-01",
    reason: "Fictional inventory test.",
  };
}
