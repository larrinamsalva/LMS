import { expect, it } from "vitest";
import {
  wallToInstant,
  localTime,
  localDate,
  validateAppointment,
  isTimeZone,
} from "../../src/core/time";
import { validateConfig, validateRecord } from "../../src/core/config";
import { presets } from "../../src/presets";
const zone = "America/Los_Angeles";
it("resolves explicit booking zones independently of the host zone and rejects unknown zones", () => {
  expect(wallToInstant("2026-11-06T10:00", zone)).toBe("2026-11-06T18:00:00Z");
  expect(localTime("2026-11-06T18:00:00Z", zone)).toBe("2026-11-06T10:00");
  expect(localDate("2026-11-06T01:00:00Z", zone)).toBe("2026-11-05");
  for (const bad of ["Invalid/Zone", "+01:00", "", "GMT"])
    expect(isTimeZone(bad)).toBe(false);
  expect(() =>
    validateConfig({ ...presets.property, timeZone: "Invalid/Zone" }),
  ).toThrow();
});
it("refuses nonexistent spring clock times even when an occurrence is selected", () => {
  for (const choice of ["reject", "earlier", "later"] as const)
    expect(() => wallToInstant("2026-03-08T02:30", zone, choice)).toThrow(
      /does not exist/,
    );
});
it("requires an explicit occurrence during the autumn fold and preserves its distinct instant", () => {
  expect(() => wallToInstant("2026-11-01T01:30", zone)).toThrow(/repeats/);
  expect(wallToInstant("2026-11-01T01:30", zone, "earlier")).toBe(
    "2026-11-01T08:30:00Z",
  );
  expect(wallToInstant("2026-11-01T01:30", zone, "later")).toBe(
    "2026-11-01T09:30:00Z",
  );
});
it("validates elapsed-time ranges, minute precision, local dates and bounded scheduling years", () => {
  const base = {
    start: "2026-11-06T18:00:00Z",
    end: "2026-11-06T19:00:00Z",
    time_zone: zone,
    scheduled_date: "2026-11-06",
    status: "Scheduled",
  };
  expect(() => validateAppointment(base)).not.toThrow();
  for (const changes of [
    { end: base.start },
    { end: "2026-11-06T17:00:00Z" },
    { end: "2026-11-07T19:00:00Z" },
    { start: "2026-11-06T18:00:01Z" },
    { scheduled_date: "2026-11-05" },
    { status: "Unknown" },
  ])
    expect(() => validateAppointment({ ...base, ...changes })).toThrow();
  for (const value of [
    "2026-02-30T10:00",
    "2026-11-06T25:00",
    "2019-11-06T10:00",
  ])
    expect(() => wallToInstant(value, zone)).toThrow();
});
it("keeps relationship target and scheduling module contracts explicit", () => {
  const cfg = structuredClone(presets.cleaning),
    job = cfg.entities.find((e) => e.id === "jobs")!;
  job.fields.find((f) => f.key === "customer")!.target = "unknown";
  expect(() => validateConfig(cfg)).toThrow();
  const customer = presets.cleaning.entities.find((e) => e.id === "customers")!;
  expect(validateRecord(customer, { name: "Fictional" }).name).toBe(
    "Fictional",
  );
  const appointment = structuredClone(
    presets.cleaning.entities.find((e) => e.id === "appointments")!,
  );
  appointment.fields.find((f) => f.key === "start")!.type = "text";
  expect(() =>
    validateConfig({
      ...presets.cleaning,
      entities: presets.cleaning.entities.map((e) =>
        e.id === "appointments" ? appointment : e,
      ),
    }),
  ).toThrow();
});
