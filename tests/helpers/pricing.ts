import { randomUUID } from "node:crypto";
import type { Engine, Principal, WorkspaceRecord } from "../../src/core/engine";
import {
  estimateAcknowledgement,
  type EstimateInput,
  type EstimatePricing,
} from "../../src/core/pricing";
export async function catalog(
  engine: Engine,
  p: Principal,
  org: string,
  mode = "Hourly",
  amount = "1001",
) {
  const zone = await engine.saveRecord(p, org, "pricing-zones", {
    name: "Fictional local area",
  });
  const service = await engine.saveRecord(p, org, "services", {
    name: "Fictional service",
    description: "Original service description",
    mode,
    unit: mode === "Hourly" ? "hour" : "unit",
    kind: "Service",
  });
  const rate = await engine.saveRecord(p, org, "service-rates", {
    title: "Local service rate",
    service: service.id,
    zone: zone.id,
    amount,
    effective_from: "2026-01-01",
    effective_until: "2027-01-01",
  });
  return { zone, service, rate };
}
export function selection(
  rate: WorkspaceRecord,
  service: WorkspaceRecord,
  quantity = "1",
): EstimateInput {
  return {
    currency: "USD",
    lines: [
      {
        id: randomUUID(),
        rateId: rate.id,
        rateRevision: rate.revision,
        serviceRevision: service.revision,
        quantity,
        note: "",
      },
    ],
    discount: { kind: "None", value: "0" },
    tax: { mode: "None", basisPoints: "0", label: "" },
    acknowledgement: estimateAcknowledgement,
  };
}
export const savedPricing = (r: WorkspaceRecord) =>
  r.data.pricing as EstimatePricing;
