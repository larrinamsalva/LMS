# Database migrations

`001_foundation.sql` remains unchanged from PR #1. The public demonstration still executes it in a fresh, temporary PGlite database. Persistent PostgreSQL uses the **same schema and engine**, through `src/server/postgres/migrations.ts` and a separately provisioned runtime login.

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

Migration 2 follows the Better Auth 1.7.14 core schema, without providers/plugins. Existing version-1 databases upgrade transactionally without rewriting business rows or the original checksum. New network tests rehearse this upgrade. The temporary PGlite demo still loads version 1 only.
