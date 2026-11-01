import { expect, it } from "vitest";
import {
  getEntity,
  validateConfig,
  validateRecord,
} from "../../src/core/config";
import { presets } from "../../src/presets";
import { period } from "../helpers/workforce";
import type { RecordData } from "../../src/core/config";
import { recordWriteRoles } from "../../src/core/workforce";
const entity = getEntity(presets.cleaning, "availability");
const id = "f0faf17b-efaa-4a72-89fe-430504596fea";
it("keeps employee work titles separate from permissions and requires reviewed workforce contracts", () => {
  expect(recordWriteRoles("employees")).toEqual(["owner", "admin"]);
  expect(recordWriteRoles("appointments")).toContain("staff");
  const config = structuredClone(presets.property);
  config.entities
    .find((e) => e.id === "resource-memberships")!
    .fields.find((f) => f.key === "resource")!.target = "customers";
  expect(() => validateConfig(config)).toThrow();
});
it("requires one scoped subject and a finite positive minute period", () => {
  expect(validateRecord(entity, period({ employee: id })).employee).toBe(id);
  for (const change of [
    {},
    { employee: id, resource: id },
    { employee: id, end: "2026-11-06T16:00:00Z" },
    { employee: id, start: "2026-11-06T16:00:01Z" },
    { employee: id, time_zone: "Invalid/Zone" },
  ] as RecordData[])
    expect(() => validateRecord(entity, period(change))).toThrow();
});
it("bounds work windows and time off separately while allowing multi-day vacation", () => {
  expect(() =>
    validateRecord(
      entity,
      period({ employee: id, end: "2026-11-08T02:00:00Z" }),
    ),
  ).toThrow(/24/);
  expect(
    validateRecord(
      entity,
      period({ employee: id, kind: "Vacation", end: "2026-11-20T02:00:00Z" }),
    ).kind,
  ).toBe("Vacation");
  expect(() =>
    validateRecord(
      entity,
      period({ employee: id, kind: "Vacation", end: "2028-01-01T02:00:00Z" }),
    ),
  ).toThrow(/366/);
});
it("uses elapsed-hour limits across a repeated-clock day without rejecting a valid day off", () => {
  const fallDay = period({
    employee: id,
    start: "2026-11-01T07:00:00Z",
    end: "2026-11-02T08:00:00Z",
  });
  expect(() => validateRecord(entity, fallDay)).toThrow(/24/);
  expect(validateRecord(entity, { ...fallDay, kind: "Day off" }).end).toBe(
    "2026-11-02T08:00:00Z",
  );
});
