import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  equipmentMappingSchema,
  mappingConfirmation,
  equipmentReservationWarning,
} from "../../src/core/equipment-reservations";
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
import { validateConfig } from "../../src/core/config";
import { defaultBranding } from "../../src/core/branding";
import { wallToInstant, validateAppointment } from "../../src/core/time";
it.each(["property", "cleaning", "custom"] as const)(
  "keeps %s mapping opt-in with strict dependencies and unchanged v1/v2 envelopes",
  async (template) => {
    const original = newBuildPlan(template);
    expect(
      original.configuration.modules.some(
        (m) => m.id === "equipment-reservations",
      ),
    ).toBe(false);
    const enabled = {
      ...original,
      configuration: selectModules(original.configuration, [
        ...original.configuration.modules.map((m) => m.id),
        "equipment-reservations",
      ]),
    };
    expect(enabled.configuration.modules.map((m) => m.id)).toEqual(
      expect.arrayContaining([
        "equipment-reservations",
        "equipment",
        "scheduling",
        "workforce",
        "inventory",
        "tasks",
        "customers",
      ]),
    );
    expect(() =>
      validateConfig({
        ...enabled.configuration,
        modules: enabled.configuration.modules.filter(
          (m) => m.id !== "workforce",
        ),
      }),
    ).toThrow(/dependencies/i);
    for (const plan of [
      validateBuildPlan(enabled),
      brandBuildPlan(enabled, defaultBranding(template)),
    ]) {
      const zip = await createBlueprintPackage(plan, {
        name: "Fictional equipment blueprint",
        description: "Explicit equipment reservation capability only",
      });
      expect((await importBlueprintPackage(zip)).plan).toEqual(plan);
    }
    expect(
      original.configuration.modules.some((m) => m.id === "equipment"),
    ).toBe(false);
  },
);
it("refuses missing revisions, unknown command fields and implicit confirmation", () => {
  const req = {
    kind: "map",
    equipmentId: randomUUID(),
    equipmentRevision: 1,
    resourceId: randomUUID(),
    resourceRevision: 1,
    mappingRevision: 0,
    configRevision: 1,
    acknowledgement: mappingConfirmation,
    notes: "Explicit fictional map",
  };
  expect(equipmentMappingSchema.parse(req)).toEqual(req);
  for (const changes of [
    { resourceRevision: 0 },
    { mappingRevision: -1 },
    { equipmentRevision: 1.5 },
    { acknowledgement: "CONFIRM" },
    { sql: "drop" },
    { organizationId: randomUUID() },
    { kind: "adopt-name" },
  ])
    expect(
      equipmentMappingSchema.safeParse({ ...req, ...changes }).success,
    ).toBe(false);
  expect(equipmentReservationWarning(undefined, [], req.equipmentId)).toMatch(
    /missing/,
  );
});
it("uses existing whole-minute, DST, elapsed-time and midnight invariants without an alternate calendar", () => {
  const zone = "America/Los_Angeles";
  expect(() => wallToInstant("2026-03-08T02:30", zone, "later")).toThrow(
    /does not exist/,
  );
  expect(() => wallToInstant("2026-11-01T01:30", zone)).toThrow(/repeats/);
  const start = wallToInstant("2026-11-01T01:30", zone, "earlier"),
    end = wallToInstant("2026-11-01T01:30", zone, "later");
  expect(start).not.toBe(end);
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
  expect(() =>
    validateAppointment({
      start: start.replace(":00Z", ":01Z"),
      end,
      time_zone: zone,
      scheduled_date: "2026-11-01",
      status: "Scheduled",
    }),
  ).toThrow(/minute/);
});
