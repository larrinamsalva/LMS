# Owner access verification evidence

This phase is a host-only fictional-account experiment. Nothing is deployed and the demo has no identity or persistent-business route.

Checks added:

- Strict role/review/bootstrap schemas; missing confirmation, owner escalation and forged identity fields rejected; no database call without a fresh session resolver result.
- Existing version-2 database upgrades to migration 3 without rewriting a record, configuration or membership.
- Transactional fictional workspace bootstrap; operator-only credentials, provisioned identity requirement and idempotent retries, including after ownership handover.
- Owner-only, organization-scoped rosters; admin/staff/viewer/foreign owners rejected, raw membership/private-table/audit access and identity-service business access denied.
- Preparation has no permission effect; explicit confirmation changes actual Engine/RLS permissions and appends a credential-free audit.
- Removal preserves the identity's other organization; ordinary self-demotion/owner removal is rejected; atomic handover retains exactly one owner.
- Concurrent duplicate confirmations apply once; competing reviews reject stale revisions without extra audits.
- Wrong actor/session, expired reviews, revoked/expired/mismatched database sessions and cached host identities rejected; sign-out removes pending approvals.
- An observed database lock race establishes access commit versus session deletion ordering.
- Native backup/restore retains records, confirmed roles/receipts/audits; sessions/pending reviews stay empty, old approvals fail and a fresh authorized change succeeds.
- Existing PostgreSQL persistence/concurrency/migration-failure/native recovery tests and desktop/phone demo/accessibility checks rerun. Access HTTP paths remain absent.

Local `npm run check` passed: **18** unit/embedded-SQL tests, type checking, production build and **186** dependency license declarations. All **8** desktop/phone browser tests passed using installed Chromium **153.0.8010.0**, including light/dark accessibility and absent access routes. Real PostgreSQL CI results are pending; this is not yet a network verification claim. Real network PostgreSQL/native tools are unavailable in this local workspace; CI's disposable PostgreSQL service is required. Embedded SQL checks are not a substitute for network lock/restore verification.

No account recovery/MFA, mailbox verification, public session transport, general record-write session fence or production certification is claimed. See [the contract and remaining gates](owner-access.md).
