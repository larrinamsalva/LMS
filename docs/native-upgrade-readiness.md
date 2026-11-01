# Native Upgrade Readiness

This is a **host-only, fictional PostgreSQL 16 lab workflow**. It inspects prerequisites and can rehearse the existing native dump/restore into a separate empty database. It performs no business-schema transformation, publication, production activation or real-customer copying. There is no HTTP endpoint, upload/download service or automatic deployment.

## Three different kinds of evidence

| Experience | Environment | Evidence and limits |
| --- | --- | --- |
| Configuration preview | Empty temporary PGlite Engine workspace | Shows the proposal without copying records |
| Public fictional rehearsal | Generated fictional Engine records in another temporary PGlite organization | Exercises fixed operations; never supplies native backup evidence or migration authorization |
| Native Upgrade Readiness | Allowlisted fictional local PostgreSQL source and fresh restore database | Inspects prerequisites and explicitly verifies a same-schema native copy; cannot establish a schema transformation or production recovery is safe |

Native reports are not imported into Studio. Its business-specific backup checklist stays unverified. Existing impact/publication checks and populated-schema blockers remain authoritative. Reports grant no authorization.

## Trust and supported environment

- Use a **disposable trusted PostgreSQL 16 cluster** and major-16 native `pg_dump`/`pg_restore`. The existing Docker Compose and client installation are in [setup](postgres-setup.md). CI tests PostgreSQL/client 16.15; other majors refuse.
- Both URLs must use one exact **literal loopback** endpoint (`127.0.0.1` or `[::1]`, same port), the approved maintenance role and a password. DNS/remote endpoints, URL query/fragment overrides and aliases refuse. Only exact `lms_test_*` sources and `lms_restore_*` targets are eligible; even `lms_development` is outside this coordinator's scope.
- A private, process-owned regular non-symlink trust file binds one source instance UUID, its **complete** set of 1–10 fictional organization IDs and one target name. The connected role must actually be the approved superuser and database owner. Application/business-owner credentials cannot authorize maintenance. Server control identifiers must match; the target OID is checked again within the restore lease. Preflight never repairs roles/owners/settings.
- Establish fictional provenance **before** enrolling the allowlist: verify the lab's provisioning history and all business/identity data through trusted host procedures. Names, UUIDs, `fictionalOnly` and `@example.test` identity spelling bind evidence; **they cannot infer that arbitrary data is fictional**. Refuse enrollment when provenance is uncertain. Never rename or relabel a customer database to make it eligible.
- Trust the host OS/account, PostgreSQL server, reviewed source database/schema and installed tools. Dumps contain executable SQL. Do not use forwarding/proxies, shared/production clusters, untrusted sources or independently supplied archives. Loopback and POSIX permissions do not certify physical locality, provenance or honesty against a compromised host/server/administrator.
- Stop all identity/business hosts and close source/target inspection connections. Exclusive existing offline/migration leases and checks for other client backends (including idle connections) refuse active hosts. A control connection to a **different** test database may remain open.

Missing/unsafe evidence, source recovery/quarantine blocking, unknown tables/routines/extensions, missing migrations, checksum drift, unsupported configurations and busy/populated destinations refuse. Applied SQL 1–12 stays unchanged. This phase is bounded to the reviewed table inventory, 10,000 rows/table, 50,000 total rows and 16 MiB serialized rows; larger labs need a reviewed streaming design.

## Local workflow

Provision only a known fictional source with the existing migrations/test fixtures in a disposable cluster. Prepare a **new empty** `lms_restore_*` database using its trusted administrator. This utility never creates, drops, cleans or overwrites databases. Do not reuse failed restore destinations.

1. Follow [PostgreSQL setup](postgres-setup.md) for private `.env.postgres` configuration. Set `LMS_ADMIN_DATABASE_URL` to the fictional source and `LMS_RESTORE_DATABASE_URL` to the separate empty target. Keep credentials out of command arguments, reports and git. Set `LMS_PG_BIN` if native tools are outside PATH.
2. Prepare private operator files outside the repository:

   ```sh
   umask 077
   mkdir -p "$HOME/lms-fictional-readiness/work"
   chmod 700 "$HOME/lms-fictional-readiness" "$HOME/lms-fictional-readiness/work"
   cp examples/native-readiness-trust.example.json "$HOME/lms-fictional-readiness/trust.json"
   chmod 600 "$HOME/lms-fictional-readiness/trust.json"
   ```

3. Replace the deliberately invalid example placeholders with **previously verified fictional** source evidence and all its organizations. A trusted administrator can inspect `select instance_id from lms_control.state where singleton` and `select id from lms.organizations order by id` in the established lab. Close that connection afterward. These values alone prove neither fictional provenance nor recovery identity. Use a neutral lab label for `environment`, without names or secrets.
4. Inspect prerequisites without creating/restoring an archive:

   ```sh
   npm run db:readiness -- preflight \
     --trust "$HOME/lms-fictional-readiness/trust.json" \
     --work-directory "$HOME/lms-fictional-readiness/work" \
     --report "$HOME/lms-fictional-readiness/preflight-01.json"
   ```

   Read `checks`, `versions`, `remainingBlockers` and `backupReadiness`. `preflight-complete` is bounded observation-time evidence; backup readiness remains `not-verified`. It reserves no later run.
5. Review the report and explicitly confirm the fictional round-trip:

   ```sh
   npm run db:readiness -- rehearse \
     --trust "$HOME/lms-fictional-readiness/trust.json" \
     --work-directory "$HOME/lms-fictional-readiness/work" \
     --report "$HOME/lms-fictional-readiness/rehearsal-01.json" \
     --confirm "REHEARSE FICTIONAL NATIVE BACKUP"
   ```

   Execution repeats all checks. It accepts no archive, executable hook or earlier report as input. Source `SHARE NOWAIT` locks prevent table changes while allowing the existing dumper; no source DML/DDL is issued and the inspection transaction always rolls back. The existing maintenance/migration locks remain held through copy/verification. See PostgreSQL's [lock contract](https://www.postgresql.org/docs/16/sql-lock.html) and [dump snapshot behavior](https://www.postgresql.org/docs/16/backup-dump.html).
6. Success requires `rehearsal-complete`, `verified-fictional-round-trip` and every check passed, including cleanup. The archive is removed; the populated restored database remains quarantined for separate offline administrator inspection. A later preflight on that destination refuses. Prepare a newly named empty target and explicitly update the private allowlist for a new case; never remove quarantine or erase a database to reuse it.

Reports are exclusively created as `0600`, synced and never overwritten. Blocked runs exit nonzero; duplicate/unknown CLI flags refuse. SIGINT/SIGTERM abort children and await termination before removing partial files. An incomplete/unparseable report after process/host failure is never success. Use a new report filename per explicit attempt.

## Verification and privacy

The existing native utility remains the sole archive implementation: new private custom archive; inherited libpq overrides removed; empty-target/lease checks; durable database quarantine **before** restore; single-transaction exit-on-error restore; transient-state purge and permanent marker. Internal trusted callbacks recheck authority/identity before restore and verify before releasing its lease. They are code-owned helpers, never inputs from HTTP, archives or CLI JSON.

Temporary random keyed HMACs compare original SQL JSON text grouped by organization and sorted, retaining exact numeric text. Key, fingerprints, raw rows and IDs never enter the report. The key buffer is cleared; complete JavaScript/OS memory erasure is not certified. All retained tables are compared: active/archived/disabled records, configurations, draft revisions, memberships, audits, operation receipts, references, stock balances/movements, estimate lines/version snapshots, appointments, workforce allocations/history and private credential/recovery/database-lineage history. **External credential freshness is not accepted.**

Only expected differences are empty session/verification/pending-membership-review/recovery-case tables and new blocked restore-control identity/state. Checks reuse v1/v2 validators and verify migration checksums, known tables, forced RLS, service-role attributes, denied private grants, validated constraints, and matching columns/constraints/indexes/triggers/functions/policies and table/function ACLs. Actual RLS is exercised with an unavailable principal without creating a membership. Native restore validates constraints. This is preservation/structural validation, not an independent implementation or certification of every business calculation; existing module regressions test those behaviors.

After restore's lease closes, both existing runtime-lease paths must specifically refuse **activation**. Source data/history/catalog are compared again under source fences. Reports contain a neutral lab label, fixed steps/statuses, version numbers and generic remaining requirements. No URLs, passwords, operational values, raw errors, signing material, record/organization IDs, hashes, archive bytes or executable commands are included.

## Failure and future requirements

- Partial/corrupt copies, altered history, missing evidence, failed verification, interruption or cleanup failure return `blocked` / `not-verified`, regardless of earlier passes. No automatic resume/retry, older-result fallback or force option exists. A new invocation rechecks authority/state and refuses populated/quarantined destinations.
- Archives occupy newly minted private subdirectories in the approved private work directory. Normal failure removes its archive and empty directory. Unexpected residual files/permissions prevent cleanup and therefore readiness. The utility does not recursively erase unknown contents or drop databases. Inspect residual `lms-native-rehearsal-*` directories locally through trusted maintenance procedures.
- SIGKILL, power loss or OS/disk failure can leave private artifacts/incomplete evidence. No atomic cross-database/file publication or physical power-loss certification is claimed. Existing durable quarantine protects attempts reaching restore. Keep hosts stopped and inspect; do not attach a partially restored destination or remove blockers.
- Future schema execution requires deterministic reviewed transformations, exact source/proposal fencing, private actual-data handling, verified backups, tested rollback/failures, independent authorization and production acceptance. Same-schema copying proves none of those transformations. No migration executor is added.
- Old credentials can return in old backups. This utility does not accept external signed checkpoints, latest independently retained receipts, identity/sole-owner approvals, password knowledge, key custody or recovery activation. All [lineage](credential-lineage.md), [publication](checkpoint-publication.md), [recovery](offline-recovery.md) and deployment blockers remain. No independently monotonic witness or protection against rollback of every trust anchor is added.
- Sources already recovery/restore-blocked, cross-cluster/major upgrades, arbitrary archives, real customers, production endpoints, encryption/retention/off-device copies and production disaster recovery remain outside scope. Reports are unauthenticated local observations, not signed approvals. They grant no authority after fences close.

[Verification](native-upgrade-readiness-verification.md) · [Fictional rehearsal](fictional-rehearsal.md) · [Impact planning](migration-planning.md) · [Security](../SECURITY.md) · [Roadmap](../ROADMAP.md).
