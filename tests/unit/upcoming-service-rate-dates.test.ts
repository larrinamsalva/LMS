import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
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

it("shows upcoming starts and exclusive ends, ordered by date and boundary kind", () => {
  const records = [
    rec("local", "pricing-zones", { name: "Local" }),
    rec("outer", "pricing-zones", { name: "Outer" }),
    rec("cleaning", "services", { name: "House cleaning" }),
    rec("end", "service-rates", {
      title: "Current period", service: "cleaning", zone: "local",
      effective_from: "2026-01-01", effective_until: "2027-01-01",
    }),
    rec("start", "service-rates", {
      title: "Next period", service: "cleaning", zone: "local",
      effective_from: "2027-01-01", effective_until: "2027-05-01",
    }),
    rec("outer-rate", "service-rates", {
      title: "Outer future", service: "cleaning", zone: "outer",
      effective_from: "2026-12-29", effective_until: "",
    }),
    rec("retired", "service-rates", {
      title: "Archived rate", service: "cleaning", zone: "local",
      effective_from: "2026-12-31",
    }, true),
    rec("other-org", "service-rates", {
      title: "Secret foreign", service: "cleaning", zone: "local",
      effective_from: "2026-12-20",
    }, false, foreign),
  ];
  const original = structuredClone(records);
  const result = upcomingServiceRateDates(records, org, "2026-12-15", "", 30);
  expect(result.status).toBe("ready");
  if (result.status === "ready") {
    expect(result.through).toBe("2027-01-14");
    expect(result.events.map((e) => [e.kind, e.rateTitle, e.date])).toEqual([
      ["Starts", "Outer future", "2026-12-29"],
      ["Ends", "Current period", "2027-01-01"],
      ["Starts", "Next period", "2027-01-01"],
    ]);
    expect(result.events[1].serviceName).toBe("House cleaning");
    expect(result.events[1].linkStatus).toBe("Active");
  }
  const local = upcomingServiceRateDates(records, org, "2026-12-15", "local", 30);
  expect(local.status).toBe("ready");
  if (local.status === "ready") expect(local.events).toHaveLength(2);
  const seven = upcomingServiceRateDates(records, org, "2026-12-15", "", 7);
  expect(seven.status).toBe("ready");
  if (seven.status === "ready") expect(seven.events).toHaveLength(0);
  expect(records).toEqual(original);
});

it("includes the last day, excludes the chosen date and rejects invalid date/area", () => {
  const records = [
    rec("area", "pricing-zones", { name: "Area" }),
    rec("private-area", "pricing-zones", { name: "Secret area" }, false, foreign),
    rec("service", "services", { name: "Maintenance" }),
    rec("same-day", "service-rates", {
      title: "Already starts", service: "service", zone: "area",
      effective_from: "2026-12-15",
    }),
    rec("last-day", "service-rates", {
      title: "Final day", service: "service", zone: "area",
      effective_from: "2027-01-14",
    }),
    rec("next-day", "service-rates", {
      title: "Beyond limit", service: "service", zone: "area",
      effective_from: "2027-01-15",
    }),
  ];
  expect(upcomingServiceRateDates(records, org, "").status).toBe("choose");
  expect(upcomingServiceRateDates(records, org, "2026-02-30").status)
    .toBe("invalid-date");
  expect(upcomingServiceRateDates(records, org, "2026-1-1").status)
    .toBe("invalid-date");
  expect(upcomingServiceRateDates(records, org, "2026-12-15", "private-area").status)
    .toBe("invalid-area");
  expect(upcomingServiceRateDates(records, org, "2026-12-15", "unknown").status)
    .toBe("invalid-area");
  const ready = upcomingServiceRateDates(records, org, "2026-12-15");
  expect(ready.status).toBe("ready");
  if (ready.status === "ready") {
    expect(ready.events.map((e) => e.rateTitle)).toEqual(["Final day"]);
  }
});

it("marks archived or unavailable links without exposing foreign linked names", () => {
  const records = [
    rec("area", "pricing-zones", { name: "Active area" }),
    rec("archived-area", "pricing-zones", { name: "Former area" }, true),
    rec("private-area", "pricing-zones", { name: "Private competitor zone" }, false, foreign),
    rec("service", "services", { name: "Repair" }),
    rec("archived-service", "services", { name: "Old service" }, true),
    rec("private-service", "services", { name: "Private customer service" }, false, foreign),
    rec("archived-link-rate", "service-rates", {
      title: "Review old link", service: "archived-service", zone: "archived-area",
      effective_until: "2027-01-01",
    }),
    rec("cross-org", "service-rates", {
      title: "Retained record", service: "private-service", zone: "private-area",
      effective_from: "2027-01-01",
    }),
  ];
  const result = upcomingServiceRateDates(records, org, "2026-12-15");
  expect(result.status).toBe("ready");
  if (result.status === "ready") {
    expect(result.events).toHaveLength(2);
    const archive = result.events.find((e) => e.rateTitle === "Review old link")!;
    expect(archive.linkStatus).toBe("Archived link");
    const unavailable = result.events.find((e) => e.rateTitle === "Retained record")!;
    expect(unavailable.linkStatus).toBe("Unavailable link");
    expect(unavailable.areaName).toBe("Retained area link");
    expect(unavailable.serviceName).toBe("Retained service link");
    expect(JSON.stringify(result)).not.toContain("Private competitor");
    expect(JSON.stringify(result)).not.toContain("Private customer");
  }
});
