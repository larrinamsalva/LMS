import type { WorkspaceRecord } from "./engine";
import { minorToDecimal } from "./pricing";
import { csvSafeCell } from "./daily-operations-csv";

/**
 * One row per saved rate in the authorized organization's selected
 * active/archived view. No estimate, customer, billing or contact records.
 * Archived linked services/areas are flagged instead of silently presented
 * as active; lost links never reveal raw identifiers.
 */
export function serviceRateCardRows(
  records: readonly WorkspaceRecord[],
  organizationId: string,
  showArchived = false,
): string[][] {
  const scoped = records.filter((r) => r.organization_id === organizationId);
  const references = new Map(scoped.map((r) => [r.id, r]));
  const values = scoped.filter((r) =>
    r.entity === "service-rates" && r.archived === showArchived,
  );
  const rows = values.map((rate) => {
    const serviceId = String(rate.data.service ?? "");
    const zoneId = String(rate.data.zone ?? "");
    const service = references.get(serviceId);
    const area = references.get(zoneId);
    const serviceValid = service?.entity === "services";
    const zoneValid = area?.entity === "pricing-zones";
    const serviceName = serviceValid ? String(service!.data.name ?? "Unnamed service") : "Retained service link";
    const zoneName = zoneValid ? String(area!.data.name ?? "Unnamed area") : "Retained area link";
    return [
      String(rate.data.title ?? "Untitled rate"),
      serviceName,
      serviceValid && service!.archived ? "Archived" : serviceValid ? "Active" : "Unavailable",
      String(serviceValid ? service!.data.kind ?? "" : ""),
      String(serviceValid ? service!.data.mode ?? "" : ""),
      String(serviceValid ? service!.data.unit ?? "" : ""),
      zoneName,
      zoneValid && area!.archived ? "Archived" : zoneValid ? "Active" : "Unavailable",
      minorToDecimal(String(rate.data.amount)),
      String(rate.data.effective_from ?? ""),
      String(rate.data.effective_until ?? ""),
      String(rate.revision),
      rate.archived ? "Archived" : "Active",
    ];
  });
  return rows.sort((a, b) =>
    a[6].localeCompare(b[6]) ||
    a[1].localeCompare(b[1]) ||
    a[9].localeCompare(b[9]) ||
    a[0].localeCompare(b[0]) ||
    a[11].localeCompare(b[11]),
  );
}

/**
 * Read-only catalog audit/export. Dates retain their configured
 * effective-from and exclusive effective-until semantics; the export
 * is not a generated estimate or automatically applicable quote.
 */
export function serviceRateCardCsv(
  records: readonly WorkspaceRecord[],
  organizationId: string,
  showArchived = false,
): string {
  const header = [
    "Rate title", "Service", "Service status", "Service kind",
    "Pricing mode", "Unit", "Service area", "Area status",
    "Rate amount (USD)", "Effective from",
    "Effective until (exclusive)", "Rate revision", "Rate status",
  ];
  return [header, ...serviceRateCardRows(records, organizationId, showArchived)]
    .map((row) => row.map(csvSafeCell).join(","))
    .join("\r\n") + "\r\n";
}
