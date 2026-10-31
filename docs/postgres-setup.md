# Experimental durable PostgreSQL setup

This phase adds a **host-only storage adapter**, migration runner and native backup/restore rehearsal. It does not add persistent business HTTP endpoints or verified user authentication. The website remains the isolated, temporary fictional demo. Setting `LMS_POSTGRES_URL` never changes its database.

## Local prerequisites

Node 22+ (verified on Node 24), npm, Docker Engine/Desktop with Compose. Alternatively install PostgreSQL 16+ locally and create a separate `lms_development` database. The adapter uses node-postgres, a bounded pool (default 5, allowed 1–20), parameterized queries and one checked-out client per transaction. No engine business logic is copied.

1. Run `npm ci`.
2. Copy `.env.postgres.example` to `.env.postgres`. Generate **two different** passwords, for example by running `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` twice. Replace every placeholder. Keep this file private; it is ignored by git. Do not add NEXT_PUBLIC prefixes to credentials.
3. Start the local database:

   ```sh
   docker compose --env-file .env.postgres up -d --wait
   npm run db:init -- --database lms_development
   ```

   The pinned PostgreSQL 16.15 container binds only `127.0.0.1:5433` and stores data in a named volume. No web service is published. Initialization applies the schema and creates/verifies the restricted runtime login. It requires a local administrator and an exact confirmed fictional database name. A role already present is checked, never silently repaired or password-reset.
4. Apply subsequent reviewed migrations explicitly:

   ```sh
   npm run db:migrate -- --database lms_development
   ```

5. Stop/restart the database using `docker compose --env-file .env.postgres stop` and `docker compose --env-file .env.postgres start`. The named volume retains database files. `POSTGRES_PASSWORD` only initializes an empty PostgreSQL data directory; editing the env file does not rotate an existing role's password.

The normal `npm run dev`, `npm run build` and `npm start` continue to use the temporary demo. There is no UI that can choose a persistent database, no browser-supplied Principal, and no production database fallback.

## Host integration contract

Trusted future host code explicitly calls `connectPostgres({connectionString})`, passes the returned `SqlDatabase` to the existing `Engine`, and calls `close()` during shutdown. It must authenticate the user before constructing `Principal`. This PR supplies no authentication adapter; the integration tests use fictional test identities provisioned by trusted fixtures.

The runtime login must not own the database/application schemas, have elevated attributes, or have any role membership other than `lms_app`. Its NOINHERIT status denies direct business-table queries before the engine switches locally to `lms_app`. The engine's transaction-local user assertion and PostgreSQL memberships/RLS remain the authority. Commits and rollbacks return connections without the previous caller's identity. Administrator URLs belong only to maintenance tools, never a runtime pool.

Connections to non-loopback hosts require TLS with certificate verification. A private CA can be passed as `ca`; URL query parameters cannot override TLS. Remote hosting/TLS acceptance has **not** been performed. This is not authorization to connect a production database. Maintenance commands are intentionally local-only, restricted to `lms_development`, `lms_test_*` or `lms_restore_*` and require `--database` to match the URL. They never print credentials.

## Native backup and restore

A workspace JSON export is not a database backup. Native backups include schema, rows, memberships, configuration/audit history, policies and migration ledger. PostgreSQL cluster logins/passwords, future identity-provider state and document object bytes require separate recovery procedures. This foundation has no external objects/identity provider.

Install PostgreSQL client tools matching or newer than the server, and keep `pg_dump`/`pg_restore` on PATH (or set `LMS_PG_BIN`). Create a private `backups` directory first (for example, `mkdir -m 700 backups` on Linux/macOS; on Windows restrict its ACL to your account), then:

```sh
npm run db:backup -- --database lms_development --file backups/fictional.dump
docker compose --env-file .env.postgres exec -T postgres createdb -U postgres lms_restore_rehearsal
npm run db:restore -- --database lms_restore_rehearsal --file backups/fictional.dump
```

`LMS_RESTORE_DATABASE_URL` must name that separate local restore database. Backups create a new file with mode 0600 and refuse overwriting; failed dumps remove their partial file. Restores refuse populated targets, use a single transaction with exit-on-error, and never drop an existing workspace. Only restore archives you trust: PostgreSQL dumps contain executable SQL. Protect/encrypt copies and credentials and keep another copy on a different device; no automated retention, encryption or disaster-recovery service is supplied.

If only Docker is installed, use its native client tools as the alternative (run from a private directory; make the resulting archive readable only by your account):

```sh
docker compose --env-file .env.postgres exec -T postgres pg_dump -U postgres -d lms_development --format=custom --no-owner > fictional.dump
docker compose --env-file .env.postgres exec -T postgres createdb -U postgres lms_restore_rehearsal
docker compose --env-file .env.postgres exec -T postgres pg_restore -U postgres -d lms_restore_rehearsal --single-transaction --exit-on-error --no-owner < fictional.dump
```

These Docker commands are manual alternatives; the guarded Node restore command also checks that the target is empty. Do not use `--clean` to overwrite a workspace. On a new cluster, recreate the checked NOLOGIN `lms_app` role before restoration and provision a separate restricted runtime afterward; cluster credentials are intentionally not embedded in the archive. Validate migration checksums, compare restored fictional records/history, re-test unauthorized reads/writes and perform a new authorized write before accepting a recovery. A backup without a verified restore is insufficient.

## Run the network tests

Use a disposable PostgreSQL cluster with administrator credentials and native dump/restore tools. Create an empty `lms_test_control` database. Set `LMS_TEST_ADMIN_URL` to its loopback URL and optionally `LMS_TEST_RUNTIME_PASSWORD` to a long fictional test password, then run:

```sh
npm run test:postgres
```

The suite refuses a missing URL or ordinary database name; it never silently skips. It creates randomly named test/restore databases and drops **only those databases it created**. Do not point it at a shared or real-business cluster. It tests separate application process restarts, competing record/config updates, SQL isolation, revoked membership, pooled identity reset, migration checksum/rollback, native backup/restore, failed restore and independence from the public demo. A dedicated PostgreSQL CI job runs it alongside existing foundation and responsive browser jobs.

See [migration rules](../db/README.md), [verification results](postgres-verification.md) and [remaining security gates](../SECURITY.md).
