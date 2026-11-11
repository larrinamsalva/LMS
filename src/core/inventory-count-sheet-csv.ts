import type { WorkspaceRecord } from "./engine";
import { stockSchema, type StockBalance } from "./inventory";
import { csvSafeCell } from "./daily-operations-csv";

export interface PhysicalCountRow {
  productName: string;
  sku: string;
  barcode: string;
  locationName: string;
  recordedUnits: string;
  unit: string;
  unitsPerCase: string;
}

/**
 * Read-only inventory snapshot for all active products at active storage
 * locations, including pairs with no posted ledger balance. Every source
 * row is scoped to an already-authorized organization id.
 */
export function physicalCountRows(
  records: readonly WorkspaceRecord[],
  balances: readonly StockBalance[],
  organizationId: string,
  selectedLocationId = "",
  search = "",
): PhysicalCountRow[] {
  const needle = search.trim().toLowerCase();
  const products = records.filter((record) =>
    record.organization_id === organizationId &&
    record.entity === "items" && !record.archived &&
    (!needle || [
      record.data.name, record.data.sku, record.data.barcode,
      record.data.category,
    ].some((value) => String(value ?? "").toLowerCase().includes(needle)))
  );
  const locations = records.filter((record) =>
    record.organization_id === organizationId &&
    record.entity === "stock-locations" && !record.archived &&
    (!selectedLocationId || record.id === selectedLocationId)
  );
  const scopedBalances = new Map<string, string>();
  for (const balance of balances) {
    if (balance.organization_id !== organizationId) continue;
    if (!stockSchema.safeParse(balance.units).success) {
      throw new Error("Invalid recorded inventory balance");
    }
    const key = balance.product_id + ":" + balance.location_id;
    if (scopedBalances.has(key)) {
      throw new Error("Duplicate recorded inventory balance");
    }
    scopedBalances.set(key, balance.units);
  }
  const rows: PhysicalCountRow[] = [];
  for (const location of locations) {
    for (const product of products) {
      const caseSize = String(product.data.case_size ?? "1");
      rows.push({
        productName: String(product.data.name ?? "Unnamed product"),
        sku: String(product.data.sku ?? ""),
        barcode: String(product.data.barcode ?? ""),
        locationName: String(location.data.name ?? "Unnamed location"),
        recordedUnits: scopedBalances.get(product.id + ":" + location.id) ?? "0",
        unit: String(product.data.unit || "units"),
        unitsPerCase: stockSchema.safeParse(caseSize).success &&
          BigInt(caseSize) >= 1n && BigInt(caseSize) <= 1_000_000n
          ? caseSize : "",
      });
    }
  }
  return rows.sort((a, b) =>
    a.locationName.localeCompare(b.locationName) ||
    a.productName.localeCompare(b.productName) ||
    a.sku.localeCompare(b.sku) ||
    a.barcode.localeCompare(b.barcode)
  );
}

/**
 * A printable/editable worksheet, not a ledger adjustment import.
 * Counted quantity, variance and notes are deliberately blank.
 */
export function physicalCountSheetCsv(
  records: readonly WorkspaceRecord[],
  balances: readonly StockBalance[],
  organizationId: string,
  selectedLocationId = "",
  search = "",
): string {
  const header = [
    "Product", "SKU", "Barcode", "Storage location",
    "Recorded units at download", "Counted units (fill manually)",
    "Difference (fill manually)", "Unit", "Units per case",
    "Count notes (optional)",
  ];
  const rows = physicalCountRows(
    records, balances, organizationId, selectedLocationId, search,
  ).map((item) => [
    item.productName, item.sku, item.barcode, item.locationName,
    item.recordedUnits, "", "", item.unit, item.unitsPerCase, "",
  ]);
  return [header, ...rows]
    .map((row) => row.map(csvSafeCell).join(","))
    .join("\r\n") + "\r\n";
}
