# Controlled local recovery: design for the next phase

**Design only.** PR #5 implements password changes for an authenticated user who knows the current password. It deliberately ships no lost-password reset/recovery tool. There are no verified email addresses, recovery codes, trusted contact delivery, recovery MFA or public reset endpoint. An email address, organization selection, possession of a demo cookie or knowledge of a user UUID is not identity evidence.

A lost-access identity currently stays locked until a separately reviewed recovery implementation is accepted. Do not work around this by editing a password hash, enabling Better Auth's reset routes, adopting an existing organization through bootstrap, deleting an owner, or granting a replacement account membership manually. `auth:revoke-all` can end known fictional sessions as existing trusted local maintenance; it is containment, not password recovery or a complete recovery audit.

## Proposed offline procedure

| Step | Required control | Evidence to retain privately |
| --- | --- | --- |
| Contain | Stop all identity/business hosts and keep the restored/affected database offline. Take a protected native backup and verify the target is a local fictional database. No production services or accounts. | Case UUID, database name, migration versions, backup receipt and containment time; no secrets |
| Verify claimant | A previously established operator independently checks the original provisioning/ownership record and reliable offline evidence. Never use the unverified email as proof. Sole-owner recovery needs a second independently verified approval or an already established recovery factor. If reliable evidence is missing, refuse recovery. | Subject UUID, operator/approver identities and references to verification evidence; no identity-document copies or recovery secrets in SQL logs |
| Review | Prepare an expiring one-use recovery case tied to the exact subject, credential version and operation UUID. Show effect: credential replacement, every session/approval revoked, roles unchanged. Require explicit confirmation. | Immutable preparation, approval, expiry and outcome records |
| Apply | A future guarded maintenance command uses separate checked administrator credentials on the confirmed local target. It rechecks the case/version after locks, uses Better Auth hashing, revokes all subject sessions and pending approvals, changes credentials and appends a recovery audit atomically. No membership/config/history rewrite. | Subject/operator/approver UUIDs, operation/case IDs, action and server timestamps; no passwords, hashes, tokens or session IDs |
| Accept | Deliver the replacement secret through a private local interaction. Perform a new sign-in and recent-auth check, verify original memberships and history, test old credentials/sessions/replay rejection and cross-organization denial. Continue using the existing owner handover flow if an owner later elects to transfer. | Verified local test outcomes and final operator acknowledgement; never “recovered” before verification |

These controls are proposed requirements, not an implemented permission bypass. Do not create a recovery case by raw SQL or place passwords in command arguments. Operator authority needs its own reviewed authentication/evidence model; being a business admin must not automatically allow resetting another identity shared by multiple organizations.

## Acceptance before implementation can be enabled

- Explicit local-only targets and trusted operator verification; no unverified-mailbox or organization-admin reset authority.
- Audited case preparation/approval/completion/rejection; secret-free append-only records, one-use expiry and subject/credential-version binding.
- Atomic password/session/review changes with failure rollback; no implicit new session, role changes or sole-owner deletion.
- Concurrent password change/recovery, sign-in/recovery, revocation/recovery and duplicate/stale case tests across hosts.
- Backup/restore testing that addresses **older credential snapshots**, signing-key/role recovery, encryption, retention and off-device evidence. Session invalidation alone does not prevent old-password rollback.
- Evidence that original memberships, configuration revisions and business audits survive and other users/organizations remain unaffected.
- A private fictional-data rehearsal using the actual command. Public identity verification, TLS/proxy controls, MFA and production recovery remain separately gated.

Until that follow-up is merged and verified, only the [current-password change contract](account-lifecycle.md) is executable.
