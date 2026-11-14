import { expect, it } from "vitest";
import { resourceTypeQuickView } from "../../src/core/resource-type-quick-view";
import type {
  WorkforceResourceEnrollmentFilter,
  WorkforceResourceTypeFilter,
} from "../../src/core/workforce-resource-directory";

it("keeps existing enrollment selection when switching among Crew, Worker and All", () => {
  for (const enrollment of ["all", "enrolled", "resource-only"] as
    WorkforceResourceEnrollmentFilter[]) {
    for (const kind of ["Crew", "Worker", "all"] as
      WorkforceResourceTypeFilter[]) {
      expect(resourceTypeQuickView(kind, enrollment)).toEqual({
        kind, enrollment,
      });
    }
  }
});

it("resets incompatible employee enrollment whenever selecting Equipment", () => {
  expect(resourceTypeQuickView("Equipment", "all")).toEqual({
    kind: "Equipment", enrollment: "all",
  });
  expect(resourceTypeQuickView("Equipment", "enrolled")).toEqual({
    kind: "Equipment", enrollment: "all",
  });
  expect(resourceTypeQuickView("Equipment", "resource-only")).toEqual({
    kind: "Equipment", enrollment: "all",
  });
  expect(resourceTypeQuickView("Crew", "enrolled")).toEqual({
    kind: "Crew", enrollment: "enrolled",
  });
});
