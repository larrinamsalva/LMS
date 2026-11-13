import { expect, it } from "vitest";
import {
  rosterGapCategoryFilters,
  type RosterGapCategory,
} from "../../src/core/roster-gap-quick-view";
import type {
  WorkforceResourceTypeFilter,
} from "../../src/core/workforce-resource-directory";

it("preserves a selected worker/crew kind when reviewing an enrollment gap", () => {
  for (const kind of ["all", "Worker", "Crew"] as WorkforceResourceTypeFilter[]) {
    expect(rosterGapCategoryFilters("enrolled", kind)).toEqual({
      resourceKind: kind,
      enrollment: "enrolled",
    });
    expect(rosterGapCategoryFilters("resource-only", kind)).toEqual({
      resourceKind: kind,
      enrollment: "resource-only",
    });
  }
});

it("does not apply employee enrollment filtering to equipment gaps", () => {
  for (const kind of ["all", "Crew", "Worker", "Equipment"] as
    WorkforceResourceTypeFilter[]) {
    expect(rosterGapCategoryFilters("equipment", kind)).toEqual({
      resourceKind: "Equipment", enrollment: "all",
    });
  }
});

it("recovers a valid directory filter for worker gaps after an equipment-only view", () => {
  for (const category of ["enrolled", "resource-only"] as RosterGapCategory[]) {
    expect(rosterGapCategoryFilters(category, "Equipment")).toEqual({
      resourceKind: "all", enrollment: category,
    });
  }
});
