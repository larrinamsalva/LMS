import { expect, it } from "vitest";
import type { WorkspaceRecord } from "../../src/core/engine";
import {
  serviceRateContinuityReviewCsv,
  serviceRateContinuityFilteredCsv,
} from "../../src/core/service-rate-continuity-csv";

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
const rate = (
  id: string, service: string, zone: string, from: string,
  until = "", archived = false, organization_id = org,
): WorkspaceRecord => rec(id, "service-rates", {
  title: id, service, zone, effective_from: from, effective_until: until,
}, archived, organization_id);

it("exports uncovered rate ends, delayed successors and manually reviewed links", () => {
  const records = [
    rec("local", "pricing-zones", { name: "Local area" }),
    rec("outer", "pricing-zones", { name: "Outer area" }),
    rec("retired-area", "pricing-zones", { name: "Former area" }, true),
    rec("svc", "services", { name: "Cleaning" }),
    rec("extra", "services", { name: "Window washing" }),
    rate("covered", "svc", "local", "2026-01-01", "2027-01-01"),
    rate("immediate", "svc", "local", "2027-01-01"),
    rate("delayed", "extra", "local", "2026-01-01", "2027-01-01"),
    rate("later", "extra", "local", "2027-01-05"),
    rate("never", "svc", "outer", "2026-01-01", "2027-01-01"),
    rate("retired-link", "svc", "retired-area", "2026-01-01", "2027-01-01"),
    rate("foreign-successor", "svc", "outer", "2027-01-01", "", false, foreign),
    rate("archived-successor", "svc", "outer", "2027-01-01", "", true),
  ];
  const before = structuredClone(records);
  const csv = serviceRateContinuityReviewCsv(records, org, "2026-12-15", "", 30);
  const lines = csv.trimEnd().split("\r\n");
  expect(lines).toHaveLength(4);
  expect(lines[0]).toContain('"Operator decision (fill manually)"');
  expect(lines[1]).toContain('"retired-link","Cleaning","Former area","2027-01-01","Review links","",""');
  expect(lines[2]).toContain('"delayed","Window washing","Local area","2027-01-01","Uncovered","2027-01-05","4"');
  expect(lines[3]).toContain('"never","Cleaning","Outer area","2027-01-01","Uncovered","",""');
  expect(csv).not.toContain('"covered"');
  expect(csv).not.toContain('"immediate"');
  expect(csv).not.toContain('"foreign-successor"');
  expect(csv).not.toContain('"archived-successor"');
  expect(lines[1]).toMatch(/,"",""$/);
  expect(records).toEqual(before);
  const local = serviceRateContinuityReviewCsv(records, org, "2026-12-15", "local", 30);
  expect(local.trimEnd().split("\r\n")).toHaveLength(2);
  expect(local).not.toContain('"never"');
  expect(local).not.toContain('"retired-link"');
});

it("returns header-only for an empty valid window and fails closed on invalid selections", () => {
  const records = [
    rec("area", "pricing-zones", { name: "Local" }),
    rec("private-area", "pricing-zones", { name: "Private" }, false, foreign),
    rec("svc", "services", { name: "Cleaning" }),
    rate("saved", "svc", "area", "2026-01-01", "2027-01-01"),
  ];
  expect(serviceRateContinuityReviewCsv(records, org, "2026-12-15", "", 7)
    .trimEnd().split("\r\n")).toHaveLength(1);
  expect(serviceRateContinuityReviewCsv(records, org, "2026-12-15", "", 30)
    .trimEnd().split("\r\n")).toHaveLength(2);
  expect(() => serviceRateContinuityReviewCsv(records, org, "")).toThrow(
    "Choose an authorized area and valid date/window.",
  );
  expect(() => serviceRateContinuityReviewCsv(records, org, "2026-02-30")).toThrow(
    "Choose an authorized area and valid date/window.",
  );
  expect(() => serviceRateContinuityReviewCsv(records, org, "2026-12-15", "private-area")).toThrow(
    "Choose an authorized area and valid date/window.",
  );
  expect(() => serviceRateContinuityReviewCsv(records, org, "2026-12-15", "missing")).toThrow(
    "Choose an authorized area and valid date/window.",
  );
  expect(() => serviceRateContinuityReviewCsv(records, org, "2026-12-15", "", 45 as 30)).toThrow(
    "Choose an authorized area and valid date/window.",
  );
});

it("neutralizes spreadsheet formulas and never reveals foreign linked names", () => {
  const records = [
    rec("area", "pricing-zones", { name: "+East" }),
    rec("svc", "services", { name: "=SVC()" }),
    rec("private-area", "pricing-zones", { name: "Competitor secret" }, false, foreign),
    rec("private-svc", "services", { name: "Confidential service" }, false, foreign),
    rate("=EXCEL()", "svc", "area", "2026-01-01", "2027-01-01"),
    rate("retained", "private-svc", "private-area", "2026-01-01", "2027-01-01"),
  ];
  const csv = serviceRateContinuityReviewCsv(records, org, "2026-12-15");
  expect(csv).toContain("\"'=EXCEL()\"");
  expect(csv).toContain("\"'=SVC()\"");
  expect(csv).toContain("\"'+East\"");
  expect(csv).toContain('"retained","Retained service link","Retained area link"');
  expect(csv).toContain('"Review links"');
  expect(csv).not.toContain("Competitor secret");
  expect(csv).not.toContain("Confidential service");
});


it("exports only matching follow-up category without affecting the full checklist", () => {
  const records = [
    rec("local", "pricing-zones", { name: "Local" }),
    rec("outer", "pricing-zones", { name: "Outer" }),
    rec("former", "pricing-zones", { name: "Former" }, true),
    rec("svc", "services", { name: "Cleaning" }),
    rate("delayed", "svc", "local", "2026-01-01", "2027-01-01"),
    rate("future", "svc", "local", "2027-01-05"),
    rate("no-later", "svc", "outer", "2026-01-01", "2027-01-01"),
    rate("bad-link", "svc", "former", "2026-01-01", "2027-01-01"),
    rate("secret", "svc", "outer", "2027-01-01", "", false, foreign),
  ];
  const original = structuredClone(records);
  const full = serviceRateContinuityReviewCsv(records, org, "2026-12-15", "", 30);
  expect(full.trimEnd().split("\r\n")).toHaveLength(4);
  const delayed = serviceRateContinuityFilteredCsv(
    records, org, "2026-12-15", "", 30, "delayed", "", "soonest",
  );
  expect(delayed.trimEnd().split("\r\n")).toHaveLength(2);
  expect(delayed).toContain('"delayed","Cleaning","Local","2027-01-01","Uncovered","2027-01-05","4"');
  expect(delayed).not.toContain('"no-later"');
  const noLater = serviceRateContinuityFilteredCsv(
    records, org, "2026-12-15", "", 30, "no-later", "", "soonest",
  );
  expect(noLater).toContain('"no-later"');
  expect(noLater).not.toContain('"delayed"');
  const linked = serviceRateContinuityFilteredCsv(
    records, org, "2026-12-15", "", 30, "review-links", "", "soonest",
  );
  expect(linked).toContain('"bad-link"');
  expect(linked).not.toContain('"no-later"');
  expect(linked).not.toContain('"delayed"');
  expect(linked).not.toContain('"secret"');
  const searched = serviceRateContinuityFilteredCsv(
    records, org, "2026-12-15", "", 30, "uncovered", "  outER ", "soonest",
  );
  expect(searched.trimEnd().split("\r\n")).toHaveLength(2);
  expect(searched).toContain('"no-later"');
  expect(searched).not.toContain('"delayed"');
  const noMatches = serviceRateContinuityFilteredCsv(
    records, org, "2026-12-15", "", 30, "delayed", "outer", "soonest",
  );
  expect(noMatches.trimEnd().split("\r\n")).toHaveLength(1);
  expect(serviceRateContinuityReviewCsv(records, org, "2026-12-15", "", 30)).toBe(full);
  expect(records).toEqual(original);
});

it("preserves safe spreadsheet cells and denies invalid or foreign-area filtered exports", () => {
  const records = [
    rec("area", "pricing-zones", { name: "+Area" }),
    rec("svc", "services", { name: "=Service()" }),
    rec("foreign-area", "pricing-zones", { name: "Private" }, false, foreign),
    rate("=FORMULA()", "svc", "area", "2026-01-01", "2027-01-01"),
    rate("=secret", "svc", "foreign-area", "2026-01-01", "2027-01-01", false, foreign),
  ];
  const filtered = serviceRateContinuityFilteredCsv(
    records, org, "2026-12-15", "", 30, "no-later", "", "latest",
  );
  expect(filtered).toContain("\"'=FORMULA()\"");
  expect(filtered).toContain("\"'=Service()\"");
  expect(filtered).toContain("\"'+Area\"");
  expect(filtered).not.toContain("=secret");
  expect(filtered).not.toContain("Private");
  expect(filtered).not.toContain("foreign-area");
  const invalid = () => serviceRateContinuityFilteredCsv(
    records, org, "2026-02-30", "", 30, "all", "", "soonest",
  );
  const foreignArea = () => serviceRateContinuityFilteredCsv(
    records, org, "2026-12-15", "foreign-area", 30, "all", "", "soonest",
  );
  expect(invalid).toThrow("Choose an authorized area and valid date/window.");
  expect(foreignArea).toThrow("Choose an authorized area and valid date/window.");
});
