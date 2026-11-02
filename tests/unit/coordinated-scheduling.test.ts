import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  appointmentResourcesSchema,
  coordinatedConfirmation,
  reviewAppointmentResources,
} from "../../src/core/coordinated-scheduling";
import {
  newBuildPlan,
  selectModules,
  validateBuildPlan,
  brandBuildPlan,
} from "../../src/core/buildplan";
import {
  createBlueprintPackage,
  importBlueprintPackage,
} from "../../src/core/blueprint";
import { defaultBranding } from "../../src/core/branding";
import { validateConfig } from "../../src/core/config";
import { wallToInstant, validateAppointment } from "../../src/core/time";
it.each(["property", "cleaning", "custom"] as const)(
  "keeps %s opt-in, resolves dependencies and preserves strict portable v1/v2 readers",
  async (template) => {
    const old = newBuildPlan(template),
      plan = {
        ...old,
        configuration: selectModules(old.configuration, [
          ...old.configuration.modules.map((m) => m.id),
          "coordinated-scheduling",
        ]),
      };
    expect(
      old.configuration.modules.some((m) => m.id === "coordinated-scheduling"),
    ).toBe(false);
    expect(plan.configuration.modules.map((m) => m.id)).toEqual(
      expect.arrayContaining([
        "equipment",
        "equipment-reservations",
        "coordinated-scheduling",
        "workforce",
        "scheduling",
        "inventory",
      ]),
    );
    expect(() =>
      validateConfig({
        ...plan.configuration,
        modules: plan.configuration.modules.filter(
          (m) => m.id !== "equipment-reservations",
        ),
      }),
    ).toThrow(/dependencies/i);
    for (const config of [
      validateBuildPlan(plan),
      brandBuildPlan(plan, defaultBranding(template)),
    ])
      expect(
        (
          await importBlueprintPackage(
            await createBlueprintPackage(config, {
              name: "Fictional coordinated schedule",
              description: "Explicit optional resource commitments",
            }),
          )
        ).plan,
      ).toEqual(config);
  },
);
it("requires exact revision/identity proofs and one bounded additional resource without arbitrary fields", () => {
  const input = {
    version: 1,
    configRevision: 1,
    primaryId: randomUUID(),
    primaryRevision: 1,
    equipment: {
      resourceId: randomUUID(),
      resourceRevision: 1,
      equipmentId: randomUUID(),
      equipmentRevision: 1,
      mappingRevision: 1,
    },
    acknowledgement: coordinatedConfirmation,
  };
  expect(appointmentResourcesSchema.parse(input)).toEqual(input);
  for (const changes of [
    { equipment: [input.equipment] },
    { configRevision: 0 },
    { primaryRevision: 2147483648 },
    { version: 2 },
    { acknowledgement: "CONFIRM" },
    { sql: "execute" },
    { equipment: { ...input.equipment, thirdResource: randomUUID() } },
  ])
    expect(
      appointmentResourcesSchema.safeParse({ ...input, ...changes }).success,
    ).toBe(false);
  expect(() =>
    reviewAppointmentResources(1, [], [], input.primaryId, null),
  ).toThrow(/Crew or Worker/i);
});
it("uses the existing DST/overnight/whole-minute rules for the shared appointment interval", () => {
  const zone = "America/Los_Angeles";
  expect(() => wallToInstant("2026-03-08T02:15", zone, "earlier")).toThrow(
    /does not exist/,
  );
  expect(() => wallToInstant("2026-11-01T01:15", zone)).toThrow(/repeats/);
  const start = wallToInstant("2026-11-01T01:15", zone, "earlier"),
    end = wallToInstant("2026-11-01T01:15", zone, "later");
  expect(() =>
    validateAppointment({
      start,
      end,
      time_zone: zone,
      scheduled_date: "2026-11-01",
      status: "Scheduled",
    }),
  ).not.toThrow();
  expect(() =>
    validateAppointment({
      start: "2026-11-07T07:30:00Z",
      end: "2026-11-07T09:00:00Z",
      time_zone: zone,
      scheduled_date: "2026-11-06",
      status: "Scheduled",
    }),
  ).not.toThrow();
});
