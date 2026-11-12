import { Temporal } from "@js-temporal/polyfill";
import type { WorkspaceRecord } from "./engine";

export type RateDateWindow = 7 | 30 | 90;
export interface UpcomingRateBoundary {
  rateId: string;
  rateTitle: string;
  serviceName: string;
  areaName: string;
  date: string;
  kind: "Starts" | "Ends";
  linkStatus: "Active" | "Archived link" | "Unavailable link";
}
export type UpcomingRateDates =
  | { status: "choose" | "invalid-date" | "invalid-area"; events: []; through: "" }
  | {
      status: "ready";
      events: UpcomingRateBoundary[];
      through: string;
    };

function parsedDate(value: string): Temporal.PlainDate | null {
  try {
    const parsed = Temporal.PlainDate.from(value);
    return parsed.toString() === value ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * A review of already SAVED active-rate start and exclusive end dates.
 * The selected day is excluded, and the final window day is included.
 * There is no automatic "today", calendar scheduling, effective-rate
 * approval, quotation, price change, import or notification.
 *
 * Cross-organization links never display foreign names or raw IDs.
 * Archived rate records are excluded; archived linked entities are
 * visible as retained/archived links for manual review only.
 */
export function upcomingServiceRateDates(
  records: readonly WorkspaceRecord[],
  organizationId: string,
  asOfDate: string,
  selectedAreaId = "",
  days: RateDateWindow = 30,
): UpcomingRateDates {
  if (!asOfDate) return { status: "choose", events: [], through: "" };
  const anchor = parsedDate(asOfDate);
  if (!anchor || !([7, 30, 90] as number[]).includes(days))
    return { status: "invalid-date", events: [], through: "" };
  const scoped = records.filter((r) => r.organization_id === organizationId);
  const refs = new Map(scoped.map((r) => [r.id, r]));
  if (selectedAreaId && refs.get(selectedAreaId)?.entity !== "pricing-zones")
    return { status: "invalid-area", events: [], through: "" };
  const through = anchor.add({ days }).toString();
  const validWithin = (value: unknown): value is string => {
    if (typeof value !== "string" || !parsedDate(value)) return false;
    return value > asOfDate && value <= through;
  };
  const events: UpcomingRateBoundary[] = [];
  for (const rate of scoped) {
    if (rate.entity !== "service-rates" || rate.archived ||
        (selectedAreaId && rate.data.zone !== selectedAreaId)) continue;
    const service = refs.get(String(rate.data.service ?? ""));
    const area = refs.get(String(rate.data.zone ?? ""));
    const validService = service?.entity === "services";
    const validArea = area?.entity === "pricing-zones";
    const status = !validService || !validArea ? "Unavailable link"
      : service!.archived || area!.archived ? "Archived link"
      : "Active";
    const common = {
      rateId: rate.id,
      rateTitle: String(rate.data.title ?? "Untitled saved rate"),
      serviceName: validService
        ? String(service!.data.name ?? "Unnamed service") : "Retained service link",
      areaName: validArea
        ? String(area!.data.name ?? "Unnamed service area") : "Retained area link",
      linkStatus: status as UpcomingRateBoundary["linkStatus"],
    };
    if (validWithin(rate.data.effective_from)) {
      events.push({ ...common, date: rate.data.effective_from, kind: "Starts" });
    }
    if (validWithin(rate.data.effective_until)) {
      events.push({ ...common, date: rate.data.effective_until, kind: "Ends" });
    }
  }
  events.sort((a, b) =>
    a.date.localeCompare(b.date) ||
    (a.kind === "Ends" ? 0 : 1) - (b.kind === "Ends" ? 0 : 1) ||
    a.areaName.localeCompare(b.areaName) ||
    a.rateTitle.localeCompare(b.rateTitle) ||
    a.rateId.localeCompare(b.rateId)
  );
  return { status: "ready", events, through };
}
