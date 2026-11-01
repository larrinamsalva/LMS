import { z } from "zod";
import { validateBuildPlan, type BuildPlan } from "./buildplan";
import {
  configurationImpact,
  validateConfig,
  type BusinessConfig,
  type FieldDefinition,
} from "./config";
import { blueprintJson } from "./blueprint";
import { templateValue } from "./template-update";
export const impactReviewInput = z
  .object({
    document: z.unknown(),
    draft: z
      .object({ id: z.uuid(), revision: z.number().int().min(1).max(20) })
      .strict()
      .optional(),
    expected: z
      .object({
        stateDigest: z.string().regex(/^[a-f0-9]{64}$/),
        proposalDigest: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ImpactReviewInput = z.infer<typeof impactReviewInput>;
export type ImpactCategory = "compatible" | "migration-review" | "blocked";
export const impactLabels: Record<ImpactCategory, string> = {
  compatible: "Compatible under existing rules",
  "migration-review": "Requires additional migration review",
  blocked: "Blocked or unsupported",
};
export interface EntityPopulation {
  entity: string;
  active: number;
  archived: number;
}
export interface ImpactChange {
  entity: string;
  change: string;
  before: string;
  after: string;
  category: ImpactCategory;
  reason: string;
  nextStep: string;
}
export interface MigrationReview {
  format: "lms-migration-review";
  version: 1;
  configurationRevision: number;
  current: BusinessConfig;
  proposed: BuildPlan;
  entities: (EntityPopulation & {
    label: string;
    enabled: boolean;
    proposedEnabled: boolean;
  })[];
  changes: ImpactChange[];
  overall: ImpactCategory;
  warnings: string[];
  state: { stateDigest: string; proposalDigest: string };
  draft?: { id: string; revision: number };
}
const same = (a: unknown, b: unknown) =>
  blueprintJson(a ?? null) === blueprintJson(b ?? null);
function describe(v: unknown): string {
  if (v === undefined) return "Not configured";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(describe).join(" → ");
  if (v && typeof v === "object") {
    if ("key" in v && "type" in v) return templateValue(v as FieldDefinition);
    if ("palette" in v) return templateValue(v as BusinessConfig["branding"]);
    if ("id" in v && "version" in v) return `${v.id} @ ${v.version}`;
  }
  return blueprintJson(v).trim();
}
/** Explains the existing validator/impact result; it grants no migration or publication authority. */
export function explainMigrationImpact(
  currentInput: BusinessConfig,
  input: BuildPlan,
  populations: EntityPopulation[],
) {
  const current = validateConfig(currentInput),
    proposed = validateBuildPlan(input),
    next = proposed.configuration;
  const impact = configurationImpact(
    current,
    next,
    populations.filter((p) => p.active + p.archived > 0).map((p) => p.entity),
  );
  const changes: ImpactChange[] = [];
  const add = (
    entity: string,
    change: string,
    before: unknown,
    after: unknown,
    category: ImpactCategory,
    reason: string,
    nextStep: string,
  ) => {
    if (!same(before, after))
      changes.push({
        entity,
        change,
        before: describe(before),
        after: describe(after),
        category,
        reason,
        nextStep,
      });
  };
  const compatible =
    "Save the reviewed draft, then use the existing explicit publication controls. The Engine and database check again at publication.";
  add(
    "Business",
    "Project / industry identity",
    [current.id, current.industry],
    [next.id, next.industry],
    "blocked",
    "Existing project and industry identity is immutable. A starter cannot replace a different business.",
    "Keep this workspace's identity. Use a separate fictional preview to inspect a different starter.",
  );
  for (const key of [
    "name",
    "timeZone",
    "branding",
    "navigation",
    "schemaVersion",
  ] as const)
    add(
      "Business",
      {
        name: "Business display name",
        timeZone: "Business time zone",
        branding: "Branding",
        navigation: "Navigation order",
        schemaVersion: "Configuration / artifact version",
      }[key],
      current[key],
      next[key],
      "compatible",
      key === "timeZone"
        ? "Existing appointment instants, saved booking zones and dates are retained; future defaults/display may change."
        : key === "schemaVersion"
          ? "The strict paired v1/v2 readers accept this configuration. Host storage still requires its existing installed migrations."
          : "This changes configuration presentation, not operational records or their retained history.",
      compatible,
    );
  for (const id of new Set(
    [...current.modules, ...next.modules].map((m) => m.id),
  )) {
    const a = current.modules.find((m) => m.id === id),
      b = next.modules.find((m) => m.id === id);
    add(
      "Business",
      "Module: " + id,
      a,
      b,
      "compatible",
      b
        ? "Only supported versions and complete dependencies pass validation. Enabling a module does not create or transform operational records."
        : "Disabling hides this module. Active and archived records, incoming references, pricing snapshots, stock movements and scheduling history are retained; this does not cancel bookings or remove obligations.",
      compatible,
    );
  }
  const entities = [
    ...new Set([...current.entities, ...next.entities].map((e) => e.id)),
  ].map((id) => {
    const a = current.entities.find((e) => e.id === id),
      b = next.entities.find((e) => e.id === id);
    const category: ImpactCategory = impact.migrationEntities.includes(id)
      ? "migration-review"
      : "compatible";
    const reason =
      category === "migration-review"
        ? "Existing publication rules block this schema change because this entity contains records, including archived or disabled records. Additive optional fields are not exempt."
        : "Existing validation and publication rules accept this proposal against the observed empty entity. No backfill or data transformation is performed. Another record arriving makes this review stale.";
    const step =
      category === "migration-review"
        ? "Keep the current field schema or revise this proposal. A separately authorized migration design, backup/restore rehearsal and tested executor are required; this PR cannot apply it."
        : compatible;
    add(
      id,
      "Entity contract",
      a && [a.module, a.titleField],
      b && [b.module, b.titleField],
      category,
      reason,
      step,
    );
    for (const key of ["singular", "plural", "navigationLabel"] as const)
      add(
        id,
        "Terminology: " + key,
        a?.[key],
        b?.[key],
        "compatible",
        "Labels change; record IDs, stored values and relationships are retained.",
        compatible,
      );
    for (const key of new Set(
      [...(a?.fields ?? []), ...(b?.fields ?? [])].map((f) => f.key),
    ))
      add(
        id,
        "Field: " +
          (b?.fields.find((f) => f.key === key)?.label ??
            a?.fields.find((f) => f.key === key)?.label ??
            key),
        a?.fields.find((f) => f.key === key),
        b?.fields.find((f) => f.key === key),
        category,
        reason,
        step,
      );
    // Field order is part of the same authoritative populated-schema comparison.
    if (
      a &&
      b &&
      same(
        a.fields.map((f) => f.key).sort(),
        b.fields.map((f) => f.key).sort(),
      ) &&
      !same(
        a.fields.map((f) => f.key),
        b.fields.map((f) => f.key),
      )
    )
      add(
        id,
        "Field order",
        a.fields.map((f) => f.key),
        b.fields.map((f) => f.key),
        category,
        reason,
        step,
      );
    const population = populations.find((p) => p.entity === id) ?? {
      entity: id,
      active: 0,
      archived: 0,
    };
    return {
      ...population,
      label: a?.plural ?? b!.plural,
      enabled: !!a && current.modules.some((m) => m.id === a.module),
      proposedEnabled: !!b && next.modules.some((m) => m.id === b.module),
    };
  });
  const overall: ImpactCategory = impact.identityChanged
    ? "blocked"
    : impact.migrationEntities.length
      ? "migration-review"
      : "compatible";
  return {
    current,
    proposed,
    entities,
    changes,
    overall,
    warnings: [
      "Planning is read-only. This report is a point-in-time explanation, not approval, executable SQL or a publication token. Even additive optional fields remain blocked on populated entities.",
      "Core fields, data types, requiredness, reference targets, module versions and dependencies must pass existing strict BuildPlan/configuration validators. Unsupported proposals are refused before a report or preview is prepared.",
      "References remain organization-scoped and retain their record IDs. Existing archive/dependency guards still apply; hiding a module does not sever linked customer, job, site or appointment records.",
      "Configuration rollback appends a retained configuration revision. It does not reverse data. All draft/configuration/audit history, original estimate pricing/status revisions, immutable inventory movements, UTC appointments and employee assignment history are preserved.",
      "A fresh preview starts empty in a separate temporary fictional Engine workspace. It cannot prove that existing records can be migrated. No records are copied, rewritten, deleted or imported.",
      "No migration executor, force option, production access or recovery activation is available. Compatible changes still require a saved current draft, owner/admin permission and separate explicit publication.",
    ],
  };
}
/** Explicit whitelist: no counts, row IDs/values, actors, organization, state fingerprint or operational history. */
export function migrationReport(review: MigrationReview) {
  return {
    format: "lms-migration-impact-report",
    version: 1,
    engineApi: 1,
    configurationRevision: review.configurationRevision,
    configurations: {
      current: validateConfig(review.current),
      proposed: validateBuildPlan(review.proposed),
    },
    overall: review.overall,
    changes: review.changes,
    warnings: review.warnings,
    notice:
      "Planning artifact only; not importable authorization. Contains user-entered configuration labels: inspect before sharing. Counts, operational records and freshness fingerprints are omitted. Re-review the live fictional workspace before any subsequent action.",
  };
}
