import { z } from "zod";
import type { EntityDefinition, RecordData } from "./config";
import type { WorkspaceRecord } from "./engine";
export const stockActions = [
  "Receiving",
  "Usage",
  "Transfer",
  "Return",
  "Adjustment increase",
  "Adjustment decrease",
] as const;
export const inventoryEntities = [
  "items",
  "stock-locations",
  "stock-movements",
];
export const MAX_STOCK = 999_999_999_999n;
export const stockSchema = z.string().regex(/^(0|[1-9][0-9]{0,11})$/);
export class InventoryError extends Error {}
export function stockUnits(
  quantity: string,
  packaging: string,
  caseSize = "1",
) {
  if (
    !stockSchema.safeParse(quantity).success ||
    BigInt(quantity) < 1n ||
    !stockSchema.safeParse(caseSize).success ||
    BigInt(caseSize) < 1n ||
    BigInt(caseSize) > 1_000_000n ||
    !["Units", "Cases"].includes(packaging)
  )
    throw new InventoryError(
      "Use positive whole quantities and a case size from 1 to 1,000,000.",
    );
  const result =
    BigInt(quantity) * (packaging === "Cases" ? BigInt(caseSize) : 1n);
  if (result > MAX_STOCK)
    throw new InventoryError("Converted quantity exceeds the stock limit.");
  return result.toString();
}
export function inventoryContract(entity: EntityDefinition) {
  if (!inventoryEntities.includes(entity.id))
    return !entity.fields.some((f) => f.type === "stock");
  if (entity.module !== "inventory") return false;
  // Description-only v1 catalogs remain readable and editable without rewriting saved configurations.
  const fields: Record<string, string> =
    entity.id === "items"
      ? { name: "text" }
      : entity.id === "stock-locations"
        ? { name: "text" }
        : {
            title: "text",
            product: "reference",
            product_revision: "number",
            action: "select",
            quantity: "stock",
            package: "select",
            location: "reference",
            occurred_on: "date",
            reason: "longtext",
          };
  if (
    Object.entries(fields).some(
      ([k, t]) =>
        !entity.fields.some((f) => f.key === k && f.type === t && f.required),
    )
  )
    return false;
  if (entity.id === "items") {
    const metadata: Record<string, string> = {
      unit: "text",
      notes: "longtext",
      category: "text",
      sku: "text",
      barcode: "text",
      case_size: "stock",
      minimum: "stock",
    };
    return entity.fields.every(
      (f) => !(f.key in metadata) || f.type === metadata[f.key],
    );
  }
  if (entity.id === "stock-movements") {
    if (
      JSON.stringify(entity.fields.find((f) => f.key === "action")?.options) !==
        JSON.stringify(stockActions) ||
      JSON.stringify(
        entity.fields.find((f) => f.key === "package")?.options,
      ) !== JSON.stringify(["Units", "Cases"])
    )
      return false;
    const targets: Record<string, string> = {
      product: "items",
      location: "stock-locations",
      destination: "stock-locations",
      correction: "stock-movements",
    };
    if (
      Object.entries(targets).some(
        ([k, t]) =>
          !entity.fields.some(
            (f) => f.key === k && f.type === "reference" && f.target === t,
          ),
      )
    )
      return false;
    const work = entity.fields.find((f) => f.key === "work");
    if (
      work &&
      (work.type !== "reference" ||
        !["jobs", "tasks"].includes(work.target ?? ""))
    )
      return false;
  }
  return true;
}
export function validateInventoryRecord(entity: string, data: RecordData) {
  if (
    entity === "items" &&
    data.case_size &&
    (BigInt(String(data.case_size)) < 1n ||
      BigInt(String(data.case_size)) > 1_000_000n)
  )
    throw new InventoryError("Case size must be 1 to 1,000,000 whole units.");
  if (entity !== "stock-movements") return;
  stockUnits(String(data.quantity), String(data.package));
  if (
    !Number.isSafeInteger(data.product_revision) ||
    Number(data.product_revision) < 1
  )
    throw new InventoryError("Select the current product revision.");
  if (
    data.action === "Transfer"
      ? !data.destination || data.destination === data.location
      : !!data.destination
  )
    throw new InventoryError(
      "Only transfers need a different destination location.",
    );
  if (
    String(data.occurred_on) < "2020-01-01" ||
    String(data.occurred_on) > "2100-12-31"
  )
    throw new InventoryError("Use a movement date from 2020 to 2100.");
}
export interface StockBalance {
  organization_id: string;
  product_id: string;
  location_id: string;
  units: string;
}
export interface StockMovement {
  organization_id: string;
  record_id: string;
  operation_id: string;
  actor_id: string;
  actor_name: string;
  action: string;
  product_id: string;
  location_id: string;
  destination_id: string | null;
  work_id: string | null;
  correction_id: string | null;
  quantity: string;
  packaging: string;
  case_size: string;
  units: string;
  occurred_on: string;
  recorded_at: Date | string;
  product_revision: number;
  product_name: string;
  unit: string;
  sku: string;
  barcode: string;
  location_name: string;
  destination_name: string;
  work_title: string;
  reason: string;
}


/** Read-only low-stock snapshot for a single authorized organization. */
export interface LowStockAlert {
  productId: string;
  productName: string;
  locationId: string;
  locationName: string;
  units: string;
  minimum: string;
  shortfall: string;
  unit: string;
}

/**
 * Compare active product/location balances against each product's optional
 * per-location minimum using exact whole units, never floating point.
 * Skip archived/foreign entities, missing or zero minima, invalid balances
 * and balances that already meet their configured minimum.
 */
export function lowStockAlerts(
  records: readonly WorkspaceRecord[],
  balances: readonly StockBalance[],
): LowStockAlert[] {
  const products = records.filter((r) => r.entity === "items" && !r.archived);
  const locations = records.filter((r) => r.entity === "stock-locations" && !r.archived);
  const alerts: LowStockAlert[] = [];
  for (const product of products) {
    const minimum = String(product.data.minimum ?? "0");
    if (!stockSchema.safeParse(minimum).success || BigInt(minimum) === 0n) continue;
    for (const location of locations) {
      if (location.organization_id !== product.organization_id) continue;
      const balance = balances.find((b) =>
        b.organization_id === product.organization_id &&
        b.product_id === product.id && b.location_id === location.id
      );
      const units = balance?.units ?? "0";
      if (!stockSchema.safeParse(units).success || BigInt(units) >= BigInt(minimum))
        continue;
      alerts.push({
        productId: product.id,
        productName: String(product.data.name ?? "Unnamed product"),
        locationId: location.id,
        locationName: String(location.data.name ?? "Unnamed location"),
        units,
        minimum,
        shortfall: (BigInt(minimum) - BigInt(units)).toString(),
        unit: String(product.data.unit || "units"),
      });
    }
  }
  return alerts.sort((a, b) =>
    a.productName.localeCompare(b.productName) ||
    a.locationName.localeCompare(b.locationName) ||
    a.productId.localeCompare(b.productId) ||
    a.locationId.localeCompare(b.locationId)
  );
}


export type LowStockSort = "product" | "shortfall";
export interface LowStockViewOptions {
  query?: string;
  locationId?: string;
  outOfStockOnly?: boolean;
  sort?: LowStockSort;
}

/**
 * Shared, pure display/export filtering of the previously authorized low-stock
 * alerts. Search has the same catalog fields as the product search toolbar.
 * A zero-stock location has exactly zero ledger units, not merely a low level.
 * Largest-shortfall sort uses BigInt to avoid rounding high whole-unit counts.
 */
export function filterLowStockAlerts(
  alerts: readonly LowStockAlert[],
  records: readonly WorkspaceRecord[],
  options: LowStockViewOptions = {},
): LowStockAlert[] {
  const products = new Map(
    records.filter((record) => record.entity === "items" && !record.archived)
      .map((record) => [record.id, record]),
  );
  const needle = (options.query ?? "").trim().toLowerCase();
  const filtered = alerts.filter((alert) => {
    if (options.locationId && alert.locationId !== options.locationId) return false;
    if (options.outOfStockOnly && BigInt(alert.units) !== 0n) return false;
    const product = products.get(alert.productId);
    if (!product) return false;
    return !needle || [
      product.data.name, product.data.sku,
      product.data.barcode, product.data.category,
    ].some((value) => String(value ?? "").toLowerCase().includes(needle));
  });
  const alphabetical = (a: LowStockAlert, b: LowStockAlert) =>
    a.productName.localeCompare(b.productName) ||
    a.locationName.localeCompare(b.locationName) ||
    a.productId.localeCompare(b.productId) ||
    a.locationId.localeCompare(b.locationId);
  return filtered.sort((a, b) => {
    if (options.sort === "shortfall") {
      const left = BigInt(a.shortfall);
      const right = BigInt(b.shortfall);
      if (left !== right) return left > right ? -1 : 1;
    }
    return alphabetical(a, b);
  });
}
