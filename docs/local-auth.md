# Experimental local identity and revocable sessions

This is the next **host-only foundation**, not a public login launch. Better Auth 1.7.14 supplies password hashing, signed opaque session cookies, session management and database throttling. Its PostgreSQL adapter is configured with transactions, an explicitly qualified private schema, pinned dependencies and telemetry disabled. No cloud provider, email sender, payment/AI service or subscription is needed.

The Next.js website remains the no-login fictional demo. There are **no `/api/local-auth/*` or persistent-business routes**, login page, public sign-up, password-reset delivery or role-administration UI. Merely setting identity environment variables cannot expose this host adapter. Do not mount it publicly as-is.

## Local setup and provisioning

1. Complete the [PostgreSQL setup](postgres-setup.md) using fictional local data.
2. Copy `.env.local-auth.example` to `.env.local-auth`, keep it private and replace every placeholder. Generate a NEW identity database password and a separate random authentication secret with at least 32 random bytes (for example `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`). Do not reuse business-runtime or administrator credentials.
3. Run `npm run auth:init -- --database lms_development`. This explicitly applies reviewed migrations, including identity and owner access, creates/verifies the separate runtime login and verifies connectivity; it never starts an HTTP server or resets existing passwords.
4. To provision a synthetic account, provide JSON on standard input to `npm run auth:provision -- --database lms_development`: `{ "name": "Fictional owner", "email": "owner@example.test", "password": "a long fictional password" }`. Use a private local input file, not password command-line arguments or committed fixtures. Only `@example.test` addresses and passwords of 15–128 characters are accepted. Output contains only the new UUID. Remove temporary credential input after use.
5. `npm run auth:revoke-all -- --database lms_development --user UUID` is trusted local maintenance that ends that synthetic identity's sessions. It requires the separate administrator. Normal session sign-out/revocation is provided by the host handler.

Provisioning uses Better Auth's server API with automatic sign-in disabled. Public sign-up is disabled and excluded from the wrapper allowlist. Provisioning creates **no business user, organization membership or role**. The separate [owner access phase](owner-access.md) can bootstrap a new fictional workspace and review membership changes; user-supplied role/identity fields are rejected. Email is only a login name in this phase: no mailbox ownership verification or delivery is claimed.

## Host contract

`createLocalAuth(options)` in `src/server/auth/host.ts` accepts explicit local database URL/name, exact loopback origin and a private generated secret. It returns:

| Method | Contract |
| --- | --- |
| `handle(Request)` | An **unmounted** standard Request/Response auth handler; only POST sign-in/email, sign-out, revoke-sessions, revoke-other-sessions and GET get-session are allowed |
| `principal(Headers)` | Validate only the signed auth cookie against the current database session, bypass all cookie caches, and return `{userId: UUID}` or null; database failure throws |
| `identity(Headers)` | Fresh signed-cookie/database validation returning `{userId, sessionId}` or null for internal session-fenced commands; never accept either field from a client |
| `close()` | Close the identity pool during host shutdown |

Every host operation must revalidate a session; do not retain/reuse a Principal across requests. A valid identity is not an organization permission: the unchanged engine and SQL memberships/RLS authorize business records separately. No current web route accepts a Principal, forwarded user ID or bearer token to access persistent data.

The wrapper requires exact Origin for POST, rejects foreign Origin/Fetch Metadata, bounds streamed JSON to 8 KiB, accepts strict fields and no callback URL, rejects unsupported paths/query parameters and adds private/no-store responses. Tokens are stripped from response JSON; only the library's HttpOnly, SameSite=Strict cookie carries a token, with a distinct `lms_local_auth` prefix and `/api/local-auth` path. HTTPS configuration adds Secure; loopback HTTP testing cannot prove real hosted TLS. The path must be reviewed if a future authenticated UI needs a different cookie scope. There is no wildcard cookie domain, OAuth, bearer plugin, localStorage credential or JWT cache.

Sessions have an absolute two-hour lifetime without sliding renewal. Each validation queries PostgreSQL, so expired, signed-out, revoked or restored old sessions fail the next check. The owner access commands now lock a live session to order confirmation against deletion; ordinary record/config operations still lack that fence. Revocation does not undo committed operations. Secret rotation invalidates existing cookie signatures; no managed key-rotation service is implemented.

The conservative local limiter uses a **single fixed host bucket**, stored in PostgreSQL: at most five sign-in attempts per minute and a bounded general window. The wrapper strips client-supplied IP/forwarding headers before assigning that bucket; changing a header cannot evade it. This is intentionally unsuitable for a public multi-user service: trusted proxy/transport identity, per-account protections, capacity and denial-of-service design remain unverified. Throttle storage persists across host instances. There is no permanent account lockout.

## Database and recovery boundaries

Migration 2 creates `lms_identity` user/session/account/verification/rate-limit tables with explicit grants and forced RLS. The NOLOGIN `lms_auth_service` role is the trusted identity service and can manage all identity rows, but has no business/schema-administration access. The separate NOINHERIT `lms_auth_runtime` login can assume only that service role. Business runtime credentials cannot read identity rows. Neither runtime owns schemas/databases or may have elevated attributes or unexpected memberships. Identity storage is global to the local host, not an organization business table; its full-service policy is deliberately restricted to the identity service role.

Database session tokens and password hashes are credential-sensitive. Preserve least privilege, protect/encrypt backups and treat a compromised identity service/database administrator as a security incident. No claim is made that opaque tokens are hashed in storage.

The native backup helper excludes session, verification and pending membership-review **data** while retaining their tables/policies and account/password data. The guarded restore helper also purges those rows after restoring a trusted archive, including manual/older archives, before reporting success. Re-authentication is required after recovery. Restore only into a separate offline database and do not attach a host until the entire recovery check passes; arbitrary dumps contain executable SQL. Role credentials, secret recovery, encryption/retention and off-device backup acceptance remain separate gates. The manual Docker pg_dump recipe must use the same exclusions; a raw pg_restore alone does not perform LMS's post-restore invalidation.

## Verification and next step

`npm run test:postgres` runs actual PostgreSQL tests for sign-in, invalid credentials, signed-cookie tampering, CSRF/body limits, expiry, revocation, independent-process persistence, membership revocation, role isolation, shared throttling, Secure cookie configuration and restored-session invalidation. It also reruns all PR #2 persistence/concurrency/migration/recovery tests. Existing local checks and browser tests verify that the public demo remains available without login and auth/business paths remain absent.

See [the evidence record](local-auth-verification.md). Follow the [owner membership phase](owner-access.md) with account lifecycle/recovery/MFA, trusted HTTP/session boundaries, general business-write session fencing and complete recovery acceptance before enabling real persistent business endpoints. No deployment, production database, outbound message or ForgeOS change is authorized by this phase.
