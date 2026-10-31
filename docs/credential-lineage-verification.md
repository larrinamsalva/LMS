# Credential lineage verification

Scope: PR #7, independent lineage foundation for fictional accounts. **No activation or recovery-identity acceptance is implemented.** All assertions of success below concern source tests and locked offline consistency, not a deployed service or independent security certification.

## Checks

Verified **2026-10-31** on implementation commit [`e75e3ced3dedcac978ebc3b7a805dfc6da0ade30`](https://github.com/larrinamsalva/LMS/commit/e75e3ced3dedcac978ebc3b7a805dfc6da0ade30), [quality run 24](https://github.com/larrinamsalva/LMS/actions/runs/41246117149). All three jobs completed successfully; results were checked in the job logs. The subsequent evidence commit changes documentation only.

| Check | Verified result |
| --- | --- |
| TypeScript and Next.js production build | Passed locally and in CI; only `/`, `/_not-found` and `/api/demo` application routes built |
| Unit/embedded SQL/security | **27 passed**, 9 files |
| Native PostgreSQL integrations | **72 passed**, 6 files, including **15 new lineage cases** and all 57 existing tests |
| Production browser checks | **8 passed**, desktop/phone, in CI and locally |
| Dependency licenses | **186** declarations verified; no dependency changes |
| Dependency audit | Local `npm audit`: **0** known vulnerabilities at verification time; CI install also reported zero |

Native tests ran on Ubuntu 24.04, Node **24.22.1**, npm **11.19.1**, PostgreSQL server **16.15** (Debian image), native `pg_dump`/`pg_restore` **16.15** (Ubuntu client package). Native integration is required and never silently skipped. The local environment has no usable native PostgreSQL server/client pair; PostgreSQL/backup claims come from [the dedicated CI job](https://github.com/larrinamsalva/LMS/actions/runs/41246117149/job/124669808370), not embedded SQL. Local checks used Node 24.22.1/npm 11.9.0 and the installed Chromium **153.0.8010.0** override.

No deployment, production account/database or outbound service was used. The public demo/UI, migrations 1–5, MIT license and ForgeOS attribution files are unchanged.

## Test evidence

- Existing password/session/recent-auth/owner/recovery suites run unchanged in behavior, with migration-6 ledger expectations added.
- New pure protocol tests exercise signatures/purpose separation, pinned prefix rollback, chain damage, epoch replay, expiration and secret-bound commitments.
- New native PostgreSQL cases cover an active-host migration refusal and atomic offline upgrade, SQL/Node chain compatibility, least-privilege denial, witnessed restore with preserved business bytes, older backup rejection, unwitnessed tail/old-journal rejection, corrupt/missing/insecure files, forged/expired/future approvals, substituted/missing keys, unsupported instance history, hash-only tampering, version/source audit/outbox deletion, concurrent rotation, supported Better Auth password change with old-cookie revocation, failed outbox transaction, recovery/replay auditing, residual-session refusal, unenrolled legacy restore and safe CLI output.
- Existing browser cases verify the independent public no-login demo, phone/desktop behavior, accessibility, themes and configuration/data flows. No UI or public route changes are introduced.

Custodian keys/pins are simulated in one test process and old enrollment dates are fixture-only adjustments. These tests demonstrate protocol checks and native transaction/restore behavior; they do not prove independent human identity, separate-device custody, a trustworthy PostgreSQL administrator, durable latest-head publication, arbitrary filesystem restore detection or safe service activation. See [the complete trust/failure contract](credential-lineage.md).
