# Security policy and current boundaries

Version 0.1 is an experimental fictional-data demo. Do not use it for real businesses until the [roadmap acceptance gates](ROADMAP.md) are satisfied. Report a suspected vulnerability privately through GitHub Security Advisories if enabled for this repository; otherwise contact the maintainer privately. Do not post secrets or personal data in public issues. No support-response SLA is offered.

## Verified design boundaries

- Every business table enables and forces PostgreSQL RLS. The ordinary `lms_app` role is not the owner, superuser or a BYPASSRLS role. Direct database tests cover organization isolation, insert/update rejection, scope reassignment, viewer/staff permissions and append-only history.
- Membership rows, not UI choices or user-editable profile metadata, authorize access. Membership/user/organization provisioning is trusted host code only. The demo issues a random opaque 256-bit HttpOnly, SameSite=Strict cookie, scoped to its server-created fictional organizations; HTTPS gets Secure cookies.
- Each service transaction sets a validated identity locally, switches to `lms_app`, checks role and uses parameterized SQL. End users must never receive raw SQL access or host credentials. `lms.user_id` is a trusted-server assertion, not a client authentication mechanism; a future identity adapter must verify the user before constructing a Principal.
- All mutations check origin and strict allowlisted input. Request size is measured on streamed bytes (64 KiB for demo), with content-type and UTF-8 checks. Module/entity/field keys and values are validated; no eval, raw HTML rendering, dynamic SQL identifiers or uploaded executable modules.
- Request-scoped script CSP nonces protect the page. Development allows unsafe-eval for Next.js debugging; production does not. Inline styles remain allowed for framework compatibility. No third-party scripts, analytics or remote fonts are loaded.
- Ordinary sessions cannot delete records or alter/delete audit/config history. Record identity is immutable. The only SECURITY DEFINER function is a narrow private audit trigger with empty search_path and revoked public execution; it snapshots the just-authorized row. Audit access is owner/admin only.
- Configuration changes and record edits serialize on an organization lock; expected revisions reject stale writes. Disabling a module preserves rows. Populated schemas cannot be destructively changed by the configuration API.
- Finance, live invoices, messaging, AI and payment routes/providers are absent. Generic JSON records are not financial ledgers. New external/sensitive actions need a reviewed permission + explicit confirmation transaction; hiding controls or a browser checkbox is insufficient.

## Known limits / acceptance gates

The demo database and sessions are process memory. Restart clears them; expiry removes access and later demo starts prune expired data. There is no real web authentication, persistent business endpoint, disaster-recovery guarantee, document object store, virus scanning, brute-force protection, per-IP rate limit, multi-process demo coordination or public service availability guarantee. A separate experimental host-only PostgreSQL adapter provides durable storage; it is never selected by the public demo. A global cap bounds session/record/revision growth; it is not a complete denial-of-service defense. Do not expose the runtime’s database API directly or use a serverless/horizontal deployment as-is.

No role should have access to another organization's rows, even with a forged organization ID. Staff in this first slice can access all operational records in their organization; per-crew/per-property assignment permissions are deferred. Field-level secrecy and complex record relationships are not supplied by custom JSON. Backups need identity/secrets, configuration, database and object bytes plus a tested restore; workspace JSON alone is not a backup or import format guarantee.

PGlite executes real PostgreSQL policies but does not test network PostgreSQL concurrency, Supabase Auth/PostgREST/Storage, hosted settings or production deployment. Source installs keep dependency licenses; redistribution of bundled platform binaries requires a separate LGPL/source/relinking review. No deployment or security certification is claimed.

## Experimental PostgreSQL storage

The runtime adapter refuses administrator/schema-owner/database-owner credentials, elevated attributes, INHERIT logins and unexpected role memberships. Pools are bounded and transactions retain one checked-out connection. Identity is trusted host input; RLS does not authenticate a caller. Arbitrary SQL/database credentials must never reach a browser, and no persistent-business endpoint is enabled in this phase. The existing engine limits (250 records/40 config revisions) still apply to this experimental adapter.

Migration/initialization commands require an explicitly named local fictional database and separate administrator credentials. Migration history is checksum-checked and transactional. Unknown/untracked schemas are not silently adopted. Native backup/restore commands use private new files, refuse populated restore targets and restore in one transaction; only trusted archives may be used. Full production recovery still needs tested cluster-role/credential recovery, identity revocation, encryption/retention/off-device copies, future object storage and operational procedures. Remote TLS hosting, failover, database server crashes and committed-but-unacknowledged writes remain unverified. Do not automatically retry a write whose commit result is uncertain; operation idempotency requires a later reviewed contract.

Network tests use disposable, fictional PostgreSQL databases in CI. Local public-demo checks do not establish persistent backend acceptance. See [the separate evidence record](docs/postgres-verification.md). No production connection, deployment or real-business authorization is implied.

## Local identity foundation

The new identity host is not mounted in Next.js and cannot enable itself from environment variables. Provisioning is trusted maintenance for @example.test identities; it grants no business membership. Better Auth handles hashing/cookie signing; session caches and sliding renewal are disabled. The unmounted wrapper exposes a strict allowlist, exact origins, bounded JSON, token-free JSON and distinct HttpOnly/SameSite cookies. A shared database-backed local sign-in limit ignores caller forwarding headers; public proxy/per-account/rate-limit design is still a gate.

Identity service credentials have a private schema and cannot read business records; business credentials cannot read identity records. Session tokens in that database and password hashes are credential-sensitive. Native backups exclude session/verification data; guarded restores purge it before success. Offline restore and re-authentication are required. Do not revive old sessions by attaching a host to a raw/manual restored archive.

Fresh validation rejects later requests after expiry/revocation, not in-flight operations. No verified mailbox ownership, recovery/MFA, membership UI, public login, HTTP deployment, transactional session fencing or complete disaster recovery is claimed. See the [identity contract](docs/local-auth.md) and [verification evidence](docs/local-auth-verification.md) before any integration.
