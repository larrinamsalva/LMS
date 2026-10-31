# Trusted checkpoint publication — bounded local phase

PR #9 adds an offline custodian tool for **fictional credential history**. It durably publishes the existing two-witness checkpoints with a second, purpose-bound verification/approval of the publication itself. It never connects to PostgreSQL, reads password hashes/HMAC keys, signs on behalf of an operator or changes an activation blocker. No public endpoint or paid service is required.

This phase assumes independently protected custody and an honestly retained latest receipt. It **does not implement a hardware/remote monotonic witness** or protect against rollback of every trust anchor. A hash chain, signatures and filesystem sync cannot supply that guarantee.

## Separate the three responsibilities

| Responsibility | Keep here | Keep elsewhere |
| --- | --- | --- |
| Fictional database host | PostgreSQL, existing offline recovery/lineage tools | Publication-store write permission, signing private keys and sole custody of receipts |
| Publication custodian | Private Linux filesystem store, prior public trust registry, vetted LMS checkout | Database administrator credentials, HMAC key, signing private keys |
| Two independent operators | Each person's own Ed25519 private key, independently retained root/receipts and reviewed incident evidence | The other operator's key; sole copies inside DB backups |

A separate offline Linux computer is the clearest local rehearsal. A dedicated OS account is only independent of ordinary database users who cannot become that account/root; one administrator controlling both accounts/storage is not an independent boundary. Do not put the store in the repository, PostgreSQL volume, backup destination, network share or cloud-sync folder. Parent directories and devices must be protected. The utility checks process ownership, private modes, regular files, final symlinks and the directory's resolved path; it cannot prove human independence, secure device custody or isolation from OS root.

Use Linux, Node 22+ and the distribution's open-source `flock` utility (usually installed by `util-linux`). On Ubuntu/Debian, install `util-linux` if `command -v flock` finds nothing. Use a persistent local Linux filesystem/device that correctly honors `fsync` and advisory locks. Windows/macOS native filesystems, NFS/SMB/FAT, RAM filesystems, removable-media behavior, replication and storage that lies about flushes are outside the verified durability model. A Linux VM needs its own storage/power-loss review. Nothing here deploys a server.

## What is trusted

The immutable `root.json` binds a random store UUID, lineage stream UUID, exact pre-established registry digest and independently reviewed initial checkpoint digest. Initialization requires an existing, freshly signed checkpoint journal; it adopts no unknown history and cannot overwrite an existing store. Operators must enroll/retain the returned **root digest independently**. Initial adoption is an explicit trust decision, not proof of pre-enrollment history. The DB recovery registry's prior-enrollment/cooling-off rules still apply to DB recovery; publication supplies no alternative recovery authority.

Each publication request binds the store/stream/registry, generation, previous receipt digest, new checkpoint digest, complete journal digest, unique publication UUID and a maximum five-minute approval window, capped by checkpoint expiry. A verifier signs `publicationVerificationMessage`; a different enrolled approver signs `publicationApprovalMessage`, which also binds the verification proof. The existing checkpoint signatures are verified separately and cannot be replayed as publication signatures. All signatures use the existing canonical JSON and Ed25519 verifier.

**Each operator must retain the complete approved publication and its `receiptDigest` independently before submission**, together with the root/stream/generation and journal. This is the operator's high-water record, even if the publisher times out. Never approve competing publications for the same parent without resolving the conflict. Reconcile both operators' highest approved/acknowledged receipts before the next operation. Missing/conflicting custody means refusal; choosing an older available receipt is not recovery.

`verify` requires a nonempty independently retained minimum receipt digest. It verifies the entire immutable publication chain and requires that receipt to be present. It may return a later valid descendant, allowing a lost-response reconciliation; it cannot return an earlier head. Use the highest independently retained receipt, not a digest discovered from the store being tested. The root digest and minimum receipt must not be rolled back together with the publisher. If every store copy, operator high-water record, root pin and key can be rolled back/compromised together, an old valid history can be accepted. This phase does not detect that scenario.

## Beginner local rehearsal

Have both operators ready, with their existing independent keys and prior registry. Complete [offline recovery trust setup](offline-recovery.md) and [lineage capture/checkpoint signing](credential-lineage.md) on fictional accounts first. The publication utility takes an already signed strict **journal**, not the unsigned `propose` result. Do not transfer passwords, database URLs, HMAC keys or private signing keys to the publisher.

1. On the separate custodian machine, obtain/review the pinned LMS checkout and run `npm ci`. Create a private **parent** directory outside the checkout; `checkpoint-store` below must not exist:

   ```sh
   umask 077
   mkdir -m 700 /absolute/private/custodian
   cp .env.publication.example .env.publication
   chmod 600 .env.publication
   ```

   Replace absolute paths in `.env.publication` for `LMS_PUBLICATION_DIRECTORY`, `LMS_RECOVERY_TRUST_FILE` and `LMS_PUBLICATION_CANDIDATE_FILE`. The parent and registry/candidate files must be custodian-owned, modes 0700/0600. Leave `LMS_PUBLICATION_ROOT_DIGEST` empty **only for the first initialization**. Protect the checkout/environment as trusted tools; do not use unreviewed code. If the parent already exists, check its ownership/mode instead of recreating it.
2. Transfer the freshly signed journal through an independently checked channel. Both operators compare its latest checkpoint digest with their prior checkpoint approval and check the root/stream and full history. Save private `init.json`:

   ```json
   {"expectedCheckpointDigest":"INDEPENDENTLY_REVIEWED_64_HEX_DIGEST","confirmation":"INITIALIZE FICTIONAL PUBLICATION CUSTODY"}
   ```

   ```sh
   npm run --silent checkpoint -- init < init.json > root-enrollment.json
   ```

   Independently retain/compare the returned root descriptor and root digest. Put the agreed digest into `LMS_PUBLICATION_ROOT_DIGEST`. The utility never automatically trusts a root read from its own store. Existing root pins prevent initialization from replacing custody. Partial initialization is unusable; no reset/adopt/force option exists.
3. Save `review.json` with `expectedReceiptDigest:null` for the first publication, or the **latest independently retained** receipt digest thereafter:

   ```json
   {"expectedReceiptDigest":null,"confirmation":"REVIEW FICTIONAL CHECKPOINT PUBLICATION"}
   ```

   ```sh
   npm run --silent checkpoint -- review < review.json > publication-request.json
   ```

   Review does not publish, reserve a generation or approve anything. It validates the candidate, signatures, versions/commitments and exact prior history. Both operators must inspect the request, independently compare store/root/parent, recompute the candidate's canonical journal/checkpoint digests, check their original checkpoint approvals and verify expiry on trusted clocks. Do not sign unchecked server output. Request approval lasts at most five minutes; prepare transfers before starting.
4. On the **verifier's own offline device**, use the reviewed checkout and Ed25519 key to produce the proof. This example is run manually only after the checks above:

   ```js
   import fs from 'node:fs';
   import { sign } from 'node:crypto';
   import { publicationVerificationMessage } from './src/server/publication/protocol.ts';
   const request = JSON.parse(fs.readFileSync('publication-request.json', 'utf8'));
   const operatorId = 'ENROLLED_VERIFIER_UUID';
   if (Date.parse(request.expiresAt) <= Date.now()) throw new Error('Expired review');
   const key = fs.readFileSync('my-private-key.pem', 'utf8');
   const signature = sign(null, Buffer.from(publicationVerificationMessage(request, operatorId)), key).toString('base64');
   fs.writeFileSync('publication-verification.json', JSON.stringify({operatorId, signature}), {mode:0o600, flag:'wx'});
   ```

   Save this as a private `.mjs` file at the reviewed checkout root and run `node --import=tsx FILE.mjs`. Transfer only the request/proof and journal, never the private key.
5. The **separate approver** independently checks the same evidence and verifies the first proof against the prior public registry before signing. On their device:

   ```js
   import fs from 'node:fs';
   import { sign } from 'node:crypto';
   import { readTrust, verifyOperatorSignature } from './src/server/recovery/trust.ts';
   import { publicationVerificationMessage, publicationApprovalMessage, receiptDigest } from './src/server/publication/protocol.ts';
   const request = JSON.parse(fs.readFileSync('publication-request.json', 'utf8'));
   const verification = JSON.parse(fs.readFileSync('publication-verification.json', 'utf8'));
   const {registry} = await readTrust('/absolute/private/prior-trust.json');
   const operatorId = 'DIFFERENT_ENROLLED_APPROVER_UUID';
   verifyOperatorSignature(registry, verification.operatorId, 'verify', publicationVerificationMessage(request, verification.operatorId), verification.signature);
   if (operatorId === verification.operatorId || Date.parse(request.expiresAt) <= Date.now()) throw new Error('Invalid independent review');
   const key = fs.readFileSync('my-private-key.pem', 'utf8');
   const approval = {operatorId, signature:sign(null, Buffer.from(publicationApprovalMessage(request, verification, operatorId)), key).toString('base64')};
   const publication = {request, verification, approval};
   fs.writeFileSync('approved-publication.json', JSON.stringify({publication, confirmation:'PUBLISH VERIFIED FICTIONAL CHECKPOINT'}), {mode:0o600, flag:'wx'});
   fs.writeFileSync('independent-receipt.json', JSON.stringify({publication, receiptDigest:receiptDigest(publication)}), {mode:0o600, flag:'wx'});
   ```

   Both operators retain/independently verify that exact approved publication/digest and its journal before submission. Software checks distinct enrolled people/keys through the existing registry rules; it cannot prove that two devices/keys are actually controlled by separate humans. Production operator authentication/MFA and evidence governance remain deferred.
6. On the custodian machine, explicitly publish the approved request against the unchanged candidate file:

   ```sh
   npm run --silent checkpoint -- publish < approved-publication.json > publication-result.json
   ```

   Only a fully validated, exact next generation is eligible. Concurrent or replayed approvals fail; changing the candidate file, root, prior receipt, commitments or either signature fails. First publication must match the enrolled baseline. Later publications add exactly one checkpoint and preserve every previous checkpoint/entry. Physical instance transitions are **refused**; supported restore publication needs a future purpose-specific acceptance protocol, even if the DB-side lineage tool can propose one.
7. Verify using private `verify.json` containing the independently retained receipt, not a value automatically read from the publisher:

   ```json
   {"minimumReceiptDigest":"INDEPENDENTLY_RETAINED_PUBLICATION_DIGEST","confirmation":"VERIFY PUBLISHED FICTIONAL CHECKPOINT"}
   ```

   ```sh
   npm run --silent checkpoint -- verify < verify.json > verified-publication.json
   ```

   Success returns the latest signed receipt, matching checkpoint digest, strict journal and `activationAllowed:false`. It requires a current checkpoint; expired latest checkpoints are refused for current verification. A completed historical chain may still be used to review a freshly signed renewal. The verified journal/checkpoint digest can be transferred to the existing offline `CredentialLineage.assess` interface with the separately protected HMAC key on its authorized offline host. That assessment still checks the actual PostgreSQL state and restore markers. A publication receipt is not identity verification, password knowledge or authority to activate.

## Durability, interruptions and reconciliation

The local store has immutable numbered `001.json`… records, `root.json`, a stable `.lock` inode and an optional `pending.json`. It has no mutable "latest" pointer. Every read verifies all records, their contiguous generations, signature purposes, parent receipts and exact journal prefixes. Unknown files, missing records and unsupported versions are refused. Limits: 128 publications, 20 MiB per record and 64 MiB of committed record bytes, plus one bounded pending copy. No pruning, rebase, root/key rotation or automatic adoption is supplied.

An OS advisory lock serializes cooperating operations and releases when its owning process dies. Never delete/replace `.lock`. Competing requests receive a busy/stale-parent refusal; there is no time-based stale-lock deletion. An advisory lock is not protection against an attacker with custody filesystem permissions.

The publisher writes and syncs the complete approved intent, syncs the containing directory, writes/syncs the exact numbered record, syncs the directory, rechecks expiry, removes the intent, syncs the directory again, then reports success. File or directory sync errors propagate. A durable pending intent causes verification/new publication to refuse **even if an older complete record exists**. A process killed after an intent becomes durable can resume only the identical independently retained approval:

```json
{"expectedPublicationDigest":"EXACT_INDEPENDENTLY_RETAINED_APPROVAL_DIGEST","confirmation":"RESUME THE EXACT APPROVED PUBLICATION"}
```

```sh
npm run --silent checkpoint -- resume < resume.json > resumed-result.json
```

Resume rechecks root, signatures, current approval/checkpoint expiry, prior receipts and exact content under the OS lock. It can finish a byte-for-byte prefix of the approved record or synchronize a matching complete record; it cannot overwrite conflicting content. If the pending intent itself is incomplete/corrupt, approvals expired, keys/root unavailable or history conflicts, **resume refuses and the store stays blocked**. There is no cancel/clear/force command. Long-outage/expired-intent repair with new independent authorization is intentionally deferred rather than accepting stale approval. Retain incident evidence and all copies for a separately reviewed repair phase.

A lost response after intent removal may mean the new record committed. Verify using the independently retained candidate receipt; replaying publication is refused once committed. Never infer success from a file's presence, delete a pending file, select an older backup/head, or auto-retry with a newly generated approval. If the storage device replays older metadata after a real power loss, a surviving pending file blocks verification; if it loses an entire acknowledged record, the independent high-water receipt detects its absence. If it loses all anchors too, no guarantee is possible here.

Tests simulate interrupted stages, partial files, competing processes and SIGKILL on real Linux filesystem operations. They do not physically cut power, certify storage controllers/filesystems, prove off-device custody or provide atomicity between PostgreSQL and the publisher. Database writes can commit while publication is unavailable; that tail remains unwitnessed. Current checkpoint verification/DB assessment refuses stale or mismatched evidence, and every database activation blocker remains enforced.

## Remaining phases and source references

Next security phases: independently monotonic witness/high-water custody, quorum/fork reconciliation, expired/corrupt-intent repair, key/registry/role recovery and rotation, identity-specific acceptance, supported instance transitions and post-acceptance authentication/access tests. None is permission to activate. Usable fictional business modules and BuildPlan Studio configuration work can progress separately; see [the roadmap](../ROADMAP.md).

Implementation uses Node file-handle sync and Linux `flock` open-file-description semantics. Primary references: [Node 24 filesystem API](https://nodejs.org/docs/latest-v24.x/api/fs.html), [Linux fsync and directory synchronization](https://man7.org/linux/man-pages/man2/fsync.2.html), [Linux flock](https://man7.org/linux/man-pages/man2/flock.2.html). These specify mechanisms, not a hardware durability certification. See [test evidence](checkpoint-publication-verification.md).
