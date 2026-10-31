# Account lifecycle verification evidence

This is a host-only fictional-account phase. No lost-access reset tool, public auth/business route, production account or deployment is enabled.

Coverage:

- Strict confirmation, UUID and password bounds; unknown user/session/role/revocation fields rejected.
- Upgrade migration 3 → 4 preserves existing records/configuration/history; historical SQL remains unchanged.
- Real Better Auth current-password verification and configured hashing; changed password works and old password fails.
- All subject sessions and pending membership reviews invalidated; unrelated identities, business memberships, configuration revisions and audits retained.
- Incorrect credentials, forged/demo identity, unavailable reset/delete endpoints and direct event-table tampering rejected.
- Recent live session required; expired/revoked sessions and expiration during a lock wait fail closed.
- Cross-host competing credential changes apply once; both sign-in/change race orders are tested using observed database locks.
- Owner confirmation versus credential revocation has a defined order; old-session and operation-UUID replay fail.
- Synthetic audit failure rolls password/session/review changes back together; atomic per-account attempts are shared across hosts.
- Owner SQL rejects stale authentication and rechecks recent age after an organization wait; last-owner and organization boundaries rerun.
- Native backup after a password change restores the new credential, immutable events and original business history without sessions or approvals; fresh authenticated operations are verified afterward.
- Existing storage/authentication/owner-access regression suites and desktop/phone themes/accessibility/HTTP boundaries rerun.

Local `npm run check` passed with **19** unit/embedded-SQL tests, type checking, production build and **186** dependency declarations. Embedded migration-4 SQL/audit smoke passed. All **8** desktop/phone browser tests passed with installed Chromium **153.0.8010.0**, including light/dark accessibility and absent password/reset routes. `npm audit`, including development dependencies, reports **0** known vulnerabilities. The **42** real PostgreSQL checks (13 lifecycle + 29 previous) are pending CI execution. Real network PostgreSQL/native tools are unavailable in this local workspace; the disposable CI service is required. Never infer network lock behavior from PGlite.

Recovery is a [future implementation with explicit acceptance criteria](local-recovery-plan.md), not a verified reset procedure. Old-backup credential rollback, account recovery/MFA, public transport and general business-write session fencing remain unresolved gates.
