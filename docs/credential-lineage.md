# Independent credential lineage foundation

PR #7 implements a host-only **foundation and read-only assessment** for fictional databases. It does not accept a recovered identity, reactivate a database, start authentication or supply an override. Every report says `activationAllowed:false`; all PR #6 activation blockers remain in force. A successful assessment proves consistency with a particular independently pinned checkpoint under the assumptions below, not permission to run a restored service.

## Trust boundary and custody

Three things must survive independently of PostgreSQL and its backups:

| Anchor | Custody and purpose |
| --- | --- |
| Pre-established recovery registry | Existing private registry of Ed25519 public keys, separate people and prior identity-evidence references; enroll through the existing recovery process at least 24 hours beforehand. Its canonical digest is bound into every checkpoint. |
| Two operator signing keys | Different verified operators, separately controlled offline devices, outside the database host and its backups. Verification and approval use different purposes; approval binds the verifier's proof. The database utility never loads signing private keys or signs checkpoints. |
| Latest checkpoint receipt and commitment key | Custodians retain the **highest acknowledged signed-checkpoint digest**, epoch, stream UUID and complete journal on independent protected storage. A separate 256-bit HMAC key stays outside database/archive custody. An authorized offline assessment process may temporarily read that key from a private file. Database runtime users must never have filesystem access to it. |

The latest digest is supplied explicitly as `LMS_LINEAGE_EXPECTED_CHECKPOINT` from the custodian's independently checked receipt. Never derive that trusted value from the journal being checked or save its only copy in the same backup. A signature/hash chain establishes integrity, not freshness: rolling back the database, journal **and** trusted receipt together is undetectable here. There is no remote witness, hardware monotonic counter, WORM store or automatic durable publication in this phase. Multiple custodians must reconcile the latest acknowledged receipt before review; conflicting receipts mean refusal.

POSIX process-owned regular files with no group/other permissions are required. Final-component symlinks are refused; operators must also protect parent directories, mounts, transfer paths and tools. File permissions alone do not establish independence. The current local maintenance administrator is a superuser; it can change database rows/triggers, backdate registration and read hashes. A compromised database server can also lie to the verifier. Separate custodians must independently review adoption and new tails; signatures do not prove that the database administrator's new events were authorized. Combined OS/root, custodian-key, trusted-receipt or verifier compromise is outside this protection. This is not a defense against an administrator controlling all trust anchors.

## Transactional metadata and external epochs

Migration `006_credential_lineage.sql` creates a private forced-RLS stream and append-only-by-runtime metadata outbox. It takes the existing exclusive maintenance lock and non-waiting table locks. Stop all hosts first. An attached v5+ runtime lease prevents migration, and a failed backfill/schema transaction leaves migration 5 intact. Applied migrations 1–5 are unchanged.

The stable stream UUID survives a supported restore. The physical database instance UUID still changes on restore. Each outbox entry binds the stream, contiguous sequence, previous digest and exact UTF-8 payload bytes with SHA-256. Payloads allow only UUID references, credential-version UUID, action and UTC time. Triggers cover credential version insertion/change/deletion, credential audit events and recovery enrollment/review/completion/rejection events. They run in the source transaction; an append failure rolls back the credential change and revocation. No password/hash, session token, recovery evidence contents, signature or new identity provider enters the outbox.

Existing credentials/audits are adopted once as an explicit **baseline** during migration. They are not authenticated evidence of events before enrollment. A database already quarantined when migration 6 runs is ineligible for genesis; installing the migration cannot create trust for an old restore. Never use initialization, a missing journal, a new stream or a new key as a way to rebase previously enrolled history.

An unsigned proposal contains the complete metadata journal and a candidate checkpoint. Two independent witnesses must review and sign it outside the database host. Each signed checkpoint binds its epoch, stream/head, previous signed-checkpoint digest, registry digest, captured instance, key ID/fingerprint, credential version digest and opaque HMAC commitments. Individual commitments bind account/subject/version and the exact stored credential material; the aggregate commits the complete sorted set. The key remains secret and hashes are never exported. This establishes equality with witnessed bytes, not password quality, human identity or current knowledge of the password.

A proposal for the next epoch requires the existing independently pinned signature chain and an exact database prefix. It rejects rollback/forks, wrong keys and changed credential material at an unchanged version. New versions still require human reconciliation of the metadata tail and incident evidence. External publication is a separate operation, **not atomic with the database commit**. Unpublished changes are not externally durable or accepted automatically; assessment rejects any unwitnessed tail. Expired but otherwise valid prior checkpoints can be used to propose renewal; fresh assessment requires a new reviewed checkpoint with its own independent receipt.

Every checkpoint has at most ten minutes of assessment validity. Earlier signed checkpoints remain historical links. Epochs and sequence numbers cannot decrease, signatures are purpose-bound, and the final journal must match the independently pinned latest digest exactly. Registry/key rotation and fork reconciliation are unsupported and fail closed. Limits are 10,000 entries, 1,000 checkpoints, 1,000 credentials and 16 MiB per journal; reaching a limit requires another reviewed phase, never silent truncation/pruning.

## Local rehearsal

Use only provisioned `@example.test` accounts and the existing local fictional/test/restore target allowlist. This procedure is for maintenance, never a browser or public HTTP endpoint.

1. Stop identity and durable runtime hosts; back up and rehearse reviewed migrations on a separate fictional database. Run `npm run db:migrate -- --database lms_development`. The public in-memory demo stays independent. Establish the existing trusted registry through [offline recovery enrollment](offline-recovery.md); do not shorten its 24-hour cooling-off period.
2. On independent custody storage, generate a random commitment key once. Keep encrypted offline custody backups distinct from database archives. For example, on the custodian device with `umask 077`:

   ```js
   import fs from 'node:fs';
   import { randomBytes, randomUUID } from 'node:crypto';
   fs.writeFileSync('commitment-key.json', JSON.stringify({
     protocol: 'lms-lineage-key-v1', id: randomUUID(),
     secret: randomBytes(32).toString('hex')
   }), { mode: 0o600, flag: 'wx' });
   ```

3. Configure private absolute paths and the separate local maintenance URL through `.env.postgres` / a trusted process environment. Keep credentials out of arguments/logs. `LMS_RECOVERY_TRUST_FILE` is the already enrolled registry. `LMS_LINEAGE_COMMITMENT_KEY_FILE` identifies the protected key; `LMS_LINEAGE_JOURNAL_FILE` identifies a private independently transferred journal snapshot. For initial adoption this journal path must not exist and no expected pin may be supplied. No key, registry or journal is generated by the database command.
4. Use private stdin JSON `{ "mode":"genesis", "confirmation":"CAPTURE FICTIONAL LINEAGE FOR INDEPENDENT REVIEW" }` and run:

   ```sh
   umask 077
   npm run --silent lineage -- propose --database lms_development < request.json > proposal.json
   ```

   `genesis` only proposes adoption of an online-eligible, previously unquarantined baseline; it does not register a trusted epoch. Both custodians must verify that this is the first adoption for that stream using their independent records. A malicious operator omitting all external history can generate another unsigned proposal; it cannot replace the independently held latest receipt or authorize activation.
5. Transfer the candidate to each operator's offline device using an independently checked channel. Review the exact stream, epoch/parent, prior receipt, event tail, key fingerprint, account versions, incident and timestamps. Verify prior physical identity evidence separately where recovery is involved. Do not sign unchecked database output. Use the reviewed protocol functions in `src/server/lineage/protocol.ts` with a vetted checkout: verifier signs UTF-8 `verificationMessage(checkpoint, verifierId)` with Ed25519; approver verifies that proof and signs `approvalMessage(checkpoint, verification, approverId)`. Each proof is `{operatorId,signature}` with base64 encoding. `SignedCheckpoint` is `{checkpoint,verification,approval}`. Private signing keys must never be transferred to the database host. The test helper is **synthetic**, not a custody tool.
6. Custodians append the signed checkpoint to `proposal.journal.checkpoints`, retain the resulting strict journal and compute `checkpointDigest(signedCheckpoint)` for their separately protected latest receipt. Check the full journal with `verifyJournal` on the witness side before accepting that receipt. Write/transfer complete files safely; interrupted or missing publication causes refusal. The utility never writes or updates the trusted journal/pin, and it never auto-signs. These manual custody steps are not a production publication protocol.
7. After a supported credential change/recovery, use `mode:"advance"`, the existing journal and the independently checked `LMS_LINEAGE_EXPECTED_CHECKPOINT`. Review/sign/publish a new epoch and independently advance the receipt. A database older than the current receipt cannot propose a new epoch. Lost/conflicting evidence or keys must stay blocked; there is no force, rebase or rotation escape hatch.
8. Use the existing guarded backup/restore procedure into an **empty separate** fictional restore database. It revokes restored sessions/verification/cases/approvals, retains original roles, business records and audit history, rotates the physical instance UUID and installs durable blockers. Keep all hosts stopped. Use private stdin `{ "confirmation":"ASSESS OFFLINE LINEAGE WITHOUT ACTIVATION" }`:

   ```sh
   npm run --silent lineage -- assess --database lms_restore_rehearsal < assessment-request.json
   ```

   Provide the latest independent pin, journal, registry and commitment key. A supported restored instance may differ from the checkpoint only with both the guarded restore marker and durable database-catalog blocker. Raw filesystem/manual copy histories are unsupported. Success reports `lineageVerified:true`, `credentialStateVerified:true`, epoch/sequence and `activationAllowed:false` with `RECOVERY_ACCEPTANCE_AND_ACTIVATION_NOT_IMPLEMENTED`.

The assessor checks a complete locked snapshot, source audits, versions, commitments, signatures, pinned freshness and restore history. It refuses residual sessions, verification records, membership reviews or noncompleted recovery cases. It does **not** clear them or change anything. Approved restore/recovery commands handle revocation; if an offline recovery leaves unrelated sessions or competing cases, complete a separately reviewed maintenance procedure rather than deleting them to obtain a passing report. Assessment is repeatable read-only evidence, not a consumed recovery approval. It neither creates a session nor proves live sign-in works. Assessment failures do not append an event to the very history being assessed; retain CLI outcome/receipt information in the separate operator incident record, without secrets.

## Failure and remaining activation gates

| Condition | Behavior |
| --- | --- |
| Old DB vs current journal, missing outbox/version/audit or fork | Refuse proposal/assessment; existing blocker stays set |
| DB ahead of witnessed epoch | Refuse assessment; independently review/publish the tail first |
| Missing/corrupt/insecure file, wrong key/root/pin, invalid signature | Refuse; no fallback trust, key generation or automatic adoption |
| Expired/future evidence, reused signature at a new epoch | Refuse assessment; valid historical chain alone can propose a freshly reviewed renewal |
| Live host, concurrent maintenance/transaction, append/storage failure | Refuse busy operation or roll back its transaction |
| Legacy quarantined database never enrolled in lineage | Refuse genesis; full identity/credential/key recovery is still a deployment blocker |
| Successful consistency assessment | Preserve every blocker; no activation or business mutation |

Before activation can be implemented, the next phase must supply a durable independently monotonic publication/receipt protocol, auditable identity-specific recovery acceptance using prior trusted evidence, fresh independent approval including sole-owner separation, credential/key/role recovery and rotation, fenced all-session/approval invalidation, and a tested post-acceptance authentication/recent-auth/authorization rehearsal. Existing recovery signatures remain required for credential replacement; lineage signatures cannot substitute for identity verification or owner authority. Public authentication, MFA, production transport/security, real-user acceptance and production recovery require their own reviews. See [verification evidence](credential-lineage-verification.md) and [SECURITY.md](../SECURITY.md).
