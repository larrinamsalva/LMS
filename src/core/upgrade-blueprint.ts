import { buildRehearsalPlan } from "./rehearsal";
import type { MigrationReview } from "./migration-review";
/** Descriptive reviewed vocabulary, never an executable operation input. */
export const upgradeVocabulary = [
  "optional-field-addition",
  "field-definition-review",
  "module-visibility",
  "terminology",
  "navigation",
  "branding",
  "business-identity",
  "configuration-version",
  "time-zone",
  "entity-contract",
] as const;
export function upgradeBlueprint(review: MigrationReview) {
  const plan = buildRehearsalPlan(review);
  const operations = review.changes.map((change) => {
    let kind: (typeof upgradeVocabulary)[number] = "entity-contract";
    if (change.change.startsWith("Module:")) kind = "module-visibility";
    else if (
      change.change.startsWith("Terminology:") ||
      change.change === "Business display name"
    )
      kind = "terminology";
    else if (change.change === "Branding") kind = "branding";
    else if (change.change === "Navigation order") kind = "navigation";
    else if (change.change === "Business time zone") kind = "time-zone";
    else if (change.change === "Configuration / artifact version")
      kind = "configuration-version";
    else if (change.change === "Project / industry identity")
      kind = "business-identity";
    else if (change.change.startsWith("Field:")) {
      const before = review.current.entities.find(
        (e) => e.id === change.entity,
      );
      const after = review.proposed.configuration.entities.find(
        (e) => e.id === change.entity,
      );
      kind = after?.fields.some(
        (f) =>
          !f.required &&
          !before?.fields.some((a) => a.key === f.key) &&
          change.change === "Field: " + f.label,
      )
        ? "optional-field-addition"
        : "field-definition-review";
    }
    return {
      kind,
      ...change,
      path:
        change.category === "compatible"
          ? "Existing explicit configuration publication, with fresh checks"
          : change.category === "migration-review"
            ? "Future separately authorized transformation required"
            : "Blocked or unsupported",
      executable: false,
    };
  });
  return {
    format: "lms-native-upgrade-blueprint",
    version: 1,
    configurationRevision: review.configurationRevision,
    configurations: plan.configurations,
    modules: plan.modules,
    entityDefinitions: plan.entityDefinitions,
    relationships: plan.relationships,
    operations,
    overall: review.overall,
    protections: plan.protections,
    backupRestoreRequirements: plan.backupRestoreRequirements,
    verificationCheckpoints: plan.postChangeChecks,
    blockers: plan.blockers,
    rollbackReadiness: {
      configuration:
        "Existing rollback appends a configuration revision; it never reverses operational data or restores a database.",
      nativeCopy:
        "PR #21 can verify a same-schema fictional copy. Its temporary archive is removed; no retained rollback backup is supplied.",
      transformation:
        "Not verified: no transformation, inverse transform, execution approval, retained off-device backup or post-migration rollback is implemented.",
      activation:
        "Every restored copy stays quarantined. External credential, identity and production acceptance remain required.",
    },
    notice:
      "Private design report only. No publication, transformation, SQL or activation. Configuration labels are user-entered text: inspect before sharing. Operational rows and credentials are excluded.",
  };
}
