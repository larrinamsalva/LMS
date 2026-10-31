# Experimental owner access management

This is a **host-only** addition to the existing Engine/PostgreSQL adapter. It gives provisioned fictional owners a narrow way to review and confirm membership changes. No login, roster, bootstrap or persistent-business route is mounted in Next.js. The no-login demo continues to load migration 1 in its separate temporary PGlite database.

## Create a fictional owner workspace

1. Complete [PostgreSQL setup](postgres-setup.md) and [local identity setup](local-auth.md), including provisioning an `@example.test` identity. Keep its returned UUID. No public self-signup or real mailbox verification is enabled.
2. Take a native backup, rehearse the upgrade separately, then run `npm run db:migrate -- --database lms_development`. Migration 3 backfills access revision zero for existing organizations; it changes no records, configurations or memberships. Historical SQL stays immutable.
3. Prepare private JSON such as `fictional-workspace.json`. Generate a new operation UUID with `node -e "console.log(require('node:crypto').randomUUID())"`. Replace the two UUID placeholders with the operation UUID and the provisioned owner UUID:

   ```json
   {
     "operationId": "REPLACE_WITH_NEW_OPERATION_UUID",
     "ownerId": "REPLACE_WITH_PROVISIONED_OWNER_UUID",
     "name": "Fictional property workspace",
     "preset": "property",
     "confirmation": "CREATE FICTIONAL WORKSPACE"
   }
   ```

4. Run `npm run access:bootstrap -- --database lms_development < fictional-workspace.json`. The separate local administrator creates an organization, owner membership, validated property/cleaning configuration, access revision and audits in one transaction. No business records are seeded. Unknown identities, missing confirmation and extra fields fail closed. The command refuses remote/unconfirmed targets and runtime credentials; it does not create databases or migrate implicitly.
5. Retain the operation UUID with the setup record. Repeating identical input returns the same organization without changing roles or duplicating audits. Reusing it with different input fails. A retry after a later handover never makes the first owner an owner again. Use a new UUID only when intentionally creating another workspace.

This command cannot adopt an existing organization or grant itself owner in one. There is no general administrator-backed role-edit endpoint. Existing organizations need a provisioned owner linked by trusted, separately reviewed maintenance; automatic adoption is refused. The operator/database administrator remains trusted and powerful.

## Host API

`AccessService` in `src/core/access.ts` accepts the existing `Engine` and `createLocalAuth(...).identity` as its session resolver. Each method resolves the cookie afresh, requires a sign-in within five minutes and uses `Engine.asUser`; it does not copy record/config business logic or accept a browser-provided principal/session ID.

| Method | Input | Result |
| --- | --- | --- |
| `snapshot(headers, organizationId)` | Fresh signed-cookie headers and organization UUID | Current access revision and that organization's member UUIDs, names and roles; owner only |
| `prepare(headers, change)` | Strict `{organizationId, targetUserId, action, revision, reason, role?}` | Five-minute review with target name, old/new role, actor role after change, revision and expiry; no membership change |
| `confirm(headers, confirmation)` | Strict `{reviewId, confirmation: "CONFIRM ACCESS CHANGE"}` | Durable receipt after the same owner/session confirms the stored review |

Actions are `set-role` (admin/staff/viewer only), `remove`, and `transfer`. A target must already have a provisioned fictional local credential identity before receiving access. Preparation requires a nonempty reason of 3–300 characters and the roster's current integer revision. Never put credentials or sensitive information in reasons: they are retained in audits. Unknown fields, owner escalation through set-role, self changes, ordinary owner removal, missing members for remove/handover, no-ops and non-fictional targets are rejected. Removal may remove an orphaned non-owner membership without a surviving identity account.

A trusted host can compose the adapters:

```ts
const database = await connectPostgres({ connectionString: privateBusinessUrl });
const engine = new Engine(database);
const auth = await createLocalAuth(privateAuthOptions);
const access = new AccessService(engine, auth.identity);
const roster = await access.snapshot(request.headers, organizationId);
const review = await access.prepare(request.headers, {
  organizationId, targetUserId, action: "set-role", role: "staff",
  revision: roster.revision, reason: "Fictional crew onboarding"
});
// Present review.targetName, previousRole, role, actorRoleAfter and expiresAt.
// Only a subsequent explicit owner decision may invoke confirm with review.reviewId.
// Close both adapters during host shutdown.
```

This is a server composition example, not an HTTP endpoint. Do not auto-confirm immediately after preparing, construct identities from JSON, or expose `asUser`, SQL, raw database credentials or the session resolver to a client. Validation errors are Zod errors; rejected session/role/change/stale review operations become EngineError 401/403/400/409 respectively. Unexpected storage failures propagate, never become success. A future HTTP layer must map errors safely and enforce exact origin/CSRF, body limits, secure cookie scope and fresh sessions. Current auth cookies remain scoped to `/api/local-auth`; they are not an established session transport for future business routes.

## Transaction and audit guarantees

Migration 3 adds forced-RLS access revisions/receipts and private reviews/bootstrap receipts. Raw application INSERT/UPDATE/DELETE on memberships, users, organizations, receipts and audits remains unavailable. Raw membership SELECT still exposes only the caller's rows. Only the narrow owner snapshot command can read a roster. Cross-organization and admin/staff/viewer attempts fail in PostgreSQL as well as the host layer. The identity service gains no business permissions.

Three private SECURITY DEFINER commands use fixed empty search paths and revoked PUBLIC execution. Public wrappers are SECURITY INVOKER. Helpers and private tables cannot be called/read by application roles. The commands independently verify the asserted actor against a live database session, hold that session FOR SHARE, lock the organization, and recheck owner/session authorization after waiting. The runtime remains trusted host code: the transaction GUC and internal session UUID are not client authentication credentials. Session IDs are omitted from business receipt queries, return values and audits.

Commands for an organization serialize. Every confirmed change increments a separate access revision and appends one audit with actor, target, reason and previous/resulting roles. Different prepared changes at the same revision cannot both apply. Confirmation of the same review by the same live session returns the stored receipt without applying twice; after an uncertain commit result, retry that exact confirmation. No general record-write idempotency is claimed. Another session, another actor, expired review or changed revision requires fresh review. A former owner may retrieve its known handover receipt while still a member, but cannot manage the roster or confirm any other pending change.

Handover requires exactly one current owner and an existing eligible member. One transaction promotes the target to owner and changes the previous owner to admin. There is no intermediate zero-owner state. Pre-existing organizations with multiple owners require reviewed operator remediation before handover; the migration does not silently rewrite historical permissions.

Session deletion and access commits have a defined order: if the command first locks a valid session, revocation waits until it finishes; if deletion commits first, the command is rejected. Authorization/expiry is rechecked after the organization lock. Revocation cannot undo an already committed action. Removing/demoting a member affects later database role checks without ending that identity's unrelated organization sessions. Existing ordinary record/config operations still lack this session fence; do not expose them publicly on the strength of these owner-command tests.

## Recovery and remaining gates

Native backups retain memberships, revisions, confirmed receipts, audits and bootstrap receipts, but exclude pending review, live session and verification data. Guarded restoration purges restored sessions and cascades pending approvals, including those in manual archives. Re-authenticate and create a new review after recovery; do not replay old approvals. Test restoration into an empty, offline database, verify records/roles/audits and perform a new authorized change before attaching any host.

Owners cannot issue email invitations, recover accounts, delete accounts or transfer to unverified real identities. There is no staff UI, MFA step-up, mailbox verification, support impersonation or public network session acceptance. Password loss by the sole owner remains locked pending the [reviewed recovery follow-up](local-recovery-plan.md); no reset tool is provided. Fresh sign-in is now required for owner commands; it is not MFA. Production recovery, per-account/proxy rate limits and in-flight fencing for general business operations remain gates. No external service, live operation or deployment is enabled.

See [test evidence](owner-access-verification.md), [security policy](../SECURITY.md) and [roadmap](../ROADMAP.md).
