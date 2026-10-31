# Shared scheduling verification

PR #10 adds fictional customer/work relationships and exclusive-resource scheduling through the existing engine. It does not enable production endpoints or recovery activation.

Local checks so far: 55 unit/embedded-SQL tests, production build/type checking, and all 18 browser tests passed on desktop, tablet and phone. Browser coverage includes both industries, conflict refusal, rescheduling, archive/history, business-zone changes, DST gap/fold behavior, keyboard/accessibility and light/dark regressions. Phone/tablet schedule screenshots were visually inspected. Native PostgreSQL and final CI results will be recorded from actual logs before review readiness; they are required and never silently skipped.

New native cases exercise both workflows, authorization/projection protection, foreign relationships, malformed ranges/zones/dates, competing bookings, direct SQL and stale REPEATABLE READ writers, archive/booking races, duplicate/replayed/stale commands, retained histories, display-zone changes, safe migration-6 upgrade and backup/restore with activation blocked. Existing authentication, owner access, credential lifecycle/recovery, lineage and checkpoint-publication suites remain part of the checks.

Tests use disposable fictional records and trusted fixture principals; they do not establish public identity/session acceptance. DST checks target supported current zones/dates and explicit instants, not every possible timezone-data release. No production deployment/database/account, external messaging, payments, recurring calendar or AI service is involved. The [contract](shared-scheduling.md) states data preservation, retry semantics, current limits and remaining gates.
