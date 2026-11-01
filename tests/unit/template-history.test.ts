import { expect, it } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  reviewedTemplateHistory,
  validateTemplateHistory,
  savedTemplateBaseline,
  latestTemplate,
  planDigest,
} from "../../src/core/template-history";
import {
  reviewTemplateUpdate,
  proposeTemplateUpdate,
  useTemplateChanges,
  templateValue,
} from "../../src/core/template-update";
import { reviewedGallery } from "../../src/core/gallery";
import {
  brandBuildPlan,
  addCustomField,
  selectModules,
  parseBuildPlanText,
} from "../../src/core/buildplan";
import { defaultBranding } from "../../src/core/branding";
import {
  blueprintJson,
  importBlueprintPackage,
  createBlueprintPackage,
} from "../../src/core/blueprint";
const root = (document: any, id = randomUUID(), revision = 1) => ({
  id,
  revision,
  base_revision: 1,
  document,
  created_by: randomUUID(),
  created_at: "2026-01-01T00:00:00Z",
});
it("validates all frozen editions, reader declarations, metadata/module contracts and independent content digests", async () => {
  const history = await reviewedTemplateHistory();
  expect(history).toHaveLength(7);
  for (const entry of reviewedGallery()) {
    expect(
      history.find(
        (h) =>
          h.entry.metadata.id === entry.metadata.id &&
          h.entry.metadata.revision === 1,
      )?.entry,
    ).toEqual(entry);
  }
  for (const snapshot of history) {
    const { sha256, ...payload } = snapshot;
    expect(
      createHash("sha256").update(blueprintJson(payload)).digest("hex"),
    ).toBe(sha256);
    expect(snapshot.planSha256).toBe(await planDigest(snapshot.entry.plan));
    expect(snapshot.reader.modules).toEqual(
      snapshot.entry.plan.configuration.modules,
    );
  }
  expect(
    latestTemplate(history, "basic-cleaning")!.entry.metadata.revision,
  ).toBe(2);
  expect(
    latestTemplate(history, "property-maintenance")!.reader.buildPlan,
  ).toBe(2);
  const old = await importBlueprintPackage(
    await readFile("tests/fixtures/blueprint-v1.zip"),
  );
  expect(
    history.find(
      (s) =>
        s.entry.metadata.id === "basic-cleaning" &&
        s.entry.metadata.revision === 1,
    )!.entry.plan,
  ).toEqual(old.plan);
});
it("refuses corrupt, normalized, duplicate, missing, unsupported-reader and unreviewed history even with repaired hashes", async () => {
  const history = await reviewedTemplateHistory();
  for (const change of [
    (h: any[]) => {
      h[0].entry.plan.configuration.name = "Altered";
    },
    (h: any[]) => {
      h[0].entry.metadata.purpose = " " + h[0].entry.metadata.purpose;
    },
    (h: any[]) => {
      h[0].reader.engineApi = 2;
    },
    (h: any[]) => {
      h[0].reader.templateVersion = 2;
    },
    (h: any[]) => {
      h[0].reader.configurationSchema = 2;
    },
    (h: any[]) => {
      h[0].reader.modules[0].version = "9.0.0";
    },
    (h: any[]) => {
      h[0].entry.metadata.revision = 99;
    },
    (h: any[]) => {
      h[0].entry.execute = "alert(1)";
    },
    (h: any[]) => {
      h.push(h[0]);
    },
    (h: any[]) => {
      h.pop();
    },
  ]) {
    const next = structuredClone(history);
    change(next);
    await expect(validateTemplateHistory(next)).rejects.toThrow();
    if (next[0]) {
      const { sha256: _old, ...payload } = next[0];
      next[0].sha256 = createHash("sha256")
        .update(blueprintJson(payload))
        .digest("hex");
    }
    await expect(validateTemplateHistory(next)).rejects.toThrow();
  }
});
it("returns detached history copies and never changes snapshots when users customize them", async () => {
  const first = await reviewedTemplateHistory(),
    saved = structuredClone(first);
  first[0].entry.plan.configuration.name = "My company";
  first[0].changes.push("Mutated");
  expect(await reviewedTemplateHistory()).toEqual(saved);
});
it("establishes only an exact complete saved baseline; hints, changed roots, gaps and wrong identities remain unverified", async () => {
  const h = await reviewedTemplateHistory(),
    old = h[0],
    r = root(old.entry.plan),
    current = brandBuildPlan(old.entry.plan, defaultBranding("cleaning"));
  expect(
    (
      await savedTemplateBaseline(
        h,
        [r, root(current, r.id, 2)],
        r.id,
        2,
        current,
      )
    )?.sha256,
  ).toBe(old.sha256);
  expect(await savedTemplateBaseline(h, [r], null, 1, current)).toBeUndefined();
  expect(await savedTemplateBaseline(h, [], r.id, 1, current)).toBeUndefined();
  expect(
    await savedTemplateBaseline(
      h,
      [r, root(current, r.id, 3)],
      r.id,
      3,
      current,
    ),
  ).toBeUndefined();
  const changed = structuredClone(old.entry.plan);
  changed.configuration.name = "Customized before first save";
  expect(
    await savedTemplateBaseline(h, [root(changed, r.id)], r.id, 1, changed),
  ).toBeUndefined();
  expect(
    await savedTemplateBaseline(
      h,
      [r],
      r.id,
      1,
      h.find((s) => s.entry.metadata.id === "rv-property")!.entry.plan,
    ),
  ).toBeUndefined();
});
it("distinguishes optional suggestions, kept customizations and real three-way conflicts without selecting or merging", async () => {
  const h = await reviewedTemplateHistory(),
    base = h[0],
    next = latestTemplate(h, "basic-cleaning")!,
    current = structuredClone(base.entry.plan);
  current.configuration.name = "My retained business";
  current.configuration.entities[0].singular = "Patron";
  const before = structuredClone(current),
    review = reviewTemplateUpdate(current, next, base, 1);
  expect(review.changes.find((r) => r.id === "name")?.classification).toBe(
    "customized",
  );
  expect(
    review.changes.find((r) => r.id === "term:customers:singular")
      ?.classification,
  ).toBe("conflict");
  expect(
    review.changes.find((r) => r.id === "module:scheduling")?.classification,
  ).toBe("suggestion");
  expect(proposeTemplateUpdate(review, [])).toEqual(current);
  expect(current).toEqual(before);
  expect(
    templateValue({
      key: "extra_priority",
      label: "Priority",
      type: "select",
      required: false,
      options: ["Standard", "Urgent"],
    }),
  ).toContain("choices: Standard, Urgent");
  expect(
    reviewTemplateUpdate(current, next, undefined, 1).changes.every(
      (r) => r.classification === "informational",
    ),
  ).toBe(true);
});
it("applies only explicitly chosen supported edits and preserves name, branding, terms, optional fields and other modules", async () => {
  const h = await reviewedTemplateHistory(),
    base = h[0],
    target = latestTemplate(h, "basic-cleaning")!;
  let current = brandBuildPlan(base.entry.plan, {
    ...defaultBranding("cleaning"),
    palette: "plum-v1",
    tagline: "My retained identity",
  });
  current.configuration.name = "Custom retained name";
  current.configuration.entities[0].plural = "My clients";
  current.configuration = addCustomField(current.configuration, "customers", {
    key: "extra_my_note",
    label: "My note",
    type: "text",
    required: false,
  });
  const review = reviewTemplateUpdate(current, target, base, 1),
    result = useTemplateChanges(review, ["module:scheduling"], {
      current,
      config: current.configuration,
      populated: [],
      revision: 1,
      allowVersionChange: false,
    });
  expect(result.configuration.name).toBe(current.configuration.name);
  expect(result.configuration.branding).toEqual(current.configuration.branding);
  expect(result.configuration.entities).toEqual(current.configuration.entities);
  expect(result.version).toBe(2);
  expect(result.configuration.modules.map((m) => m.id)).toEqual([
    ...current.configuration.modules.map((m) => m.id),
    "scheduling",
  ]);
  for (const plan of [result, base.entry.plan])
    expect(parseBuildPlanText(JSON.stringify(plan))).toEqual(plan);
  const packaged = await importBlueprintPackage(
    await createBlueprintPackage(result, {
      name: "Retained choices",
      description: "Fictional only.",
    }),
  );
  expect(packaged.plan).toEqual(result);
  expect(packaged.manifest.version).toBe(2);
});
it("does not silently repair dependency choices, exceed optional fields or accept unknown/duplicate operations", async () => {
  const h = await reviewedTemplateHistory(),
    base = h[0],
    target = latestTemplate(h, "basic-cleaning")!,
    current = structuredClone(base.entry.plan);
  current.configuration = selectModules(current.configuration, []);
  const review = reviewTemplateUpdate(current, target, base, 1);
  expect(() => proposeTemplateUpdate(review, ["module:scheduling"])).toThrow(
    /dependencies/,
  );
  expect(
    proposeTemplateUpdate(review, [
      "module:scheduling",
      "module:cleaning",
    ]).configuration.modules.map((m) => m.id),
  ).toContain("cleaning");
  expect(() => proposeTemplateUpdate(review, ["execute:script"])).toThrow(
    /unsupported/,
  );
  expect(() =>
    proposeTemplateUpdate(review, ["module:scheduling", "module:scheduling"]),
  ).toThrow(/Duplicate/);
  for (let i = 0; i < 4; i++)
    current.configuration = addCustomField(current.configuration, "customers", {
      key: "extra_" + i,
      label: "My field " + i,
      type: "text",
      required: false,
    });
  expect(() =>
    proposeTemplateUpdate(reviewTemplateUpdate(current, target, base, 1), [
      "field:customers:extra_arrival",
    ]),
  ).toThrow(/four optional-field/);
});
it("requires explicit version approval and refuses new identities, populated field rewrites, stale editors and stale workspace revisions", async () => {
  const h = await reviewedTemplateHistory(),
    base = h.find(
      (s) =>
        s.entry.metadata.id === "property-maintenance" &&
        s.entry.metadata.revision === 1,
    )!,
    target = latestTemplate(h, "property-maintenance")!,
    current = base.entry.plan;
  const review = reviewTemplateUpdate(current, target, base, 1),
    ctx = {
      current,
      config: current.configuration,
      populated: [],
      revision: 1,
      allowVersionChange: false,
    };
  expect(() => useTemplateChanges(review, ["branding"], ctx)).toThrow(
    /version change/,
  );
  expect(
    useTemplateChanges(review, ["branding"], {
      ...ctx,
      allowVersionChange: true,
    }).version,
  ).toBe(2);
  expect(() =>
    useTemplateChanges(review, ["branding"], {
      ...ctx,
      revision: 2,
      allowVersionChange: true,
    }),
  ).toThrow(/revision changed/);
  const edited = structuredClone(current);
  edited.configuration.name = "Changed during review";
  expect(() =>
    useTemplateChanges(review, ["branding"], {
      ...ctx,
      current: edited,
      allowVersionChange: true,
    }),
  ).toThrow(/editor or workspace/);
  expect(() =>
    proposeTemplateUpdate(
      reviewTemplateUpdate(h[0].entry.plan, target, undefined, 1),
      ["branding"],
    ),
  ).toThrow(/industry\/project/);
  const clean = h[0],
    latest = latestTemplate(h, "basic-cleaning")!,
    fieldReview = reviewTemplateUpdate(clean.entry.plan, latest, clean, 1);
  expect(() =>
    useTemplateChanges(fieldReview, ["field:customers:extra_arrival"], {
      current: clean.entry.plan,
      config: clean.entry.plan.configuration,
      populated: ["customers"],
      revision: 1,
      allowVersionChange: false,
    }),
  ).toThrow(/migration review/);
});
