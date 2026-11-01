import { z } from "zod";
import {
  impactReviewInput,
  migrationReport,
  type MigrationReview,
} from "./migration-review";
import { moduleRequirements, validateBuildPlan } from "./buildplan";
export const rehearsalInput = impactReviewInput
  .required({ expected: true })
  .extend({ operationId: z.uuid() })
  .strict();
export type RehearsalInput = z.infer<typeof rehearsalInput>;
export const rehearsalChecks = {
  configuration: {
    label: "Configuration, modules and appearance",
    detail:
      "The independent Engine workspace uses the exact validated proposal, including supported labels, navigation and branding.",
  },
  fields: {
    label: "Fictional records and optional fields",
    detail:
      "Generated values exercise supported optional fields on enabled customer, work, site and notes entities. Disabled entities are not populated or silently enabled.",
  },
  relationships: {
    label: "Customer and work relationships",
    detail:
      "Generated work links to its generated customer. Unavailable references and archiving a referenced customer are rejected without changing records or audit history.",
  },
  scheduling: {
    label: "Scheduling conflicts and retries",
    detail:
      "An exclusive resource accepts one appointment, exact retries do not duplicate it, and an overlapping booking is rejected. This is resource-only; employee availability and advanced schedules are not exercised by this scenario.",
  },
  inventory: {
    label: "Stock quantities and immutable movements",
    detail:
      "Two fictional cases of twelve produce 24 units, one unit of usage leaves 23, duplicate receiving is applied once, and overdraw and movement edits are rejected.",
  },
  estimates: {
    label: "Estimate pricing snapshots and retries",
    detail:
      "A fictional USD draft retains its original exact 1000-cent price after a catalog change. An identical retry is applied once and a new request using the stale rate is rejected. No invoice is issued.",
  },
} as const;
export type RehearsalCheckId = keyof typeof rehearsalChecks;
export const outcomeSchema = z
  .object({
    id: z.enum([
      "configuration",
      "fields",
      "relationships",
      "scheduling",
      "inventory",
      "estimates",
    ]),
    status: z.enum(["passed", "failed", "not-applicable", "not-run"]),
  })
  .strict();
export type RehearsalOutcome = z.infer<typeof outcomeSchema>;
export const rehearsalResultSchema = z
  .object({
    version: z.literal(1),
    status: z.enum(["completed", "failed"]),
    outcomes: z.array(outcomeSchema).length(6),
    workspace: z.object({ organizationId: z.uuid() }).strict().optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (
      new Set(r.outcomes.map((c) => c.id)).size !== 6 ||
      (r.status === "completed" &&
        r.outcomes.some((c) => ["failed", "not-run"].includes(c.status))) ||
      (r.status === "failed" &&
        !r.outcomes.some((c) => c.status === "failed")) ||
      (r.status === "failed" && r.workspace)
    )
      ctx.addIssue({ code: "custom", message: "Invalid rehearsal outcomes." });
  });
export type RehearsalResult = z.infer<typeof rehearsalResultSchema>;
export const readiness = (
  review: MigrationReview,
  result?: RehearsalResult,
) => [
  {
    item: "Validated configuration",
    status: "Validated",
    detail:
      "Existing v1/v2 readers, reviewed module versions and dependency rules accepted the proposal.",
  },
  {
    item: "Fictional rehearsal",
    status: result
      ? result.status === "completed"
        ? "Completed on generated fixtures"
        : "Failed · no migration performed"
      : "Not run",
    detail:
      "A completed scenario is evidence about generated fictional fixtures only. Not-applicable checks cover disabled modules; manual edits afterward invalidate the saved rehearsal observation.",
  },
  {
    item: "Existing data compatibility",
    status:
      review.overall === "compatible"
        ? "Compatible under current rules"
        : review.overall === "migration-review"
          ? "Blocked · populated schema migration required"
          : "Blocked · unsupported identity",
    detail:
      "The existing impact and publication guards remain authoritative. A fictional pass cannot override a populated-entity blocker.",
  },
  {
    item: "Business backup and restore evidence",
    status: "Not verified for this business",
    detail:
      "Repository native PostgreSQL tests exercise backup/restore tooling on separate fictional databases. This session has not backed up, restored or transformed this business.",
  },
  {
    item: "Migration authorization",
    status: "Not granted",
    detail:
      "Planning, rehearsal and downloaded reports grant no approval. A future executor needs separately verified permissions, explicit approval and transaction-time freshness checks.",
  },
  {
    item: "Production security acceptance",
    status: "Blocked",
    detail:
      "Production identity, deployment and recovery acceptance remain separate. No public persistent-business endpoint or restored-database activation is enabled.",
  },
];
export function buildRehearsalPlan(review: MigrationReview) {
  const proposed = validateBuildPlan(review.proposed),
    impact = migrationReport(review);
  return {
    format: "lms-fictional-rehearsal-plan",
    version: 1,
    configurationRevision: review.configurationRevision,
    configurations: impact.configurations,
    changes: impact.changes,
    modules: proposed.configuration.modules.map((m) => ({
      ...m,
      dependencies: moduleRequirements(proposed.configuration, m.id),
    })),
    entityDefinitions: proposed.configuration.entities,
    relationships: proposed.configuration.entities.flatMap((e) =>
      e.fields
        .filter((f) => f.type === "reference")
        .map((f) => ({
          entity: e.id,
          field: f.key,
          target: f.target,
          required: f.required,
        })),
    ),
    scenarios: Object.entries(rehearsalChecks).map(([id, check]) => ({
      id,
      ...check,
    })),
    protections: impact.warnings,
    backupRestoreRequirements: [
      "Stop relevant hosts, identify the exact fictional source and migration/checksum versions, and create a private native archive using reviewed host-only tooling.",
      "Restore only into a separate empty fictional database; verify retained configuration/draft/audit history, record relationships, exact pricing/stock history, grants and constraints.",
      "Verify transient identity sessions, approvals and recovery cases are purged and restored activation remains blocked. Never use a force-unblock or overwrite a workspace.",
      "Repository CI proves bounded tooling regression cases, not this business's backup, a proposed schema transformation, independent freshness or production recovery acceptance.",
    ],
    postChangeChecks: [
      "Revalidate configuration/module versions and all scoped references.",
      "Verify retained record counts/history and pricing, inventory, scheduling and workforce invariants on an authorized isolated copy.",
      "Test invalid and concurrent operations, exact retries, permission revocation and failure rollback.",
      "Obtain a separate reviewed execution design and explicit authorization; this application contains no migration executor.",
    ],
    blockers: [
      ...(review.overall !== "compatible"
        ? ["Existing data-impact blocker remains: " + review.overall]
        : []),
      "Business-specific backup/restore evidence, migration authorization and production security acceptance are not supplied.",
    ],
  };
}
/** Whitelist only reviewed configuration and static scenario descriptions/statuses; no rows, IDs, errors or commands. */
export function rehearsalReport(
  review: MigrationReview,
  input: RehearsalResult,
) {
  const result = rehearsalResultSchema.parse(input);
  return {
    format: "lms-fictional-rehearsal-report",
    version: 1,
    plan: buildRehearsalPlan(review),
    status: result.status,
    outcomes: result.outcomes.map((c) => ({
      ...c,
      label: rehearsalChecks[c.id].label,
      expectedCheck: rehearsalChecks[c.id].detail,
      followUp:
        c.status === "passed"
          ? "Evidence applies only to the generated fictional fixtures; business migration checks remain separate."
          : c.status === "not-applicable"
            ? "Not exercised because this module is disabled. Nothing was silently enabled."
            : "Not verified. Retain the current business configuration, review the proposal and test a new independent fictional case explicitly.",
    })),
    readiness: readiness(review, result),
    notice:
      "Non-executable fictional fixture evidence only. No operational records, credentials, workspace IDs or freshness fingerprints are included. Configuration labels may contain user-entered private text; inspect before sharing. This is neither a backup nor migration approval.",
  };
}
