# Staged implementation plan

Each numbered stage is a separate reviewable PR or series of small PRs. Never auto-merge.

1. **Foundation (this PR):** pinned TypeScript/React/Next.js dependencies, MIT attribution, validated manifests/configuration, SQL-backed operational records, organization RLS/roles, append-only audits, configuration rollback, fictional demo with two distinct presets, setup/docs, unit/integration/security/responsive tests and CI.
2. **Self-host identity and persistence:** verified local/password or optional Supabase adapter, trusted membership administration, persistent PostgreSQL adapter, migrations, revocation/session tests, disaster recovery/restore, deployment runbook and actual PostgreSQL concurrency tests. Gate: no real data before security and restore acceptance.
3. **Operational modules:** customers, service rates, scheduling/crews, job evidence and maintenance, inventory movements; typed relationships and conflict/idempotency tests. Gate: two actual business workflows using shared engine, not duplicated apps.
4. **Finance and documents:** estimate snapshots, invoice drafts, exact money math, permission + explicit confirmation, immutable corrections, private uploads and scoped exports. Gate: no live issuance/payment/messaging without explicit owner authorization and environment acceptance.
5. **Builder:** guided business questionnaire → validated configuration; module and terminology/field/nav controls, safe branding upload, preview and reusable project files. Gate: validation and migration preview before applying to a populated workspace.
6. **Export/deployment:** reproducible application export, packaging and opt-in deployment adapters, backup/restore rehearsals. Verify URL, build and complete user flow before saying deployed.
7. **Optional integrations:** deterministic workflow rules, messaging/payment adapters and transparent optional AI with permission checks and explicit reviewed action confirmations. Default disabled; all workflows usable manually.

Phase 1 acceptance: fresh clone can install and start without credentials; two presets use identical forms/service/SQL; a created record survives refresh within its demo session; cross-organization raw SQL reads/writes and viewer writes fail; stale updates conflict; audit cannot be rewritten; invalid configs fail; disabling a module retains its data; rollback appends history; phone and desktop forms work in both themes. Limits and any unrun verification are recorded, not claimed as completed.
