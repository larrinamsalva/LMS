# Crew and availability verification

PR #11 reuses the record/scheduling engine, configuration forms, role checks, transaction epoch, audit and exact-retry infrastructure. Verification is fictional and host-only; no production account, business endpoint, payment, outbound service or recovery activation is enabled.

## Verified implementation

Implementation commit: [`d0d784fd6dfaba0fde57acad50ca4af6aeab99e2`](https://github.com/larrinamsalva/LMS/commit/d0d784fd6dfaba0fde57acad50ca4af6aeab99e2). All three jobs in [CI run 41253975043](https://github.com/larrinamsalva/LMS/actions/runs/41253975043) passed with existing suites enabled.

| Check | Actual result | CI evidence |
| --- | --- | --- |
| `npm run check` | Type checking; **64 tests in 14 files**; **188** dependency license declarations; production build passed | [Foundation](https://github.com/larrinamsalva/LMS/actions/runs/41253975043/job/124693116206) |
| `npm run test:postgres` | **93 tests in 8 files**, including all **9 new native workforce cases**, passed | [PostgreSQL](https://github.com/larrinamsalva/LMS/actions/runs/41253975043/job/124693115951) |
| `npm run test:e2e` | **21 tests**: 7 scenarios across desktop, tablet and phone, passed | [Browser](https://github.com/larrinamsalva/LMS/actions/runs/41253975043/job/124693116059) |
| Install audit | CI installs reported **zero known vulnerabilities** at verification time; no npm dependency added | Time-dependent registry result, separate from license checks |

CI uses Node 24, network PostgreSQL **16.15** and native PostgreSQL **16.15** dump/restore tools. Native tests ran in CI against real PostgreSQL, not the local embedded substitute; prerequisites are required and never silently skipped.

Local `npm run check` and the complete 21-test browser run also passed on Node 24.22.1 with Chromium 153.0.8010.0. Phone and tablet screenshots were visually inspected for readable light/dark layouts and overflow. An earlier local run was invalidated when a concurrent build replaced the browser server's assets; its trace showed failed asset loads. The fixed-build rerun and independent CI both passed without relaxed assertions.

## Behavior exercised

- Both industries create fictional profiles, publish working hours, enroll Worker or multi-person Crew resources and schedule through the existing customer/work/appointment forms. The directory and schedule expose the reserved people and retained allocation history. Browser tests reject overlapping vacation, run accessibility checks in light/dark modes and check document overflow.
- PostgreSQL refuses an employee reservation through another Crew or Worker, including simultaneous direct SQL writes without the Engine organization lock. Adjacent resource/membership interval policy and PR #10 scheduling tests remain enabled.
- Concurrent time-off/booking and inactive-profile/booking changes leave only a valid committed outcome. Membership/booking races retain the roster chosen by transaction order: a later change affecting reserved work refuses. Frozen REPEATABLE READ availability writers fail after a competing booking commit.
- Staff/viewer workforce administration, foreign employees/subjects, malformed ranges/zones/precision, projection mutation and allocation-history deletion are refused. Profile work titles do not grant identity or organization permissions.
- Missing work windows, roster transitions during an appointment, resource-specific work windows/time off, inactive employees and invalidating edits are checked. Reschedule/restore revalidate current eligibility; completed/cancelled/archived policies retain the existing scheduling semantics.
- Exact retries do not duplicate records/allocations/audits; altered retries and stale revisions fail. Failed changes leave audit/reservation state intact. Released allocation snapshots retain names, roles, skills and effective membership revisions/spans; new revisions can capture updated profile labels without rewriting old snapshots.
- Migration 7 → 8 refuses active hosts, then preserves existing records/configuration/audits with no fabricated employee assignments. Workforce activation on the pre-8 database refuses. Migrations 1–7 are unchanged. Native backup/restore retains memberships, availability, source records and allocations, and the restored runtime remains activation-blocked.

All **84 preexisting native tests** continue to cover persistence, organization/role isolation, scheduling concurrency and history, authentication/session revocation, owner access, credential lifecycle, offline recovery, external credential lineage and trusted checkpoint publication. No security control, assertion or required suite was disabled.

## Limits of this evidence

One resource per appointment; finite work windows rather than weekly recurrence; stable whole-appointment crew membership; no split rosters or staffing subsets. Skills are descriptive. Unenrolled PR #10 resources reserve no employee identity; separate profile IDs are not proof of distinct physical people. Real identity verification, employee privacy, individual staff permissions and persistent-business session acceptance need separate review.

Browser device emulation and automated accessibility checks do not certify every real device or assistive technology. Time-zone tests do not certify every future timezone-data update. Payroll, timesheets, recurring schedules, external notifications and AI optimization remain deferred. All credential/recovery/publication activation blockers remain. See the [full contract and trust boundary](crews-availability.md) and [roadmap](../ROADMAP.md).
