# Offline recovery verification evidence

The deliverable is an offline credential reset with signed reviews and an enforced activation blocker, not a public recovery or reactivated service.

Coverage:

- Private trust file ownership/permissions, symlink rejection, unique people/keys, Ed25519 signatures, wrong subject/message/operator and unverified-email/boolean authority rejection.
- Prior trust registration/cooling-off and correct established evidence; idle identity and persistent runtimes block maintenance.
- Sole-owner recovery needs two independent signatures; all original business bytes and unrelated sessions survive while subject sessions/pending membership approvals are revoked.
- Forgery, cross-case/stage replay, absent/self approval, expired case/approval (including expiry during deliberately delayed credential mutation), duplicate recovery, competing cases and concurrent recovery rejection.
- Online password-change races are excluded; changed credential or membership versions invalidate approved cases.
- Synthetic audit failure rolls password/session/review/case changes back together; completion/rejection history is secret-free and unavailable to ordinary roles.
- Old/new native backups retain their credential/history bytes but cannot activate; cases are purged, old proofs cannot replay, and a pre-migration-5 archive stays blocked after upgrade.
- A synthetic post-restore cleanup failure leaves a durable database-catalog blocker; a session-local setting cannot bypass it.
- The actual CLI verifies a fictional password privately without emitting it or creating a session.
- Existing PostgreSQL storage/auth/owner/password regressions rerun; restore tests now inspect data/RLS offline and assert refused attachment/blocked writes, replacing earlier activation acceptance.
- Desktop/phone no-login demo, light/dark accessibility and absent recovery HTTP paths rerun.

Local `npm run check` passed **22** unit/embedded-SQL tests, type checking, production build and **186** license declarations. Migration-5 SQL/version/runtime-blocker smoke passed. All **8** desktop/phone browser tests passed with installed Chromium **153.0.8010.0**; `npm audit` reports **0** known vulnerabilities, including development dependencies. All **57** PostgreSQL integration tests passed: **14** recovery checks plus **43** prior regressions, on PostgreSQL **16.15** with native client tools **16.15**. Foundation, browser and postgres jobs all passed in the [source verification run](https://github.com/larrinamsalva/LMS/actions/runs/41243728560). This includes independent signatures, current-password reuse rejection, final expiry rollback during a two-second synthetic delay, successful old/new/legacy native restores and fail-closed quarantine after cleanup failure. Real network PostgreSQL/native tools are not available in this local workspace; CI's disposable service is required. Embedded SQL is not concurrency proof.

No real identity evidence or keys are used by tests. Fictional fixture administrators backdate a trust receipt to test the 24-hour boundary; the actual command has no clock/unblock bypass. No production account, ForgeOS change, deployment, public endpoint, reactivation or general disaster-recovery certification is claimed.
