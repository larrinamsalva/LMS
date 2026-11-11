import { Temporal } from "@js-temporal/polyfill";
import type { WorkspaceRecord } from "./engine";
import { rateCoversDate } from "./service-rate-card-csv";

export interface ServiceWithoutRate {
  serviceId: string;
  serviceName: string;
  kind: string;
  mode: string;
  unit: string;
}
export type RateCoverageAudit =
  | { status: "choose"; gaps: []; totalActiveServices: 0; coveredServices: 0 }
  | { status: "invalid-date" | "unavailable-area"; gaps: []; totalActiveServices: 0; coveredServices: 0 }
  | {
      status: "ready";
      areaName: string;
      date: string;
      gaps: ServiceWithoutRate[];
      totalActiveServices: number;
      coveredServices: number;
    };

/**
 * Planning-only review of saved catalog coverage, not a quote-readiness
 * validator. A service may not be offered in every area; gaps must be
 * reviewed by the operator. No rate/record is created or updated.
 *
 * Never use names or prices from a different organization.
 * Archived services, areas and rate records never count as live coverage.
 */
export function rateCoverageAudit(
  records: readonly WorkspaceRecord[],
  organizationId: string,
  areaId: string,
  asOfDate: string,
): RateCoverageAudit {
  if (!areaId || !asOfDate) {
    return { status: "choose", gaps: [], totalActiveServices: 0, coveredServices: 0 };
  }
  try {
    if (Temporal.PlainDate.from(asOfDate).toString() !== asOfDate) {
      return { status: "invalid-date", gaps: [], totalActiveServices: 0, coveredServices: 0 };
    }
  } catch {
    return { status: "invalid-date", gaps: [], totalActiveServices: 0, coveredServices: 0 };
  }
  const scoped = records.filter((record) => record.organization_id === organizationId);
  const area = scoped.find((record) =>
    record.id === areaId && record.entity === "pricing-zones" && !record.archived,
  );
  if (!area) {
    return { status: "unavailable-area", gaps: [], totalActiveServices: 0, coveredServices: 0 };
  }
  const services = scoped.filter((record) =>
    record.entity === "services" && !record.archived,
  );
  const rateCoveredServices = new Set(
    scoped.filter((record) =>
      record.entity === "service-rates" && !record.archived &&
      record.data.zone === areaId && rateCoversDate(record, asOfDate),
    ).map((record) => String(record.data.service ?? "")),
  );
  const gaps = services.filter((service) => !rateCoveredServices.has(service.id))
    .map((service) => ({
      serviceId: service.id,
      serviceName: String(service.data.name ?? "Unnamed service"),
      kind: String(service.data.kind ?? ""),
      mode: String(service.data.mode ?? ""),
      unit: String(service.data.unit ?? ""),
    }))
    .sort((a, b) => a.serviceName.localeCompare(b.serviceName) ||
      a.serviceId.localeCompare(b.serviceId));
  return {
    status: "ready",
    areaName: String(area.data.name ?? "Unnamed service area"),
    date: asOfDate,
    gaps,
    totalActiveServices: services.length,
    coveredServices: services.length - gaps.length,
  };
}
