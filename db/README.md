# Database migrations

`001_foundation.sql` remains unchanged from PR #1. The public demonstration executes it plus the shared business migrations 7 and 8 in a fresh, temporary PGlite database; identity/recovery migrations remain separate. Persistent PostgreSQL uses the **same schema and engine**, through `src/server/postgres/migrations.ts` and a separately provisioned runtime login.

## Network migration contract

- `lms_meta.migrations` records version, name, SHA-256 of the original SQL bytes and application time. Its schema/table is private, with RLS enabled/forced and no application grants.
- A PostgreSQL advisory transaction lock serializes runners in the same database. All pending SQL plus ledger entries commit together. A failure rolls everything back; there is no partially recorded success.
- Applied SQL is immutable. Changed checksums, unknown versions, duplicate/out-of-order versions and an existing untracked LMS schema are rejected. There is no automatic destructive downgrade or schema adoption.
- The original foundation contains its own BEGIN/COMMIT and a cluster-wide `CREATE ROLE lms_app`. The loader checks those exact scaffolding statements and removes **only those statements**, wrapping the unchanged business schema in the runner's transaction. It separately creates or validates `lms_app`, which is shared across databases in one PostgreSQL cluster. This avoids duplicating the business schema or silently swallowing a role-creation error. The source checksum covers the complete original file.
- `lms_app` must remain NOLOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOINHERIT, NOBYPASSRLS, with no parent roles. A pre-existing unsafe role causes an error, not an automatic repair.
- Initial commands use a **separate local administrator**. Runtime code uses only a non-owner `lms_runtime` login with NOINHERIT and membership in `lms_app`. Initializing an existing role never resets its password or grants it more rights. The adapter verifies its attributes and memberships before use.

Use `npm run db:init -- --database lms_development` once, then `npm run db:migrate -- --database lms_development` for reviewed migrations. These commands require `.env.postgres`, an exact confirmed fictional database name, and loopback URLs. They do not create/drop a database or connect to arbitrary remote hosts.

## Adding a migration

Keep historical SQL unchanged. Add the next numbered SQL file, register it explicitly in `loadMigrations`, and include failure/rollback and existing-database upgrade tests. New migrations must not contain their own top-level transaction controls. Migration authors are trusted maintainers; the runner does not sandbox arbitrary SQL. Take a native backup, rehearse on a separate database, review grants/RLS/locks and verify the resulting schema before applying an upgrade. Never use a down migration to erase retained business/audit history.

Version 1 remains immutable. Version 2 adds only the private local identity schema and its separate role boundary. Initialization validates both service roles. Fixture seeding lives in test support, outside migrations. There are no real accounts, passwords, invoices or sample personal data in schema SQL.

Migration 2 follows the Better Auth 1.7.14 core schema, without providers/plugins. Existing version-1 databases upgrade transactionally without rewriting business rows or the original checksum. New network tests rehearse this upgrade. The temporary PGlite demo loads shared business migrations 1, 7 and 8, without identity/recovery schemas.

Migration 3 adds access revisions, private session-bound membership reviews, durable confirmation/bootstrap receipts and three private owner commands with invoker wrappers. It backfills revision zero without changing existing roles/records; the network suite rehearses version 2 → 3. Raw membership DML remains denied. All new tables force RLS. Definer/helper search paths are empty and PUBLIC execution is revoked. See [owner contracts](../docs/owner-access.md). Roll back code only after reviewing schema compatibility; recovery uses a verified offline backup, never destructive down SQL.

Migration 4 adds forced-RLS credential events, a private append-only audit trigger and one shared recent-session helper. Existing owner commands now require sign-in within five minutes, including after lock waits. It does not change existing session timestamps, passwords, memberships or business history. Host changes use a compare-and-swap credential lock, session lock, all-session/review revocation and audit in one transaction. The suite rehearses version 3 → 4 and re-runs migration failure rollback. See [the credential contract](../docs/account-lifecycle.md). The demo continues to execute version 1 alone.

Migration 5 adds private recovery trust/cases/events, credential-version UUIDs and `lms_control` online/quarantine state. It changes no passwords or business history. Shared online/write gates, runtime leases and exclusive offline locks prevent normal attachment during maintenance. Credential versions rotate through a private trigger; recovery reuses credential audits. Every supported restore installs a permanent marker, purges case data and blocks activation; an older restored archive stays blocked when upgraded. Stop all hosts before upgrading, including legacy versions without leases. See [offline recovery and activation limits](../docs/offline-recovery.md). No migration, init command or recovery option unblocks a database.


## Migration 6: offline credential-lineage enrollment

`006_credential_lineage.sql` uses the existing exclusive maintenance advisory lock plus non-waiting source-table locks; stop all identity/business hosts first. Existing v5+ leases prevent enrollment. The runner transaction backfills metadata baselines/audits and installs private version/credential/recovery triggers atomically. A failed migration leaves all pending schema/ledger changes unapplied. Prior SQL/checksums remain unchanged. No business data or membership/history is rewritten.

A stable logical stream, sequence and SHA-256 chain are retained in backups. This database outbox is not its own trust anchor. Independently protected two-person checkpoints, a latest receipt and an off-database HMAC key are required by [the separate offline lineage contract](../docs/credential-lineage.md). Already quarantined databases are marked ineligible for genesis; neither migration nor lineage assessment removes any activation blocker. Runtime roles cannot read/write lineage tables or call its private definer helpers. Coordinate protected external custody separately from normal PostgreSQL backups.


## Migration 7: shared relationships and resource scheduling

`007_relationship_scheduling.sql` installs `btree_gist`, scoped reference/appointment projections, operation receipts and a private mutation epoch. Narrow definer triggers validate source-record relationships, retain archive/history and enforce an exclusive `[start,end)` resource constraint; runtime roles cannot mutate projections/receipts directly. A real coordination-row version rejects stale snapshot writers. All added tables force RLS.

Stop all hosts first; the existing exclusive maintenance lease/table locks protect installation. All SQL/ledger changes are transactional. Existing records/configurations/roles/audits are preserved, and untracked appointment rows fail enrollment. New presets enable the module only for newly created fictional workspaces; no old work schema is silently changed. See [upgrade/retry/DST/constraint contract](../docs/shared-scheduling.md). Neither this migration nor native restore unblocks activation.


## Migration 8: dated crews and availability

`008_workforce_availability.sql` adds scoped membership/availability projections and retained per-revision employee allocations. The existing organization epoch orders their checks with bookings; a new GiST exclusion prevents the same employee being reserved through different Worker/Crew resources. Source record permissions restrict workforce administration to owners/admins; projections force RLS and grant runtime reads only. Work windows, time off and effective rosters are checked transactionally; invalidating changes refuse rather than silently alter reserved people.

Stop hosts and back up before the normal `db:migrate` command. The exclusive maintenance/table locks and migration transaction apply, preserving migrations 1–7, original records/configuration and audits. Untracked workforce entities refuse upgrade. Existing resource-only appointments receive no fabricated people; explicit enrollment requires cancellation/archive of blocking bookings. [Setup, enrollment, failure behavior and limits](../docs/crews-availability.md). All restored databases remain activation-blocked.
