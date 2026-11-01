import type { WorkspaceRecord } from "./engine";
import type { EstimateInput, EstimatePricing, RateSnapshot } from "./pricing";
/** Display-only selection; PostgreSQL independently locks/verifies catalog revisions when saving. */
export function catalogSnapshots(
  records: WorkspaceRecord[],
  zoneId: string,
  date: string,
): RateSnapshot[] {
  const zone = records.find(
    (r) => r.entity === "pricing-zones" && r.id === zoneId && !r.archived,
  );
  if (!zone) return [];
  return records
    .filter(
      (r) =>
        r.entity === "service-rates" &&
        !r.archived &&
        r.data.zone === zoneId &&
        String(r.data.effective_from) <= date &&
        (!r.data.effective_until || date < String(r.data.effective_until)),
    )
    .flatMap((rate) => {
      const service = records.find(
        (r) =>
          r.id === rate.data.service && r.entity === "services" && !r.archived,
      );
      return service
        ? [
            {
              serviceId: service.id,
              serviceRevision: service.revision,
              rateId: rate.id,
              rateRevision: rate.revision,
              name: String(service.data.name),
              description: String(service.data.description ?? ""),
              category: String(service.data.category ?? ""),
              mode: service.data.mode as RateSnapshot["mode"],
              unit: String(service.data.unit),
              kind: service.data.kind as RateSnapshot["kind"],
              parent: service.data.parent ? String(service.data.parent) : null,
              amountMinor: String(rate.data.amount),
              zoneId,
              zoneName: String(zone.data.name),
              effectiveFrom: String(rate.data.effective_from),
              effectiveUntil: rate.data.effective_until
                ? String(rate.data.effective_until)
                : null,
            },
          ]
        : [];
    });
}
export const rateKey = (s: {
  rateId: string;
  rateRevision: number;
  serviceRevision: number;
}) => `${s.rateId}:${s.rateRevision}:${s.serviceRevision}`;
export function snapshotsFor(
  input: EstimateInput,
  prior: EstimatePricing | undefined,
  available: RateSnapshot[],
) {
  return input.lines.map((l) => {
    const old = prior?.lines.find(
      (p) => p.id === l.id && rateKey(p) === rateKey(l),
    );
    const s = old?.snapshot ?? available.find((s) => rateKey(s) === rateKey(l));
    if (!s) throw new Error("Choose a rate for every line.");
    return s;
  });
}
