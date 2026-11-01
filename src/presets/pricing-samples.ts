import type { Engine, Principal } from "../core/engine";
import { estimateAcknowledgement } from "../core/pricing";
export async function seedPricing(
  engine: Engine,
  owner: Principal,
  org: string,
) {
  const snapshot = await engine.snapshot(owner, org),
    config = snapshot.config.document;
  if (!config.modules.some((m) => m.id === "estimates")) return;
  const definition = config.entities.find((e) => e.id === "estimates")!,
    workTarget = definition.fields.find((f) => f.key === "work")!.target;
  const cleaning = workTarget === "jobs",
    work = snapshot.records.find((r) => r.entity === workTarget)!,
    appointment = snapshot.records.find((r) => r.entity === "appointments")!;
  const zone = await engine.saveRecord(owner, org, "pricing-zones", {
    name: "Local service area",
    description: "Fictional locally defined pricing area; no geocoding.",
  });
  const outer = await engine.saveRecord(owner, org, "pricing-zones", {
    name: "Outer service area",
    description: "Fictional second area with different saved rates.",
  });
  const base = await engine.saveRecord(owner, org, "services", {
    name: cleaning ? "Home cleaning" : "Maintenance labor",
    description: cleaning
      ? "Kitchen, surfaces and room preparation."
      : "Inspection and minor maintenance work.",
    category: cleaning ? "Cleaning" : "Maintenance",
    mode: "Hourly",
    unit: "hour",
    kind: "Service",
  });
  const extra = await engine.saveRecord(owner, org, "services", {
    name: cleaning ? "Oven detail" : "Disposal add-on",
    description: "Optional fictional extra for the selected base service.",
    category: "Extras",
    mode: cleaning ? "Fixed" : "Quantity",
    unit: cleaning ? "oven" : "load",
    kind: "Extra",
    parent: base.id,
  });
  const fixed = await engine.saveRecord(owner, org, "services", {
    name: cleaning ? "Deep-clean package" : "Safety inspection",
    description: "Fictional fixed-price visit.",
    mode: "Fixed",
    unit: "visit",
    kind: "Service",
  });
  const perUnit = await engine.saveRecord(owner, org, "services", {
    name: cleaning ? "Window cleaning" : "Filter replacement",
    description: "Fictional quantity-priced work.",
    mode: "Per unit",
    unit: cleaning ? "window" : "filter",
    kind: "Service",
  });
  const rate = async (
    serviceId: string,
    area: string,
    amount: string,
    title: string,
  ) =>
    engine.saveRecord(owner, org, "service-rates", {
      title,
      service: serviceId,
      zone: area,
      amount,
      effective_from: "2026-01-01",
      effective_until: "2027-01-01",
    });
  const main = await rate(
    base.id,
    zone.id,
    cleaning ? "3500" : "5500",
    "Local hourly rate",
  );
  await rate(
    base.id,
    outer.id,
    cleaning ? "4500" : "6500",
    "Outer-area hourly rate",
  );
  const extraRate = await rate(
    extra.id,
    zone.id,
    cleaning ? "1500" : "2000",
    "Optional extra rate",
  );
  await rate(
    fixed.id,
    zone.id,
    cleaning ? "12000" : "7500",
    "Fixed visit rate",
  );
  await rate(
    perUnit.id,
    zone.id,
    cleaning ? "600" : "1250",
    "Per-unit service rate",
  );
  await engine.saveRecord(owner, org, "estimates", {
    title: cleaning
      ? "Maple House fictional estimate"
      : "Cabin 02 fictional maintenance estimate",
    customer: String(work.data.customer),
    work: work.id,
    appointment: appointment.id,
    zone: zone.id,
    as_of: "2026-11-06",
    status: "Draft",
    notes: "Fictional internal draft; no invoice or customer message.",
    pricing: {
      currency: "USD",
      lines: [
        {
          id: crypto.randomUUID(),
          rateId: main.id,
          rateRevision: main.revision,
          serviceRevision: base.revision,
          quantity: cleaning ? "2.5" : "3",
          note: "",
        },
        {
          id: crypto.randomUUID(),
          rateId: extraRate.id,
          rateRevision: extraRate.revision,
          serviceRevision: extra.revision,
          quantity: cleaning ? "1" : "2",
          note: "",
        },
      ],
      discount: cleaning
        ? { kind: "Amount", value: "500" }
        : { kind: "None", value: "0" },
      tax: cleaning
        ? {
            mode: "Manual",
            basisPoints: "825",
            label: "Fictional demonstration tax",
          }
        : { mode: "None", basisPoints: "0", label: "" },
      acknowledgement: estimateAcknowledgement,
    },
  });
}
