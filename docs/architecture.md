# LMS architecture and decisions

One engine. Any business. Your data. Your control.

## First foundation

Next.js App Router + React + strict TypeScript retain practical ForgeOS compatibility. A framework-independent core validates versioned JSON business configurations and module manifests. The same record service, forms, SQL and audit history operate property and cleaning presets. Industry terminology, fields and enabled modules live in configuration. BuildPlan Studio now provides a bounded visual builder over that same configuration; the foundation remains experimental.

The smallest vertical slice is operational custom records: customers, property units or cleaning jobs, and tasks. Create, edit, archive, search, export, configuration revision/rollback and audit review work. Inventory now supplies scoped products/locations and an immutable whole-unit stock ledger. Billing, advanced pricing/tax models, advanced recurring scheduling, documents, reports and external actions remain staged modules. The UI labels their availability honestly.

## Boundaries

| Layer | Contract | Responsibility |
| --- | --- | --- |
| Configuration | `BusinessConfig`, schema version 1 | Validated project identity, module versions, terminology, navigation and field definitions |
| Registry | `ModuleManifest`, engine API 1 | Explicit versions, dependencies, provided entities, capabilities and availability |
| Domain | `validateConfig`, `validateRecord` | Reject unknown modules/fields, reserved keys, dependency gaps and unsafe values |
| Service | `Engine`, trusted `Principal` | Transactional authorized record commands, optimistic revisions and configuration history |
| Database | `SqlDatabase` adapter | Actual PostgreSQL RLS, membership authority, immutable scope, append-only audit |
| Demo transport | `/api/demo` | HttpOnly random session, isolated fictional organizations per session, same-origin bounded JSON |
| UI | Shared workspace + generated form | Mobile accessible operational flow; no industry-specific component forks |

## Runtime alternatives

| Option | Decision |
| --- | --- |
| PGlite embedded PostgreSQL | Default fictional demo; no account, Docker, API key or external service. Real PostgreSQL SQL/RLS, single process. Memory reset on server restart; bounded demo sessions |
| Network PostgreSQL | Experimental host-only node-postgres adapter, bounded pools, migrations and recovery rehearsal; no business HTTP routes. See PostgreSQL setup and verification |
| Supabase | Optional future verified identity/SQL adapter. Do not expose demo tables through Data API or reuse demo identity in hosted auth |
| SQLite | Not selected: it lacks native PostgreSQL RLS; separate files alone would change the isolation model |

## Authorization and data ownership

Trusted server code sets the user identity inside a transaction and switches to a non-owner, non-BYPASSRLS application role. Membership rows are the authority. Browser-provided organization IDs never grant membership. All business tables enable and force RLS; UPDATE has USING and WITH CHECK. Composite keys bind record/audit/config identity to one organization. Ordinary application roles cannot directly provision users, change memberships, alter policies or rewrite audit events. Audits are owner/admin only because snapshots may contain personal data.

The current web app exposes **only an ephemeral fictional demo**, never a real-business endpoint. A random opaque cookie maps to a server-created demo user and its original two organizations plus up to three generated preview sandboxes. Session expiry/restart resets access and the demo is bounded. There are no finance, messaging, AI, payment or production-auth routes. Such capabilities must require typed permissions plus a reviewed explicit confirmation transaction before they can be enabled. A client checkbox will not be an authorization boundary.

Database identities, membership provisioning and direct SQL access are trusted host responsibilities. Raw database access must never be exposed to end users; a database administrator can bypass RLS. The demo runtime remains single process and cannot be deployed horizontally as-is.

## Configuration evolution

Configurations have a schema version and append-only revision. Publishing requires the current revision and administrative membership. The service locks the organization before checking and appending. Rollback appends a new revision referencing an earlier valid snapshot; history is retained. Disabling a module preserves records, removes forms/navigation and denies service operations on its entities. Field definitions are immutable once records exist; schema migration tooling is deferred. Installation means activating a known, reviewed manifest; downloading/executing arbitrary plugin code is not supported.

## Future engine contracts

Shared scheduling now supplies explicit instants, retained booking zones and a native exclusion constraint; finite crew/employee availability now shares that epoch and adds employee exclusion constraints; recurrence remains later work. Inventory now has immutable runtime movements; administrator-resistant operational signing is not provided. Estimate drafts use exact cents and saved pricing; invoice acceptance remains a later financial phase. Documents will need scoped metadata plus private object bytes. Workflows will use allowlisted deterministic events/conditions/actions; no eval or arbitrary code. Reports need scoped server queries; backups must include database, credentials/identity, object bytes and tested restore, distinct from workspace JSON export. Import must be atomic, validate every row and never overwrite identity/history. AI is an optional adapter with an explicit data preview and confirmation; manual features remain complete.

See [API](api.md), [security](../SECURITY.md), [roadmap](../ROADMAP.md) and [extraction assessment](extraction-assessment.md).

## Durable adapter phase

`src/server/postgres/adapter.ts` implements the existing SQL interface without changing the engine or presets. Migration/role/bootstrap and native backup/restore code are separate host-only tools. The demo imports none of them and never reads persistent connection URLs. See [setup](postgres-setup.md), [migrations](../db/README.md) and [verification](postgres-verification.md). Authentication, session security, hosted access, production recovery and public business operations remain gated.

## Host-only identity and owner access

The durable PostgreSQL adapter shares Engine/SqlDatabase with the demo but uses a separate checked runtime. The local identity host uses Better Auth with its own restricted identity-service login and private schema. It resolves a fresh signed-cookie session without granting business membership. Neither adapter is imported by the public demo transport.

The owner AccessService composes that verified session with Engine.asUser. Three narrow private SQL commands authorize owner rosters and session-bound prepared/confirmed membership changes. An organization lock, independent access revision, session row lock and durable receipt order changes against competing edits and revocation. Handover retains one owner atomically. Raw membership DML stays denied, and all access tables force RLS. A separate local administrator command bootstraps new fictional workspaces only. See [the access contract](owner-access.md) for review/confirmation, recovery exclusions and the general business-write/session limitations that remain before HTTP integration.

## Credential lifecycle phase

Password changes compose the same identity host with Better Auth verification/configured hashing and a checked bounded coordinator connection. Credential-row locks coordinate sign-in and compare-and-swap updates across hosts; the recent-session rule is shared with owner SQL. Session/review revocation, credential update and a private credential audit commit atomically. Business permissions/history are not rewritten. Public transport and executable lost-access reset remain closed. See [the lifecycle contract](account-lifecycle.md) and [recovery acceptance plan](local-recovery-plan.md).

## Offline recovery phase

A local administrator maintenance service validates an external, pre-enrolled operator/evidence registry and two independently signed, version-bound reviews. It reuses the configured Better Auth codec and shared credential mutation helper. Credential-version and recovery audits are private; industry/business data is unchanged. Runtime factories use separate lifetime maintenance connections and database write guards. Restore/recovery quarantines activation until a later protected credential-lineage acceptance phase. There is no public recovery or bypass flag. See [the contract](offline-recovery.md).


## Credential lineage foundation

Migration 6 adds transaction-bound credential/version/recovery metadata to a private sequential hash chain. `src/server/lineage` separates strict versioned cryptographic formats from a local offline assessor, reusing recovery locks, trust enrollment and signature checks. Two external witnesses bind the stream/epoch/head and opaque credential-state commitments; an independently retained latest digest supplies the freshness assumption that a hash chain cannot provide alone. Journal/key/pin custody and publication remain manual and separate from DB backups. Assessment preserves blockers and changes no identity/business data. See [trust, failure model and deferred acceptance](credential-lineage.md).


## Shared relationship and scheduling phase

The `scheduling` manifest supplies resource/appointment record definitions. Reference field targets and industry terms live in configuration; jobs/tasks link customers using the existing record API and forms. Migration 7 derives scoped FK links and interval projections from source records, with forced RLS, private triggers, a coordination epoch and GiST exclusion. Record/audit/projection/receipt commit atomically. The daily agenda consumes the same scoped snapshot and generated editor in both presets. A maintained Temporal polyfill handles local-time gaps/folds; stored booking instants survive business display-zone changes. See [the complete contract](shared-scheduling.md) for migration preservation, one-resource/24-hour bounds and deferred public/session/recurrence acceptance.


### Shared workforce module

`workforce` provides employee profiles, dated resource membership and finite availability as existing configurable records. Trigger-maintained scoped projections resolve stable whole-appointment rosters and append allocation snapshots; the existing source/operation/audit transaction remains authoritative. Owners/admins administer profiles/availability through existing generated forms, while staff schedule. Worker/Crew/Equipment and old appointment contracts remain unchanged. Unenrolled legacy resources reserve no person; enrolled resources cannot bypass checks by archiving their last membership or hiding the module. See [workforce contract](crews-availability.md).


### Shared pricing module

One `estimates` module models areas, services/extras, dated rate records and internal drafts. The generic record API accepts a restricted structured estimate field; pure BigInt calculation powers previews, while epoch-ordered PostgreSQL materialization/guards independently verify exact prices/totals. Operation receipts bind original selections; append-only estimate versions retain pricing/status snapshots. No industry-specific calculator, live financial route or production activation is introduced. See [pricing contract](services-estimates.md).

Inventory reuses source records, organization epochs, operation receipts and trigger audits. Additive migration 10 projects source movements into scoped whole-unit balances and immutable historical snapshots. Catalog/product revision checks and compensating movements keep past quantities stable. The public demo loads business migrations only; native credentials/recovery blockers remain separate. [Inventory design and limitations](inventory-stock.md).

BuildPlan Studio stores versioned draft artifacts separately from published configurations. The shared Engine handles authorized draft append, full template validation and reviewed publication; `configurationImpact` is reused in UI/service, with SQL guards as a final backstop. Generated previews provision empty fictional organizations only in the isolated demo and open the actual `Workspace` in a new tab. Migration 11 preserves existing records/history and the native online-write blocker. [Design, UI flow and trust limits](buildplan-studio.md).

Read-only impact planning observes scoped configuration/source/draft versions in a single READ COMMITTED statement through existing owner/admin RLS. It explains the same validators/impact function, returns aggregate population metadata without record values, and rechecks transient state/proposal fingerprints before preview/export. Reports are configuration/warning artifacts, never migration or publication tokens. Existing write transactions remain authoritative; no DDL, private-epoch grants or production endpoint is added. [Observation, concurrency and privacy contract](migration-planning.md).
