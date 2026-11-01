import { randomUUID } from "node:crypto";
import {
  Engine,
  EngineError,
  type Principal,
  type WorkspaceRecord,
} from "../core/engine";
import { validateBuildPlan, type BuildPlan } from "../core/buildplan";
import { blueprintJson } from "../core/blueprint";
import { ConfigurationError } from "../core/config";
import {
  rehearsalChecks,
  type RehearsalCheckId,
  type RehearsalOutcome,
} from "../core/rehearsal";
import { estimateAcknowledgement, type EstimatePricing } from "../core/pricing";
/** Internal fixed fixture runner. Host must mint an independent empty fictional organization; never expose this target as request input. */
export async function runFictionalChecks(
  engine: Engine,
  principal: Principal,
  organizationId: string,
  input: BuildPlan,
) {
  const plan = validateBuildPlan(input),
    first = await engine.reviewBuildPlanImpact(principal, organizationId, {
      document: plan,
    });
  const before = await engine.snapshot(principal, organizationId);
  if (
    first.configurationRevision !== 1 ||
    before.populatedEntities.length ||
    before.buildPlans.length ||
    blueprintJson(first.current) !== blueprintJson(plan.configuration)
  )
    throw new EngineError(
      "Rehearsal requires a newly allocated empty fictional workspace with the exact proposal.",
      409,
    );
  const outcomes: RehearsalOutcome[] = Object.keys(rehearsalChecks).map(
    (id) => ({ id: id as RehearsalCheckId, status: "not-run" }),
  );
  const enabled = (module: string) =>
    plan.configuration.modules.some((m) => m.id === module);
  const save = async (
    entity: string,
    data: Record<string, unknown>,
    existing?: WorkspaceRecord,
    operationId?: string,
  ) => {
    const definition = plan.configuration.entities.find(
      (e) => e.id === entity,
    )!;
    const extra = Object.fromEntries(
      definition.fields
        .filter((f) => f.key.startsWith("extra_"))
        .map((f) => [
          f.key,
          (
            {
              text: "Fictional rehearsal value",
              longtext: "Fictional rehearsal notes.",
              email: "rehearsal@example.test",
              date: "2026-11-06",
              number: 1,
            } as Record<string, unknown>
          )[f.type],
        ]),
    );
    return engine.saveRecord(
      principal,
      organizationId,
      entity,
      { ...extra, ...data },
      existing,
      operationId,
    );
  };
  const insist = (truth: unknown) => {
    if (!truth) throw new Error("Fictional invariant check failed.");
  };
  const rejected = async (action: () => Promise<unknown>, pattern: RegExp) => {
    const prior = await engine.snapshot(principal, organizationId);
    let refused = false;
    try {
      await action();
    } catch (e) {
      refused =
        ((e instanceof EngineError && [400, 409].includes(e.status)) ||
          e instanceof ConfigurationError) &&
        pattern.test(e.message);
    }
    insist(refused);
    insist(
      blueprintJson(await engine.snapshot(principal, organizationId)) ===
        blueprintJson(prior),
    );
  };
  let customer: WorkspaceRecord,
    work: WorkspaceRecord,
    appointment: WorkspaceRecord | undefined;
  const workTarget = plan.configuration.entities
    .find((e) => e.id === "appointments")!
    .fields.find((f) => f.key === "work")!.target!;
  for (const check of outcomes) {
    try {
      if (check.id === "configuration") {
        insist(
          blueprintJson(before.config.document) ===
            blueprintJson(plan.configuration),
        );
        const disabled = plan.configuration.entities.find(
          (e) => !enabled(e.module),
        );
        if (disabled)
          await rejected(
            () => engine.saveRecord(principal, organizationId, disabled.id, {}),
            /disabled/i,
          );
      } else if (check.id === "fields") {
        customer = await save("customers", {
          name: "Fictional rehearsal customer",
        });
        const works = new Map<string, WorkspaceRecord>();
        for (const entity of ["tasks", "jobs", "units", "custom-notes"]) {
          const definition = plan.configuration.entities.find(
            (e) => e.id === entity,
          );
          if (!definition || !enabled(definition.module)) continue;
          const data =
            entity === "units"
              ? {
                  label: "Fictional rehearsal site",
                  kind: "RV site",
                  condition: "Ready",
                }
              : entity === "jobs"
                ? {
                    title: "Fictional rehearsal job",
                    customer: customer.id,
                    service: "Standard clean",
                    date: "2026-11-06",
                    status: "Planned",
                  }
                : entity === "tasks"
                  ? {
                      title: "Fictional rehearsal work",
                      customer: customer.id,
                      status: "Open",
                      due: "2026-11-06",
                    }
                  : { title: "Fictional rehearsal notes" };
          works.set(entity, await save(entity, data));
        }
        work = works.get(workTarget)!;
        insist(work);
      } else if (check.id === "relationships") {
        insist(work!.data.customer === customer!.id);
        await rejected(
          () => save(workTarget, { ...work!.data, customer: randomUUID() }),
          /refer|related|same organization|unavailable/i,
        );
        await rejected(
          () =>
            engine.archiveRecord(
              principal,
              organizationId,
              customer!.id,
              customer!.revision,
              true,
            ),
          /depend|refer|related|link/i,
        );
      } else if (check.id === "scheduling") {
        if (!enabled("scheduling")) {
          check.status = "not-applicable";
          continue;
        }
        const resource = await save("resources", {
          name: "Fictional exclusive equipment",
          kind: "Equipment",
        });
        const data = {
          title: "Fictional rehearsal appointment",
          customer: customer!.id,
          work: work!.id,
          resource: resource.id,
          start: "2026-11-06T09:00:00Z",
          end: "2026-11-06T10:00:00Z",
          time_zone: "UTC",
          scheduled_date: "2026-11-06",
          status: "Scheduled",
        };
        const op = randomUUID();
        appointment = await save("appointments", data, undefined, op);
        const original = await engine.snapshot(principal, organizationId);
        insist(
          (await save("appointments", data, undefined, op)).id ===
            appointment.id,
        );
        insist(
          blueprintJson(await engine.snapshot(principal, organizationId)) ===
            blueprintJson(original),
        );
        await rejected(
          () => save("appointments", data, undefined, randomUUID()),
          /resource|overlap|appointment/i,
        );
      } else if (check.id === "inventory") {
        if (!enabled("inventory")) {
          check.status = "not-applicable";
          continue;
        }
        const product = await save("items", {
          name: "Fictional rehearsal supplies",
          unit: "unit",
          case_size: "12",
        });
        const location = await save("stock-locations", {
          name: "Fictional rehearsal shelf",
        });
        const receipt = {
          title: "Fictional receipt",
          product: product.id,
          product_revision: product.revision,
          location: location.id,
          action: "Receiving",
          quantity: "2",
          package: "Cases",
          occurred_on: "2026-11-06",
          reason: "Generated fictional rehearsal only.",
        };
        const op = randomUUID(),
          received = await save("stock-movements", receipt, undefined, op),
          original = await engine.snapshot(principal, organizationId);
        insist(
          (await save("stock-movements", receipt, undefined, op)).id ===
            received.id,
        );
        insist(
          blueprintJson(await engine.snapshot(principal, organizationId)) ===
            blueprintJson(original),
        );
        insist(
          original.stockBalances.find((b) => b.product_id === product.id)
            ?.units === "24",
        );
        await save(
          "stock-movements",
          {
            ...receipt,
            title: "Fictional usage",
            action: "Usage",
            quantity: "1",
            package: "Units",
          },
          undefined,
          randomUUID(),
        );
        insist(
          (await engine.snapshot(principal, organizationId)).stockBalances.find(
            (b) => b.product_id === product.id,
          )?.units === "23",
        );
        await rejected(
          () =>
            save(
              "stock-movements",
              {
                ...receipt,
                action: "Usage",
                quantity: "999",
                package: "Units",
              },
              undefined,
              randomUUID(),
            ),
          /stock|available|insufficient/i,
        );
        await rejected(
          () => save("stock-movements", receipt, received, randomUUID()),
          /immutable|compensating/i,
        );
      } else if (check.id === "estimates") {
        if (!enabled("estimates")) {
          check.status = "not-applicable";
          continue;
        }
        const zone = await save("pricing-zones", {
          name: "Fictional rehearsal area",
        });
        const service = await save("services", {
          name: "Fictional rehearsal service",
          mode: "Fixed",
          unit: "visit",
          kind: "Service",
        });
        const rate = await save("service-rates", {
          title: "Fictional reviewed rate",
          service: service.id,
          zone: zone.id,
          amount: "1000",
          effective_from: "2026-01-01",
          effective_until: "2027-01-01",
        });
        const data = {
          title: "Fictional rehearsal estimate",
          customer: customer!.id,
          work: work!.id,
          ...(appointment ? { appointment: appointment.id } : {}),
          zone: zone.id,
          as_of: "2026-11-06",
          status: "Draft",
          pricing: {
            currency: "USD",
            lines: [
              {
                id: randomUUID(),
                rateId: rate.id,
                rateRevision: rate.revision,
                serviceRevision: service.revision,
                quantity: "1",
                note: "",
              },
            ],
            discount: { kind: "None", value: "0" },
            tax: { mode: "None", basisPoints: "0", label: "" },
            acknowledgement: estimateAcknowledgement,
          },
        };
        const op = randomUUID(),
          estimate = await save("estimates", data, undefined, op);
        insist(
          (estimate.data.pricing as unknown as EstimatePricing).totalMinor ===
            "1000",
        );
        await save("service-rates", { ...rate.data, amount: "2000" }, rate);
        const original = await engine.snapshot(principal, organizationId);
        insist(
          (
            original.records.find((r) => r.id === estimate.id)!.data
              .pricing as unknown as EstimatePricing
          ).totalMinor === "1000",
        );
        insist(
          (await save("estimates", data, undefined, op)).id === estimate.id,
        );
        insist(
          blueprintJson(await engine.snapshot(principal, organizationId)) ===
            blueprintJson(original),
        );
        await rejected(
          () => save("estimates", data, undefined, randomUUID()),
          /rate|price|changed/i,
        );
      }
      check.status = "passed";
    } catch {
      check.status = "failed";
      break;
    }
  }
  return {
    status: outcomes.some((c) => c.status === "failed")
      ? ("failed" as const)
      : ("completed" as const),
    outcomes,
  };
}
