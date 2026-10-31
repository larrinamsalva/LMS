# Durable PostgreSQL verification

Scope: a host-only node-postgres adapter using the existing Engine/SqlDatabase interfaces; public demo storage and UI remain unchanged. No authentication or persistent business HTTP operation is added.

The dedicated `postgres` GitHub Actions job uses PostgreSQL 16.15, native PostgreSQL client tools and disposable fictional databases. `npm run test:postgres` fails on missing configuration and never reports a skip as a pass.

| Test | Evidence / result |
| --- | --- |
| Separate application processes | Write in one process, exit, start a fresh process/pool and compare retained record ID/data |
| Concurrent writes | Competing edits/config publications: one succeeds, one returns revision conflict; exactly one retained update audit |
| Database security | Cross-org SQL returns zero rows/rejects inserts; viewer/staff/self-promotion/audit rewrite denied; unsafe runtime credentials rejected |
| Pool/session cleanup | Commit/rollback reset role/identity; rolled-back records disappear; live membership revocation denies the next request |
| Migrations | Idempotence, runner locking, changed checksum rejection and atomic rollback after intentional DDL/SQL failure |
| Native recovery | Private PGDMP archive; fresh-database restore retains rows/config/history/audits/RLS/constraints; authorized write succeeds afterward |
| Failure handling | Wrong/nonempty restore targets, corrupt archive, missing client binary and backup overwrite rejected without changing source records |
| Demo separation | Persistent URL configured; separate temporary databases contain none of the persistent fixtures and start empty again |

Local environment: Node 24.22.1, Next.js 16.4.3. Docker/PostgreSQL executables are unavailable here; a native server cannot run under this environment's user model. Network concurrency and native backup/restore are therefore executed by the dedicated CI service, **not claimed as local PGlite or mock results**. Existing local unit/database, type/build/license and desktop/phone browser checks are run separately. The PR Checks tab records the exact final CI result; this document describes the asserted flows, not a guarantee that an unrun job passed.

Local results: `npm run check` passed with **14 tests**, type checking, production build and **166** dependency declarations verified; all **8** existing desktop/phone browser tests passed using installed Chromium 153.0.8010.0. `npm audit` reported **0** known vulnerabilities on 2026-10-31. **Real PostgreSQL CI results: all 9 network integration tests passed** against PostgreSQL **16.15** with native `pg_dump`/`pg_restore` **16.15**, including successful fictional backup and restore. Evidence: [PostgreSQL job](https://github.com/larrinamsalva/LMS/actions/runs/41233850439/job/124633378878). No production, remote TLS, physical mobile, database-server restart/failover, large-data performance or real-identity acceptance is claimed. Application process restart and database backup restoration are distinct checks. A volume is not an off-device backup.

The first network run caught a native-tool environment bug: supplying an empty `PGSERVICE` still selected a libpq service. The wrapper now removes inherited `PG*` options and supplies only its explicit target settings. The successful recovery test deliberately sets a nonexistent service and a conflicting role option, verifies both are ignored, then compares restored records/config/history/audits, re-tests RLS and foreign keys, and writes a new authorized record. No failed recovery test is counted as a successful rehearsal.
