import type { WorkspaceRecord } from "./engine";
import {
  lowStockAlerts,
  stockSchema,
  type StockBalance,
} from "./inventory";
import { csvSafeCell } from "./daily-operations-csv";

/**
 * Creates a read-only, planning-only export from the current authorized
 * organization's records and ledger balances. Never trusts UI-derived
 * shortage counts, includes no personal records and places no orders.
 */
export function lowStockPlanningCsv(
  records: readonly WorkspaceRecord[],
  balances: readonly StockBalance[],
  organizationId: string,
  selectedLocationId = "",
): string {
  const scopedRecords = records.filter((r) => r.organization_id === organizationId);
  const scopedBalances = balances.filter((b) => b.organization_id === organizationId);
  const products = new Map(
    scopedRecords.filter((r) => r.entity === "items" && !r.archived)
      .map((r) => [r.id, r]),
  );
  const header = [
    "Product", "SKU", "Storage location", "Units on hand", "Minimum units",
    "Shortfall units", "Unit", "Units per case",
    "Whole cases to cover shortfall (planning only)",
  ];
  const alerts = lowStockAlerts(scopedRecords, scopedBalances).filter((a) =>
    !selectedLocationId || a.locationId === selectedLocationId
  );
  const rows = alerts.map((alert) => {
    const product = products.get(alert.productId);
    const caseValue = String(product?.data.case_size ?? "1");
    const caseSize = stockSchema.safeParse(caseValue).success &&
      BigInt(caseValue) >= 1n && BigInt(caseValue) <= 1_000_000n
      ? BigInt(caseValue) : null;
    const wholeCases = caseSize
      ? ((BigInt(alert.shortfall) + caseSize - 1n) / caseSize).toString()
      : "";
    return [
      alert.productName,
      String(product?.data.sku ?? ""),
      alert.locationName,
      alert.units,
      alert.minimum,
      alert.shortfall,
      alert.unit,
      caseSize?.toString() ?? "",
      wholeCases,
    ];
  });
  return [header, ...rows]
    .map((row) => row.map(csvSafeCell).join(","))
    .join("\r\n") + "\r\n";
}
