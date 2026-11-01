# Services and estimates verification

PR #12 adds a bounded fictional USD catalog and internal estimate drafts through the shared engine. No production financial operation, public business route, invoice, payment, message or recovery activation is enabled.

Local type checking, 74 unit/embedded-PostgreSQL tests, 188 license declarations and production build have passed. Final native PostgreSQL and browser results will be recorded from actual completed CI/local logs before review readiness. Required native suites never silently skip.

New coverage includes exact rounding/quantity/discount/tax/overflow cases, both industry workflows, scoped relationships, owner/admin permissions, current and retained price revisions, catalog/estimate concurrency, original-selection retries, stale edits, immutable history, safe migration and native restart/backup/restore with activation blocked. All previous security, recovery, credential-lineage, publication, scheduling and workforce suites remain enabled.

Limitations: USD/two-decimal cents; 1–10 lines; bounded positive quantities/totals; explicit areas; no jurisdictional tax automation or external financial action. Browser emulation/automated accessibility does not certify every physical device, printer or assistive technology. See the [full contract](services-estimates.md).
