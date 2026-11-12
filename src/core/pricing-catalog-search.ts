import type { WorkspaceRecord } from "./engine";
import { rateCoversDate, rateMatchesArea } from "./service-rate-card-csv";

export interface PricingCatalogCards {
  services: WorkspaceRecord[];
  rates: WorkspaceRecord[];
  zones: WorkspaceRecord[];
}

function includesQuery(value: unknown, query: string): boolean {
  return String(value ?? "").toLocaleLowerCase().includes(query);
}

/**
 * Search existing catalog cards without altering exports, audit coverage,
 * estimates, or the saved data. No cross-organization linked names/IDs
 * are returned or used as search hits.
 *
 * Date/area filters apply only to saved rate cards, as they did before
 * search; catalog services and pricing areas retain their own views.
 */
export function filterPricingCatalogCards(
  records: readonly WorkspaceRecord[],
  organizationId: string,
  archived: boolean,
  asOfDate: string,
  selectedAreaId: string,
  searchText: string,
): PricingCatalogCards {
  const scoped = records.filter((r) => r.organization_id === organizationId);
  const refs = new Map(scoped.map((r) => [r.id, r]));
  const query = searchText.trim().toLocaleLowerCase();
  const matchFields = (record: WorkspaceRecord, fields: string[]): boolean =>
    !query || fields.some((field) => includesQuery(record.data[field], query));
  const services = scoped.filter((r) =>
    r.entity === "services" && r.archived === archived &&
    matchFields(r, ["name", "description", "category", "kind", "mode", "unit"]),
  );
  const zones = scoped.filter((r) =>
    r.entity === "pricing-zones" && r.archived === archived &&
    matchFields(r, ["name", "description"]),
  );
  const rates = scoped.filter((r) => {
    if (r.entity !== "service-rates" || r.archived !== archived ||
        !rateCoversDate(r, asOfDate) || !rateMatchesArea(r, selectedAreaId))
      return false;
    if (!query) return true;
    const service = refs.get(String(r.data.service ?? ""));
    const area = refs.get(String(r.data.zone ?? ""));
    const serviceName = service?.entity === "services" ? service.data.name : "";
    const areaName = area?.entity === "pricing-zones" ? area.data.name : "";
    return includesQuery(r.data.title, query) ||
      includesQuery(serviceName, query) || includesQuery(areaName, query);
  });
  return { services, rates, zones };
}
