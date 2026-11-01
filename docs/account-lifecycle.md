# Experimental account lifecycle: password changes and recent sign-in

This phase implements a **host-only**, self-service password change for provisioned fictional accounts. It adds no public reset/authentication or deletion endpoint. The later [controlled offline reset](offline-recovery.md) is a separate administrator boundary with activation blocked. The separate no-login demo remains temporary and uses shared business migrations 1, 7, 8 and 9 only. The [offline recovery phase](offline-recovery.md) now implements the guarded reset subset; activation remains blocked.

## Setup and host contract

Complete [local identity setup](local-auth.md), back up, rehearse on a separate database, then apply reviewed migrations with `npm run db:migrate -- --database lms_development`. Migration 4 preserves existing identities, sessions, memberships, configurations and audits. It adds immutable credential events and a shared five-minute recent-session check used by owner commands and password changes. Existing sessions older than five minutes can still be validated, but cannot manage owner access or change credentials; sign in again. Migration SQL does not rewrite their timestamps.

`createLocalAuth(options)` now also returns:

```ts
await auth.changePassword(signedCookieHeaders, {
  operationId: newOperationUuid,
  currentPassword: currentSecret,
  newPassword: replacementSecret,
  confirmation: "CHANGE PASSWORD AND SIGN OUT"
});
// { success: true, signInRequired: true, operationId }
```

All names above represent private server values. Present the effect and obtain explicit confirmation before calling. Password input belongs in a private local interface, never command-line arguments, URLs, logs, committed fixtures, analytics or a public endpoint. There is no password-change CLI/UI in this PR. The unchanged host `handle` allowlist rejects `/change-password`, `/verify-password`, reset, set-password and delete-account paths. The Next.js app exposes none of them.

Input is strict: operation UUID, current password of 1–128 characters, a different new password of 15–128 characters, and the exact confirmation. No target user, email, session, role or revocation toggle is accepted. Cookie credentials are captured once at method entry, before any asynchronous work. Only that signed cookie chooses the account; forged headers/demo cookies do not authenticate. The account must have exactly one local credential record and an `@example.test` identity. It need not have a business membership to change its own password. Storage/hash failures propagate, not success. Validation uses Zod errors; invalid/expired/revoked/stale sessions or incorrect current credentials yield EngineError 401, ineligible accounts 403, changed credentials/reused operation IDs 409 and exceeded attempt budget 429. Future HTTP adapters must sanitize errors and independently enforce origin, CSRF, byte limits and cookie scope.

Better Auth 1.7.14 still owns session/cookie validation, current-password verification (`auth.api.verifyPassword`) and password hashing through its configured password context. LMS adds transaction coordination and strict local policy, not another password algorithm or identity provider. The built-in password-change/reset endpoints are not exposed as alternate paths around this contract. There are no new dependencies or external services.

## Atomic credential update and revocation

1. Resolve a fresh database-backed session through the existing identity host. Consume one shared per-account attempt, even for an incorrect password. Read a private expected credential snapshot, verify the current password through Better Auth, and compute the replacement hash through the same configured implementation.
2. On a dedicated bounded coordinator connection, lock that exact credential row with a compare-and-swap check. A competing update cannot silently overwrite a committed password.
3. Lock and recheck the matching live session and its recent-sign-in age **after** any wait. Sessions dated in the future, expired, revoked or at least five minutes old fail closed. Correct current-password verification does not renew this age.
4. In one transaction, revoke **all** sessions for the account, including the current one, cascade its pending membership approvals, update the password and append a credential event. A reused operation UUID or failed audit rolls all these changes back. Unrelated users' sessions and all organization memberships/history remain intact.

Successful change issues no replacement session, cookie, token or secret. Sign in again with the new password before doing anything sensitive. The old cookie can remain in a private caller's cookie jar, but resolves to no session. An old-session replay is rejected; reusing a committed operation UUID after a fresh sign-in is rejected without changing the password or revoking that new session. Never automatically retry after an uncertain commit result: sign in and inspect the operation event through trusted maintenance first. Operation replay protection covers the history present in the database, not an arbitrarily older restored snapshot.

Sign-in holds a credential SHARE lock while Better Auth verifies and creates a session. Password change takes UPDATE on the same row. If sign-in finishes first, its session is included in revocation; if the password change goes first, an old-password sign-in must verify against the new hash and fail. This coordination applies to supported LMS hosts; do not run an independent, unfenced auth instance against the same tables.

Each host uses the existing identity pool (maximum 3) plus a separate coordinator pool (maximum 1). Reserving that connection avoids lock waiters exhausting the pool needed to finish an authentication call. This conservative local throughput is not a public service capacity design. The existing global five-sign-ins/minute limit remains. Password changes add a separate atomic five-attempts/minute budget per verified account using the existing PostgreSQL rate-limit table; it is shared across hosts, counts incorrect credentials and ignores caller IP/identity headers. No permanent account lockout is introduced.

## Recent authentication for owner access

All owner roster, preparation and confirmation commands now require a live session created within five minutes. The existing SQL helper delegates to the same recent-session rule, retaining its database locks and role/revision checks. It rechecks after waiting for an organization lock, so freshness cannot expire in a queue and still authorize a change. Timestamps are database/session evidence, never client input. To resume, sign in again and prepare a new review; a review bound to an old session cannot transfer to the new one.

Ownership handover still requires the sole owner and an existing member, atomically retains one owner, and makes the previous owner admin. Password changes cannot alter roles, remove an owner or adopt an organization. Account deletion and administrative reset remain unavailable. Ordinary sign-out/session revocation stays available for containment even when a sign-in is no longer recent. Existing ordinary record/config commands still lack transactional session fencing; this phase does not open persistent-business endpoints.

An already-authorized owner command can finish while credential revocation waits on its session lock. Revocation cannot undo committed actions. If revocation commits first, later access/password commands fail. These are commit-order semantics, not cancellation of work already in progress.

## Audit, backup and limits

Migration 4's `lms_identity.credential_events` stores only event UUID, optional operation UUID, subject UUID, action and server timestamp. It contains no password/hash, token, session UUID or organization data. A narrow private audit trigger with empty search path records actual password mutations in the same transaction. Direct trusted maintenance updates also produce an event (operation UUID can be absent); that event alone does not prove the maintenance was authorized. Application/business roles cannot read the table. The identity service can read events but cannot insert, update or delete them directly. The administrator remains trusted. Failed attempts are counted by throttling, not retained as a complete incident audit.

Native backups retain changed credentials and credential events, while excluding live sessions, verification data and pending access reviews. Guarded restore invalidates sessions/approvals and requires fresh sign-in. Tests restore a backup **taken after** the change, verify the new password and history, reject a replay and make a further authorized change.

An older backup necessarily restores older password hashes and event history. Do not attach a host to it merely because session tables are empty: it can re-enable an old password and lose later operation IDs. Keep recovery offline until credential/secret rotation and independent identity checks have an accepted, tested procedure. This PR does not claim protection against credential rollback through arbitrary old backups, administrator compromise, MFA bypass, public TLS/proxy/session security or complete disaster recovery.

See [verification evidence](account-lifecycle-verification.md), [recovery design and next phase](local-recovery-plan.md) and [security boundaries](../SECURITY.md).

PR #6 tightens restore acceptance: normal authentication and persistent runtime attachment are now blocked after any supported restore, including an old archive. Earlier sign-in-after-restore verification is historical; current tests inspect restored credentials/data offline and assert refusal to activate. See [current recovery evidence](offline-recovery-verification.md).


PR #7 adds a [metadata lineage and external checkpoint foundation](credential-lineage.md). Credential changes now append version/event metadata in the same transaction; failed appends fail the change. Keyed commitments can detect changed credential material without exporting hashes. This does not authorize restored sign-in: assessment is offline/read-only and all activation blockers remain.
