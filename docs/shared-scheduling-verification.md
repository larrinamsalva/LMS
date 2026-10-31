# Shared scheduling verification

PR #10 adds fictional customer/work relationships and exclusive-resource scheduling through the existing engine. It does not enable production endpoints or recovery activation.

## Verified source and checks

Implementation commit: [`da717d1aaea58d44502d0259dbdca69440d6633b`](https://github.com/larrinamsalva/LMS/commit/da717d1aaea58d44502d0259dbdca69440d6633b). [GitHub Actions run 41251815134](https://github.com/larrinamsalva/LMS/actions/runs/41251815134) runs the existing quality workflow with all suites enabled.

| Check | Actual result | Evidence |
| --- | --- | --- |
| `npm run check` | Type checking, 55 tests in 12 files, 188 dependency license declarations, production build passed | [Foundation job](https://github.com/larrinamsalva/LMS/actions/runs/41251815134/job/124686736905) |
| `npm run test:postgres` | 84 tests in 7 files passed, including all 10 new scheduling cases | [PostgreSQL job](https://github.com/larrinamsalva/LMS/actions/runs/41251815134/job/124686737083) |
| `npm run test:e2e` | 18 tests passed in CI and locally across desktop/tablet/phone | [Browser job](https://github.com/larrinamsalva/LMS/actions/runs/41251815134/job/124686736973) |
| Dependency audit | Local `npm audit` and CI install reported zero known vulnerabilities at verification time | Registry result is time-dependent; license checks are separate |

CI uses Node 24, a network PostgreSQL **16.15** service and native PostgreSQL **16.15** dump/restore tools. Native tests ran in CI, not against a local embedded substitute; missing native prerequisites cause failure rather than silent skipping. Local checks also passed on Node 24.22.1 with installed Chromium 153.0.8010.0. Phone/tablet schedule screenshots were visually inspected for readable layouts and overflow.

## Behavior exercised

- Both industries create customers, linked work, resources and appointments with the same engine. Browser tests also reschedule, reject a conflicting booking, archive/view history and change the display zone without changing stored instants.
- Native constraints reject foreign customer/work/site/resource references, viewer writes, projection/receipt/audit mutation, invalid ranges, zones and local dates. Concurrent engine and raw-SQL booking attempts admit one reservation; adjacent intervals and separate resources succeed.
- A frozen REPEATABLE READ transaction fails after a competing commit. A resource-archive/booking race cannot leave a new appointment linked to an archived resource. Idempotent retries do not duplicate records/audits; altered retries, another actor and stale revisions fail.
- Completed reservations, cancellation, archive and conflicting restore/reactivation follow the documented interval policy. Active links prevent target archive; scheduled work retains its customer/site history. Configuration-zone revisions preserve stored appointment instants.
- Migration 6 → 7 refuses an active runtime lease, then succeeds with hosts stopped while preserving existing configuration/record/audit content. Existing migrations remain unchanged. Native backup/restore retains appointment links and operation receipts; connection to the restored database remains activation-blocked.
- Unit/browser checks reject spring-forward gaps and require explicit autumn occurrence selection, retain the saved occurrence on ordinary edits, and exercise responsive layout and automated accessibility in existing light/dark themes.

The other 74 native tests retain PostgreSQL persistence/restart/isolation, local authentication/session, owner access, credential change/recovery, external lineage and trusted checkpoint-publication coverage. No security control was disabled to obtain a passing run.

## Limits of this evidence

Tests use disposable fictional records and trusted fixture principals; they do not establish public identity/session acceptance. DST checks target supported current zones/dates and explicit instants, not every possible timezone-data release. No production deployment/database/account, external messaging, payments, recurring calendar or AI service is involved. The [contract](shared-scheduling.md) states data preservation, retry semantics, current limits and remaining gates.

The agenda supports one exclusive resource, minute precision, a maximum 24 elapsed hours and local dates 2020–2100. Browser device emulation and axe checks do not certify every real device, assistive technology or manual keyboard workflow. Staff/crew availability and multi-resource scheduling require the next phase. Persistent-business HTTP access and recovery activation remain blocked pending their separate reviews.
