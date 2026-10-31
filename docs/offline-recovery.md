# Controlled offline recovery for fictional accounts

This is local maintenance for provisioned `@example.test` accounts. It replaces a lost credential only after two independent enrolled operators sign an expiring review. No reset/login endpoint, production account or deployment is enabled.

**Activation remains blocked after opening a recovery case, after completion and after every supported restore.** This PR can verify a replacement password offline; it cannot safely prove rollback resistance against every older backup. There is no activation override or unblock command. Normal authentication and persistent adapter startup refuse the blocked database. Do not remove the marker or change the flag manually. A separately reviewed external credential-lineage/recovery acceptance phase is required before reactivation.

## Trust and independent identity checks

The trust boundary includes the local database administrator, the owner of the private trust registry, and independently verified operators with separately held Ed25519 keys. Software verifies their signatures and registry bindings; it cannot verify physical identity facts or prove that two keys belong to two different humans. Enrollment governance must establish that independence. Database administrators can bypass database controls; compromised administrators/operators are outside this guarantee.

Before access is lost, a trusted registrar must independently establish operator identities/key custody and subject evidence through trusted offline channels. The registry records operator/person UUIDs, public keys/capabilities and evidence UUIDs, subject UUIDs, kind, establishment date and a SHA-256 reference to a previously established private record. Actual documents, personal details, private keys, passwords and recovery secrets do not belong in the registry, case or audit. An email address, account name, claimed membership, checkbox or new evidence supplied by a locked-out claimant is insufficient. Check the original provisioning identity UUID, not its display name.

Both signatures are required for **every** recovery, including non-owners. This deliberately makes sole-owner recovery require a separate approval without an ambiguous organization-specific exception. Operators must be different registered people with different public keys; neither may be the subject. The registry must not alias the same human as two people. One may verify against prior evidence; the other must independently review that evidence/verification and the precise intended effect before approving. Refuse if reliable evidence, a verifier or a separate approver is unavailable.

`examples/offline-recovery-trust.example.json` documents the format. It is intentionally invalid until placeholders are replaced with actual previously established fictional enrollment records. Do not fabricate or backdate evidence. The file must be a process-owned regular file, mode 0600, maximum 64 KiB on a supported POSIX host; symlinks, duplicate people/keys and non-Ed25519 keys fail closed. Keep the registry and private operator keys outside the repository and database backups. Private keys remain on the respective operators' offline devices; the recovery tool never accepts them.

Register the exact immutable registry digest through separate local administrator credentials. A **24-hour cooling-off period** begins when the database first records that digest, regardless of dates in the file. Recovery cannot enroll fresh trust and immediately reset an account. Retrying enrollment never resets its clock. Registry edits/rotation require new registration/cooling-off and invalidate cases bound to the old digest. There is no bypass flag. Existing accounts without prior adequate trust/evidence stay locked.

## Setup and CLI workflow

1. Back up, rehearse the upgrade, stop all identity/persistent runtime processes, then run `npm run db:migrate -- --database lms_development`. Migration 5 preserves business bytes and backfills a private credential-version UUID. Apply migrations only with hosts stopped; legacy processes do not know the new lifetime lease. The public temporary demo needs no network database and can remain independent.
2. Keep `.env.postgres` private. Add `LMS_RECOVERY_TRUST_FILE=/absolute/private/offline-trust.json`. Use the separate administrator URL, not either runtime login. Commands require an explicitly confirmed local development/test/restore database and reject remote targets.
3. Save private `enroll.json`: `{"confirmation":"REGISTER PRE-EXISTING OFFLINE TRUST"}`. Run `npm run recovery -- enroll --database lms_development < enroll.json`. Complete enrollment at least 24 hours before a recovery case. Keep a separate protected operator incident record and backups of public trust/provisioning records.
4. Open with private JSON `{ "subjectId":"SUBJECT_UUID", "evidenceId":"PRE_ENROLLED_EVIDENCE_UUID", "confirmation":"OPEN OFFLINE RECOVERY AND BLOCK ACTIVATION" }`: `npm run recovery -- open --database lms_development < open.json`. The returned review shows the case UUID, fictional name, affected roles, ten-minute expiry, requirement for two operators and exact effect. Opening persists the activation blocker; expiry or failed verification does not automatically remove it.
5. Request a verifier message with `{ "caseId":"CASE_UUID", "stage":"verification", "operatorId":"VERIFIER_UUID" }`: `npm run recovery -- review --database lms_development < request.json > verifier-review.json`. The verifier must independently check the prior evidence and exact subject/effect, then sign the **UTF-8 bytes of the parsed `message` string**, without an extra newline, using their separately held Ed25519 key.
6. Submit `{ "caseId":"CASE_UUID", "operatorId":"VERIFIER_UUID", "signature":"BASE64_SIGNATURE", "confirmation":"I VERIFIED THE OFFLINE RECOVERY REVIEW" }` through `npm run recovery -- verify --database lms_development < verification.json`. Signatures over another case, subject, database instance, stage, credential version, evidence or registry do not verify.
7. Repeat review/signature submission on the other operator's device using `stage:"approval"`, their UUID/key, and `npm run recovery -- approve --database lms_development < approval.json`. Approval includes the digest of the recorded verification. The same operator cannot approve their own verification. Both the case's ten-minute expiry and the approval's five-minute maximum age apply at completion.
8. Only after reviewing the exact effect, provide private standard-input JSON `{ "caseId":"CASE_UUID", "newPassword":"PRIVATE_REPLACEMENT_SECRET", "confirmation":"RECOVER FICTIONAL ACCOUNT AND REVOKE ALL SESSIONS" }` to `npm run recovery -- apply --database lms_development < apply.json`. Password bounds are the shared Better Auth policy (15–128 characters). Remove private secret input after use. Never put passwords in arguments, URLs or logs. Completion reports **credential replacement**, not activated/deployed/recovered service availability.
9. Verify without starting a host: `npm run recovery -- check-password --database lms_development < check.json`, using `{ "subjectId":"SUBJECT_UUID", "password":"PRIVATE_REPLACEMENT_SECRET", "confirmation":"VERIFY OFFLINE WITHOUT ACTIVATION" }`. Test both old/new credentials, confirm original roles/records/history and inspect secret-free audit outcomes. This uses the same Better Auth password codec; it issues no session/token. Keep the database offline afterward. Do not claim a successful live sign-in or deployment.

Operators can sign a reviewed message on their own offline Node 22+ device:

```js
import fs from "node:fs";
import { sign } from "node:crypto";
const review = JSON.parse(fs.readFileSync("verifier-review.json", "utf8"));
// Check prior evidence, subject UUID, expiry and effect independently before signing.
const key = fs.readFileSync("operator-private-key.pem", "utf8");
const signature = sign(null, Buffer.from(review.message, "utf8"), key).toString("base64");
fs.writeFileSync("attestation.json", JSON.stringify({
  caseId: review.caseId, operatorId: review.operatorId, signature,
  confirmation: "I VERIFIED THE OFFLINE RECOVERY REVIEW"
}), { mode: 0o600 });
```

Do not have one person run this for both operators or automatically sign server output without checking the prior evidence. No new keys or evidence are generated by the recovery path. Production operator authentication/MFA, secure evidence/key custody and real-person identity verification remain separate review gates.

## Host API and atomic behavior

`OfflineRecovery({databaseUrl,databaseName,trustFile})` is an administrator-only server/CLI interface. Its `enroll`, `open`, `review`, `attest(stage, input)`, `apply` and `verifyPassword` methods use strict schemas and a checked local target. It is never a browser interface and must not be mounted as one. Domain refusals include 403 authority/evidence unavailable, 409 wrong/used/stale stage, 410 expired and 423 active host/transaction. Storage failures propagate. The CLI logs only a generic failure and no diagnostic credential values.

Every operation requires the separate local superuser, a database-scoped exclusive advisory lock, and non-waiting exclusive table locks. Attached auth or persistent adapters hold a separate lifetime shared lease. Recovery refuses even idle attached hosts. Busy legacy transactions also fail closed; operators must stop them. New runtime starts cannot enter during the maintenance lock. Runtime session/credential/business write triggers and owner commands independently check the online gate, covering operations waiting on database locks. No request-pool slot is consumed by a lifetime lease; loss of its connection makes subsequent host operations fail.

Cases bind the database-instance UUID, subject, exact credential-version UUID, membership/access-revision digest, pre-enrolled evidence/registry digest and expiry. Verification and approval signatures use a versioned, canonical JSON message and distinct stage. Final application re-verifies both signatures and checks the current instance, credential and memberships after locks. A password/membership change invalidates the case. Supported online password changes cannot race an offline case: attached hosts prevent entry, and the pending-case blocker prevents new attachment. Concurrent recovery operations serialize or fail busy; consumed/stale cases never reset twice.

Credential replacement reuses the existing mutation helper and the same maintained Better Auth codec configured for normal sign-in/password changes. Password update, all subject session deletion, cascaded pending membership-approval cancellation, credential-version rotation, the existing credential event and completed recovery event commit together. No role/owner/configuration/record/business-audit mutation occurs. Failure rolls all those mutations back. A rejection is recorded separately when offline audit storage is available; unavailable audit storage is not a success. Do not auto-retry an uncertain commit: inspect case/event status through trusted maintenance.

Recovery tables have forced RLS and no application/identity-service grants. Audit records contain case/subject/operator UUIDs, action, fixed error code and server time; no password/hash, token, session UUID, signatures or evidence document. Signatures/context are protected in the private case table for validation. The database administrator remains trusted and can inspect/alter raw SQL; this is not a defense against that administrator.

## Restore blocker and next phase

Native backups exclude **all recovery case data**, retaining completed/rejected event history, credential versions, original business history and trust digest receipts. Guarded restore clears sessions, verification records, membership approvals and any manually archived recovery cases; it rotates the instance UUID, marks the state blocked and installs `lms_control.restore_blocker`. This also quarantines archives predating migration 5. Upgrading an old restored database preserves the blocker. Applied migrations and init commands do not remove it.

An old archive can still contain an old valid password hash. Tests prove that fact offline and prove normal auth/persistent attachment remains refused. **This is an enforced activation blocker, not full rollback-resistant credential recovery.** Manual administrator restoration/copying outside the supported tool can bypass markers, just as a superuser can bypass RLS. Do not attach such a database or infer safety from an empty session table. There is no supported reactivation path in this PR.

The follow-up must establish an independently protected credential lineage/epoch and key/role recovery, verify older-snapshot detection and credential rotation, and rehearse new sign-in/recent-auth/permission checks before implementing any unblock/activation command. Public recovery, MFA, transport/proxy/TLS security and production recovery remain disabled. See [evidence](offline-recovery-verification.md) and [security policy](../SECURITY.md).

Before invoking native restore, the guarded helper also commits a database-level `lms.restore_blocked=on` marker outside the archive/cleanup transaction. Runtime factories and database guards read the database catalog setting, not a caller-overridable session GUC. A failed native restore or post-restore cleanup therefore remains quarantined. This marker still does not solve arbitrary administrator/filesystem rollback; no activation command is supplied.
