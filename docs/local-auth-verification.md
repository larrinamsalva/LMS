# Local identity verification evidence

This record distinguishes local checks from real network PostgreSQL execution. No service is deployed and the public application has no identity or persistent-business endpoint.

Implemented checks:

- Existing unit/embedded-SQL tests plus strict identity configuration/fictional account validation.
- Real Better Auth sign-in and maintained password hashing; cookie-only output and verified UUID principal.
- Wrong/unknown credentials, cookie tampering, demo-cookie/forged-header rejection and no self sign-up/recovery endpoints.
- Exact origin, Fetch Metadata, streamed byte/content-type limits and strict fields.
- Single/other/all session revocation, absolute expiry, secret change and fresh database validation.
- Independent auth process session persistence and separate current business membership authorization.
- Database-backed shared limiter, including concurrent attempts and forged forwarding headers.
- Identity/business credential separation, forced RLS and HTTPS Secure cookie attributes.
- Native backup/restore preserves accounts and business history while invalidating captured sessions/verification tokens.
- PR #2 network regression tests and existing desktop/phone light/dark/accessibility/browser boundaries.

Local results: `npm run check` passed with **16** unit/embedded-SQL tests, type checking, production build and **186** dependency declarations verified. All **8** desktop/phone browser tests passed using installed Chromium 153.0.8010.0. **All 18 real PostgreSQL integration tests passed** (9 identity/session checks and 9 prior persistence/concurrency/recovery checks) on PostgreSQL 16.15 with native client tools 16.15. The implementation CI passed foundation, browser and postgres jobs: [verified run](https://github.com/larrinamsalva/LMS/actions/runs/41236073132). This includes successful existing-database migration 1 → 2, independent process session persistence, shared concurrent throttling, role isolation and native account restoration without reviving old sessions. The local runtime has no usable Docker/PostgreSQL server; real PostgreSQL and native dump/restore checks run in the dedicated GitHub CI service. HTTPS cookie attribute tests do not establish a real TLS deployment. No mailbox verification, MFA, account recovery, public network limiter, in-flight transaction revocation or production acceptance is claimed.
