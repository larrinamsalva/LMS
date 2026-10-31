# Credential lineage verification

Scope: PR #7, independent lineage foundation for fictional accounts. **No activation or recovery-identity acceptance is implemented.** All assertions of success below concern source tests and locked offline consistency, not a deployed service or independent security certification.

## Checks

Results are recorded after the checks run on the review commit. Native PostgreSQL integration is required and never silently skipped. The local environment has no native PostgreSQL server/client pair, so the network/backup results must come from the dedicated PostgreSQL CI job, not from embedded SQL tests.

## Test evidence

- Existing password/session/recent-auth/owner/recovery suites run unchanged in behavior, with migration-6 ledger expectations added.
- New pure protocol tests exercise signatures/purpose separation, pinned prefix rollback, chain damage, epoch replay, expiration and secret-bound commitments.
- New native PostgreSQL cases cover an active-host migration refusal and atomic offline upgrade, SQL/Node chain compatibility, least-privilege denial, witnessed restore with preserved business bytes, older backup rejection, unwitnessed tail/old-journal rejection, corrupt/missing/insecure files, forged/expired/future approvals, substituted/missing keys, unsupported instance history, hash-only tampering, version/source audit/outbox deletion, concurrent rotation, failed outbox transaction, recovery/replay auditing, residual-session refusal, unenrolled legacy restore and safe CLI output.
- Existing browser cases verify the independent public no-login demo, phone/desktop behavior, accessibility, themes and configuration/data flows. No UI or public route changes are introduced.

Custodian keys/pins are simulated in one test process and old enrollment dates are fixture-only adjustments. These tests demonstrate protocol checks and native transaction/restore behavior; they do not prove independent human identity, separate-device custody, a trustworthy PostgreSQL administrator, durable latest-head publication, arbitrary filesystem restore detection or safe service activation. See [the complete trust/failure contract](credential-lineage.md).
