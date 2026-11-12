import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import { upcomingServiceRateDatesCsv } from "../../src/core/upcoming-service-rate-dates-csv";
import { upcomingServiceRateDates } from "../../src/core/upcoming-service-rate-dates";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const foreign = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const rec = (
  id: string, entity: string, data: WorkspaceRecord["data"],
  archived = false, organization_id = org,
): WorkspaceRecord => ({
  id, entity, data, archived, organization_id, revision: 1,
  config_revision: 1, created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

it("exports the exact upcoming boundary events in timeline order", () => {
  const records = [
    rec("local", "pricing-zones", { name: "Local area" }),
    rec("outer", "pricing-zones", { name: "Outer area" }),
    rec("service", "services", { name: "House cleaning" }),
    rec("old", "service-rates", {
      title: "Current price", service: "service", zone: "local",
      effective_from: "2026-01-01", effective_until: "2027-01-01",
    }),
    rec("next", "service-rates", {
      title: "New price", service: "service", zone: "local",
      effective_from: "2027-01-01",
    }),
    rec("outer-rate", "service-rates", {
      title: "Outer price", service: "service", zone: "outer",
      effective_from: "2026-12-29",
    }),
    rec("archived", "service-rates", {
      title: "Archived price", service: "service", zone: "local",
      effective_from: "2026-12-29",
    }, true),
    rec("private", "service-rates", {
      title: "Private price", service: "service", zone: "local",
      effective_from: "2026-12-29",
    }, false, foreign),
  ];
  const original = structuredClone(records);
  const audit = upcomingServiceRateDates(records, org, "2026-12-15", "", 30);
  expect(audit.status).toBe("ready");
  const csv = upcomingServiceRateDatesCsv(records, org, "2026-12-15", "", 30);
  const lines = csv.trimEnd().split("\r\n");
  expect(lines).toHaveLength(4);
  expect(lines[1]).toContain('"2026-12-29","Starts","Outer price"');
  expect(lines[2]).toContain('"2027-01-01","Ends (exclusive)","Current price"');
  expect(lines[3]).toContain('"2027-01-01","Starts","New price"');
  expect(lines[0]).toContain('"Operator decision (fill manually)"');
  expect(lines[1]).toMatch(/,"",""$/);
  expect(csv).not.toContain("Private price");
  expect(csv).not.toContain("Archived price");
  const local = upcomingServiceRateDatesCsv(records, org, "2026-12-15", "local", 30);
  expect(local.trimEnd().split("\r\n")).toHaveLength(3);
  expect(local).not.toContain('"Outer price"');
  expect(records).toEqual(original);
});

it("returns header-only when no boundaries fall in the selected window", () => {
  const records = [
    rec("area", "pricing-zones", { name: "Local" }),
    rec("service", "services", { name: "Service" }),
    rec("future", "service-rates", {
      title: "Future", service: "service", zone: "area",
      effective_from: "2027-01-01",
    }),
  ];
  expect(upcomingServiceRateDatesCsv(records, org, "2026-12-15", "area", 7)
    .trimEnd().split("\r\n")).toHaveLength(1);
  expect(upcomingServiceRateDatesCsv(records, org, "2026-12-15", "area", 30))
    .toContain('"Future"');
});

it("fails closed on invalid date, foreign area and unsupported window", () => {
  const records = [
    rec("area", "pricing-zones", { name: "Local" }),
    rec("private", "pricing-zones", { name: "Private" }, false, foreign),
  ];
  expect(() => upcomingServiceRateDatesCsv(records, org, "")).toThrow(
    "Choose an authorized area and valid date/window.",
  );
  expect(() => upcomingServiceRateDatesCsv(records, org, "2026-02-30")).toThrow(
    "Choose an authorized area and valid date/window.",
  );
  expect(() => upcomingServiceRateDatesCsv(records, org, "2026-12-15", "private"))
    .toThrow("Choose an authorized area and valid date/window.");
  expect(() => upcomingServiceRateDatesCsv(records, org, "2026-12-15", "missing"))
    .toThrow("Choose an authorized area and valid date/window.");
  expect(() => upcomingServiceRateDatesCsv(records, org, "2026-12-15", "", 45 as 30))
    .toThrow("Choose an authorized area and valid date/window.");
});

it("sanitizes formula-looking linked titles and hides foreign reference names", () => {
  const records = [
    rec("area", "pricing-zones", { name: "+LOCAL" }),
    rec("service", "services", { name: "=CLEAN()" }),
    rec("foreign-area", "pricing-zones", { name: "Secret area" }, false, foreign),
    rec("foreign-service", "services", { name: "Secret contract" }, false, foreign),
    rec("rate", "service-rates", {
      title: "@PRICE", service: "service", zone: "area",
      effective_from: "2027-01-01",
    }),
    rec("orphan", "service-rates", {
      title: "Retained source", service: "foreign-service", zone: "foreign-area",
      effective_from: "2027-01-02",
    }),
  ];
  const csv = upcomingServiceRateDatesCsv(records, org, "2026-12-15");
  expect(csv).toContain("\"'@PRICE\"");
  expect(csv).toContain("\"'=CLEAN()\"");
  expect(csv).toContain("\"'+LOCAL\"");
  expect(csv).toContain('"Retained service link"');
  expect(csv).toContain('"Retained area link"');
  expect(csv).toContain('"Unavailable link"');
  expect(csv).not.toContain("Secret area");
  expect(csv).not.toContain("Secret contract");
});
