# Checkpoint publication verification

PR #9 is a bounded fictional-data publication phase. It does not implement an independently monotonic witness, long-outage/corrupt-intent repair, restored-instance acceptance or activation. [The workflow and failure contract](checkpoint-publication.md) describe custody assumptions and fail-closed behavior.

Verified **2026-10-31**, implementation commit [`11706275afe9782a97cc5ed3aa7299f1d5774eed`](https://github.com/larrinamsalva/LMS/commit/11706275afe9782a97cc5ed3aa7299f1d5774eed), [quality run 28](https://github.com/larrinamsalva/LMS/actions/runs/41248052527). All three jobs completed successfully; their actual logs were inspected. The follow-up evidence commit changes documentation only.

| Check | Verified result |
| --- | --- |
| TypeScript and Next.js production build | Passed locally and in [foundation CI](https://github.com/larrinamsalva/LMS/actions/runs/41248052527/job/124675517332); application routes remain `/`, `/_not-found` and `/api/demo` |
| Unit/embedded SQL/security | **45 passed**, 10 files, including **18 publication tests** |
| Native PostgreSQL | **74 passed**, 6 files: all 72 existing cases, 2 additional publication integration cases and publication coverage added to the existing recovery/replay case |
| Browser/accessibility/HTTP regressions | **8 passed**, desktop/phone, locally and in [browser CI](https://github.com/larrinamsalva/LMS/actions/runs/41248052527/job/124675517569) |
| Dependency licenses | **186** npm dependency declarations verified; no npm package additions |
| Dependency audit | Local `npm audit` and CI install reported **0** known vulnerabilities at check time |

The [native PostgreSQL job](https://github.com/larrinamsalva/LMS/actions/runs/41248052527/job/124675517579) used Ubuntu 24.04, Node **24.22.1**, npm **11.19.1**, PostgreSQL server **16.15** and native `pg_dump`/`pg_restore` **16.15**. Native tests are required and never silently skipped. Local verification used Node 24.22.1/npm 11.9.0, util-linux `flock` **2.39.3**, and installed Chromium **153.0.8010.0**. The local environment has no usable native PostgreSQL server/client pair; backup/restore claims come from the real CI service, not embedded SQL.

No database migration, authentication route, demo UI, MIT license or ForgeOS attribution file changes in this phase. No production service/database/account was used or deployed.

Coverage includes existing credential/session/owner/recovery/lineage regressions, independent publication signatures/confirmation, parent compare-and-swap, competing publishers, old-store rollback against an independent receipt, missing/corrupt histories, unsupported instance transitions, stale approvals, every durable write boundary, exact partial-record completion, corrupt/expired intent refusal, lost response reconciliation, SIGKILL lock release and CLI secret-free errors. Native cases connect published receipts to an older PostgreSQL archive, a current restore and completed offline recovery while preserving business bytes and activation blockers.

Operator keys/receipts are simulated within one test process and fixture clocks establish prior enrollment. Filesystem tests exercise real Linux locks and sync calls with injected interruptions, not a physical power cut or separate-device custody. No production database/account, deployment or public recovery/auth route is involved.
