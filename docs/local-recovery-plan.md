# Controlled local recovery plan

The implemented [offline recovery contract](offline-recovery.md) uses prior trust, independent signed verification/approval, expiring one-use cases and atomic credential/session/audit changes. This plan applies to provisioned fictional accounts only. No public reset or production account is enabled.

**Credential replacement is implemented; service activation is blocked.** Normal authentication and persistent adapter attachment refuse recovered/restored databases. Older backups can contain older password hashes. There is no unblock command while external credential-lineage/rollback protection and activation acceptance remain unresolved.

## Required offline procedure

| Step | Implemented control | Evidence retained privately |
| --- | --- | --- |
| Establish prior trust | A trusted registrar checks original provisioning/identity records and independently held operator keys before a case exists. The private registry digest must have been registered at least 24 hours earlier. Unverified email, names and claimed membership are insufficient. | Prior subject/evidence references, unique operator/person UUIDs and public keys; no documents, passwords or private keys |
| Contain | Stop all identity/persistent hosts. Local administrator authority, exclusive maintenance locks and non-waiting table locks are required. Opening a case blocks subsequent runtime attachment. | Case/subject/database UUIDs, version bindings, expiry and opening event |
| Verify and approve | One enrolled operator independently verifies prior evidence and signs the exact review. A different enrolled person/key independently approves it. Both are required for every recovery, including sole owners; refuse when evidence or independent approval is missing. | Stage-bound signatures in the private case; secret-free verification/approval events |
| Apply | Explicit confirmation, unchanged credential/membership/instance versions, a live ten-minute case and approval no older than five minutes are required. Credential replacement, every subject session/pending approval, version rotation and credential/recovery audits commit together. Expiry is rechecked at completion. | One-use completion or rejection; no role/configuration/business-history rewrite |
| Verify offline | Check old/new credentials using the same Better Auth codec, inspect retained roles/data/history and audit outcomes. No session/token is issued. Keep the recovered database blocked. | Offline verification and incident outcomes; never claim live sign-in, deployment or accepted service recovery |

The registrar must establish real human independence/key custody; cryptographic signatures alone cannot prove physical identity facts or that two keys belong to different people. A database administrator remains trusted. Do not manufacture evidence after loss, automatically sign a server-generated review, edit password hashes, grant a replacement owner or remove the activation marker as a shortcut.

Follow [the exact registry, signing and CLI workflow](offline-recovery.md). Private keys remain on the respective operators' offline devices. `auth:revoke-all` remains containment, not independent recovery approval. Missing trust/evidence/key custody means refusal.

## Acceptance still required before activation

- Independently protected credential lineage/epochs that detect older snapshots, including restoration outside a single database transaction.
- Key/role/credential recovery, secret rotation, encrypted retention/off-device evidence and a full disaster-recovery rehearsal.
- A separately reviewed activation command with authenticated operator authority and no unverified-mailbox bypass.
- Verified new sign-in/recent-authentication, old password/session/proof rejection and organization permission tests after that activation procedure.
- Public identity verification, MFA, TLS/proxy/session boundaries and general business-write session fencing before any real-user/public recovery service.

The current native tests demonstrate preserved bytes, rejected replay, failure rollback and enforced quarantine of old/new/legacy archives, including failed cleanup. They deliberately do not claim rollback-resistant activation. See [verification evidence](offline-recovery-verification.md).
