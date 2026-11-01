# LMS — Living Management System

**One engine. Any business. Your data. Your control.**

An MIT-licensed, independent open-source foundation for small-business management software. Inspired by [ForgeOS](https://github.com/larrinamsalva/ForgeOS-Property-Manager); ForgeOS is unchanged. No mandatory cloud account, subscription, payment processor or AI service.

## What works in this foundation

- One TypeScript engine and one responsive React workspace render **Property Manager** (customers, sites/units, maintenance tasks, supply catalog) and **Cleaning Company** (customers, cleaning jobs, service dates, crew notes, tasks, supply catalog).
- Shared customer/work links, exclusive-resource scheduling, retained booking zones and a responsive daily agenda for both businesses.
- Fictional employee profiles, effective-dated Worker/Crew membership, finite working hours/time off, and cross-crew employee conflict protection.
- Services, dated area rates and fictional estimate drafts with exact USD cents, preserved pricing snapshots, revisions and printable preview.
- Shared product/location inventory, exact case conversion and an immutable receiving/usage/transfer/return/adjustment ledger with keyboard-scanner selection.
- BuildPlan Studio: guided templates/features, safe optional fields, real Engine previews, temporary draft history and validated BuildPlan import/export.
- Curated BuildPlan Gallery: five searchable business starters, feature/type filters, real previews and unsaved remixes through Studio.
- Blueprint packages: download validated configuration with a feature/setup summary, then import through explicit compatibility and Gallery comparison without overwriting saved choices.
- Business Branding Studio: built-in marks/monograms, tagline, four reviewed light/dark palettes and real branded workspace previews, with versioned draft/package persistence and rollback.
- Local template history: retained reviewed editions, verified saved comparison baselines and selective update review that keeps customizations until explicitly replaced.
- Migration planning: scoped active/archived/disabled record metadata, stale-review detection, readable data-only impact reports and isolated previews; populated schema changes stay blocked.
- Configuration-generated forms with strict validation; create, edit, search, archive and restore operational records.
- Reviewed, versioned module manifests with dependency checks; disable modules while retaining data.
- Versioned business configuration: edit name/terminology/navigation, publish with conflict checks and roll back by appending a revision.
- Actual embedded PostgreSQL row-level security, organization memberships and owner/admin/staff/viewer roles. Tests attack the database directly, independent of the UI.
- Append-only database audit history; project JSON and organization-scoped workspace exports.
- Accessible light/dark themes, phone layout and no-login **fictional-data-only** demo.

This is a working foundation, **not production business software**. Advanced recurring scheduling, real-user staff administration, advanced pricing/currencies, fractional stock/purchasing, invoices, documents, complete production recovery/import, workflow automation, advanced builder extensions and executable application export/deployment are [later stages](ROADMAP.md). No live financial, messaging, payment or AI action is implemented.

## Run locally

Requires Node.js **22 or newer** (verified on Node 24), npm and about 1 GB of free memory. Install requires network access; the demo uses no external service after dependencies are installed. Commands run from the repository root:

```sh
git clone https://github.com/larrinamsalva/LMS.git
cd LMS
npm ci
npm run dev
```

Open **http://127.0.0.1:3000**, then choose **Explore the working demo**. Switch between the two businesses using **Business workspace**. Add a made-up customer, refresh, then explore **Project & modules** to disable the supply catalog, apply, and restore a revision. The same engine handles both workspaces.

The public demo needs no environment file, database account or Docker. The default embedded PostgreSQL database is in memory, **resets on server restart**, and is not a backup. Each browser receives separate fictional organizations; sessions expire after two hours. The process caps active sessions at 24, records at 250 per workspace, and config revisions at 40. Export anything you want to keep before expiry/restart. Do not enter real personal or business information.

For a production-mode **local demo**:

```sh
npm run build
npm start
```

Both commands bind to loopback by default. Publishing this single-process demo needs separate operational review, HTTPS, an exact `LMS_APP_ORIGIN` matching the public origin, resource/rate limits and a persistent shared session design. Nothing here deploys automatically or connects a production database. Real-business hosting remains gated on verified identity/session security, complete recovery acceptance and access-control review. The experimental PostgreSQL adapter is available only to trusted host code and maintenance commands.

## BuildPlan Studio

Choose **Build My Business System** without signing in, or open **BuildPlan Studio** from a fictional workspace. Start with Property Management, Cleaning Business or Custom Business; select reviewed features and dependencies, customize terminology/navigation and supported optional fields, then open the actual generated workspace in a separate preview tab. Save/reopen temporary drafts and export a validated BuildPlan or engine configuration. Publication is a separate, explicit review through the existing Engine; populated schema changes remain blocked.

[Step-by-step demonstration and screenshots](docs/buildplan-studio.md) · [Verification](docs/buildplan-studio-verification.md). A curated starter gallery is available through **Browse Business Templates**. Community submissions, marketplace, AI generation, hosting and automatic deployment remain deferred. Export before the temporary demo expires or restarts.

## Browse Business Templates

In **BuildPlan Studio**, choose **Browse Business Templates**. Search five reviewed configurations: Basic Cleaning Business, Cleaning Crew & Scheduling, RV Park / Property Management, Property Maintenance and General Service Business. Cards show enabled modules, supported starting workflows, dependencies and limitations. These are starter configurations, not complete industry applications.

**Preview Template** opens the same real Engine-powered fictional workspace mechanism as Studio. **Customize This Template** copies choices into an unsaved Studio plan; it never overwrites a saved plan or publishes automatically. Existing draft revisions, JSON export/import, impact review and publication protections apply. [Workflow and scope](docs/buildplan-gallery.md) · [Verification](docs/buildplan-gallery-verification.md).

## Download and reuse a blueprint

In Studio, enter a fictional **Blueprint name** and **Blueprint description**, then choose **Download Blueprint Package**. The ZIP includes a validated BuildPlan, enabled modules/dependencies, version metadata, hashes and human-readable instructions. **Import Blueprint Package** opens a read-only **Review Blueprint** screen; accepting it creates unsaved Studio choices. Saved drafts, business records and published configuration stay intact until separately authorized operations.

Only the strict 96 KiB LMS stored-ZIP format is accepted. Checksums detect damage, not a trusted author. Gallery revision hints are unverified and upgrades are never automatic. Existing BuildPlan v1 JSON import/export remains compatible. [Example workflow, package format and limits](docs/blueprint-packages.md) · [Verification](docs/blueprint-packages-verification.md).

## Brand Your Business

Open **BuildPlan Studio → Customize → Brand Your Business**. Set a fictional business name/tagline, enable branding, choose a built-in mark or initials and a coordinated primary/secondary/accent palette. Light/dark samples update immediately; **Prepare workspace preview** uses the actual Engine. Saving and publishing remain separate explicit operations.

Branding persists in configuration schema 2, BuildPlan 2 and Blueprint Package 2. Existing v1 files remain supported without automatic upgrade. Existing host-only databases need migration 12; their operational records are not rewritten. Image uploads, arbitrary CSS/colors, external fonts and logo URLs are deferred. [Workflow, compatibility, palette and migration contract](docs/business-branding.md) · [Verification](docs/business-branding-verification.md).

## Review template updates

Before updating an existing BuildPlan, use **Check for Template Updates** in Studio. Compare retained and newer reviewed editions, keep your own choices, preview selected replacements, then use them as unsaved choices. Exact saved baselines enable three-way review; imported hints alone remain informational. Format changes need explicit approval and populated schema changes remain blocked. [Workflow, trust limits and screenshots](docs/template-history.md) · [Verification](docs/template-history-verification.md).

## Plan business changes

In Studio, customize your proposed configuration and choose **Review Data Impact**. Inspect affected record counts, fields, module visibility, relationships, branding and history protections. Preview in an empty fictional Engine workspace or export a planning report after a freshness recheck. Compatible choices still need the existing explicit save/publication controls. Populated schema changes remain blocked; no migration executor or automatic record transformation is included. [Workflow, freshness/privacy contract and limits](docs/migration-planning.md) · [Verification and screenshots](docs/migration-planning-verification.md).

## Customer-linked scheduling

Choose **Schedule** in either fictional workspace. Cleaning uses Customer → Cleaning job → Appointment → Crew/resource; property uses Customer/Site → Maintenance request → Appointment → Worker/resource. The same forms and engine handle both. Overlapping exclusive resources are rejected by PostgreSQL; UTC instants, DST choices, retries and archive history have documented rules. Follow [the workflow/upgrade guide](docs/shared-scheduling.md) and [verification evidence](docs/shared-scheduling-verification.md). Recurrence, live calendars and notifications remain deferred.

## Employees, crews and availability

Open **Crews & availability** to add fictional profiles, dated memberships and work/time-off periods. Owners/admins manage these records; staff can schedule eligible rosters. PostgreSQL prevents a person being booked through different crews or Worker resources at once. Directory and schedule show employee allocation history on desktop, tablet and phone. Employee profiles never create login accounts or grant permissions.

Existing unenrolled PR #10 resources remain explicitly resource-only. Enrolled resources require a stable, fully available roster; cancel/archive affected bookings before changing it. The single-resource appointment model remains. See [setup/workflows and limits](docs/crews-availability.md), [manifest](examples/workforce.module.json) and [verified tests](docs/crews-availability-verification.md). Weekly recurrence, payroll and timesheets remain deferred.

## Services, rates and estimate drafts

Open **Services & Rates** to maintain fictional services/extras and date-effective prices for named areas. Open **Estimates** to select a customer and linked work, load saved prices, enter quantities/discount/manual tax and review a printable internal draft. Owners/admins write; other members read. Exact cents and saved service/rate snapshots prevent floating-point totals and silent repricing. Nothing is sent or charged.

This phase is USD only, with 1–10 lines and explicit tax/rounding/status rules. See [workflow and security contract](docs/services-estimates.md), [manifest](examples/estimates.module.json) and [actual verification](docs/services-estimates-verification.md). The separate native adapter provides durable pricing; the public no-login demo remains temporary.

## Inventory and stock

Open **Inventory & stock** in either fictional business to manage products and storage locations, review quantities/low-stock warnings, scan/type a product code, and explicitly post whole-unit movements. Case conversion and original packaging are saved; owner/admin corrections add compensating history. No purchase or automatic order runs. See [workflow, setup and exact quantity contract](docs/inventory-stock.md), [manifest](examples/modules/inventory.manifest.json) and [verification](docs/inventory-stock-verification.md).

## Experimental durable PostgreSQL

A separate host-only PostgreSQL adapter now implements the existing engine interface. It adds a bounded pool, checked runtime roles, transactional checksum migrations, Docker Compose storage and native backup/restore commands. **The no-login website still uses its own temporary database.** No persistent business HTTP endpoints are exposed.

Follow [the local PostgreSQL setup and recovery rehearsal](docs/postgres-setup.md). Setting up this optional backend does not enable authenticated HTTP business routes or authorize real business use. See [migration rules](db/README.md) and [network verification results](docs/postgres-verification.md).

## Experimental local authentication

The separate [local identity adapter](docs/local-auth.md) adds Better Auth password sign-in and revocable PostgreSQL sessions for provisioned fictional accounts. It is **host-only and unmounted**: the demo still opens without login, and persistent business routes remain closed. It includes separate runtime credentials, private identity tables, database throttling and recovery that does not revive old sessions. See [verification and remaining gates](docs/local-auth-verification.md).

## Experimental owner access

The [owner access host API](docs/owner-access.md) adds session-bound reviewed role changes, removal and atomic ownership handover, with durable audits and confirmation receipts. A guarded local command can create a new fictional workspace for a provisioned owner. It remains **host-only**: no staff UI, real-user invitations or business routes are exposed. See [verification and recovery limits](docs/owner-access-verification.md).

## Experimental account lifecycle

The [host-only password-change API](docs/account-lifecycle.md) verifies the current password, requires a sign-in within five minutes, revokes all account sessions/approvals and records a secret-free credential event atomically. Owner access commands use the same recent-authentication rule. The [offline recovery contract](docs/offline-recovery.md) adds prior trust, two independently signed approvals and atomic credential replacement. It keeps recovered/restored databases blocked from normal runtime attachment; no public reset/deletion route or activation override is enabled. See [verification and limits](docs/account-lifecycle-verification.md).

## Controlled offline recovery

Follow [the offline recovery procedure](docs/offline-recovery.md) for provisioned fictional accounts only. Insufficient prior evidence or a separate approver means refusal. Native restores now install an activation blocker, including older archives; data can be inspected offline, but normal authentication/persistent startup remains disabled until rollback-resistant recovery is separately accepted. See [verification and limitations](docs/offline-recovery-verification.md).

## Independent credential lineage foundation

The [host-only credential lineage tools](docs/credential-lineage.md) add transaction-bound metadata and independently signed external checkpoints with a separately held latest digest and credential-state commitment key. Read-only assessment detects supported snapshot rollback and evidence/state mismatches. **Activation remains blocked**, including after a successful assessment; identity-specific recovery acceptance, durable independent freshness and key/role recovery are next phases. No public route or automatic signer is added. See [verified scope and limitations](docs/credential-lineage-verification.md).

## Controlled checkpoint publication

The [custodian-only checkpoint publisher](docs/checkpoint-publication.md) validates the existing checkpoint signatures, requires separate independent publication approvals and durably records immutable receipts on a protected Linux filesystem. Pending or conflicting history refuses verification; an independently retained root and latest receipt are required. This is a bounded local phase, with no mandatory hosting service and **no restored-database activation**. It does not provide a monotonic external witness or repair expired/corrupt intents. See [verification and limits](docs/checkpoint-publication-verification.md).

## Verify

```sh
npm run check
npx playwright install --with-deps chromium
npm run test:e2e
```

The checkpoint publication CLI and its filesystem tests require Linux with util-linux `flock`; the web demo does not require that utility. Browser tests use a **production build**, started automatically on loopback ports 3100–3102, with desktop, tablet and phone Chromium projects. `npm run check` includes type checking, unit and real-SQL integration/security tests, dependency inventory verification and the production build. `npm audit` is a separate current-registry check. If browser downloads are restricted, `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/to/chromium` selects an installed Chromium; report its version when using this override. Never call unrun checks passing.

## Architecture and extension points

| Path | Purpose |
| --- | --- |
| `src/core/config.ts` | Versioned config/field schemas and record validation |
| `src/core/engine.ts` | Framework-independent engine API and SQL adapter interfaces |
| `src/modules/registry.ts` | Explicit reviewed manifest registry (API v1) |
| `src/presets/index.ts` | Property and cleaning configuration plus fictional fixtures |
| `src/components/` | Shared generated forms, workspace and minimal config editor |
| `src/server/` | Temporary demo adapter/sessions and separate host-only PostgreSQL adapter |
| `src/app/api/demo/route.ts` | Bounded same-origin demo transport; no real-business routes |
| `db/001_foundation.sql` | RLS, memberships, immutable record scope and audit triggers |
| `examples/` | Reusable validated configuration and manifest examples |

To add operational records, use the `custom-records` manifest and a `custom-` entity ID, define fields, enable the module and add the entity to navigation. Existing populated field schemas require a reviewed migration; renaming a field must not silently orphan data. New executable modules require code review, explicit capability contracts and tests. No arbitrary plugins or configuration-supplied scripts are executed.

Read the [architecture](docs/architecture.md), [API contracts](docs/api.md), [file-level extraction assessment](docs/extraction-assessment.md), [dependency/license audit](docs/dependency-audit.md), [verification evidence](docs/verification.md), [staged plan](docs/implementation-plan.md), [security policy](SECURITY.md) and [contribution guide](CONTRIBUTING.md).

## License and attribution

LMS is [MIT licensed](LICENSE), copyright 2026 Larrina Salva. The bounded request-body reader is adapted from ForgeOS at commit `5831e20023c8f2f1e7269bbfb63b6ba0f21ee3b8`; its [original MIT notice](third-party/ForgeOS-LICENSE.txt) is retained. All other foundation implementation is new. Dependencies keep their own licenses, including Apache-2.0, MPL and LGPL components; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The project license does not replace their obligations.
