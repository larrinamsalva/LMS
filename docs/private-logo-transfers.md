# Host-only private logo transfer

This workflow imports the logo from a reviewed **Branded Blueprint Bundle 1** into an independently authorized fictional PostgreSQL organization. It creates a new private PNG and immutable destination mapping in **one transaction**. It never selects the image, publishes the imported configuration, changes a draft or association, migrates data or enables a restored database.

There is no public persistent transfer/upload/download route or accepted real-user transport. Public no-login Studio retains its separate expiring demo vault and unchanged companion/bundle workflows. This API is for trusted host code and disposable fictional test tooling only.

## Local prerequisites

1. Follow [durable logo setup](durable-private-logos.md) and [local identity setup](local-auth.md). Use the restricted `lms_runtime` business login and separate `lms_auth_runtime` identity login. Do not transfer with maintenance credentials.
2. Stop runtime hosts and explicitly apply **additive migration 15** using existing migration tooling. SQL 1–14/checksums are unchanged; opening the store never migrates or repairs a database.
3. Retain the existing process-owned POSIX 0600 native trust file outside the checkout. It independently identifies the fictional `lms_test_*` source, exact instance UUID, organization allowlist and separate `lms_restore_*` target. Database names, claimed membership, emails and bundle metadata alone do not establish fictional provenance or destination authority.
4. Provision fictional accounts through the existing local adapter, establish destination owner/admin membership through existing reviewed access controls, and sign in locally. The shared **five-minute recent-session rule** is checked inside each transfer transaction. Unverified email is not recovery evidence or production identity acceptance.
5. Inspect the device bundle using existing strict bundle/Studio review. A hash verifies bytes, not authority. An independently verified nested Blueprint attestation covers **only that Blueprint ZIP**, never the image or complete bundle. No publisher key is enrolled here.

## Explicit review and transfer

The existing `openPrivateLogoStore` now exposes `.transfers` using the same restricted pool, independent trust allowlist and maintenance/recovery lease. Resolve the operator through existing `createLocalAuth(...).identity(headers)`. Never accept user IDs, session assertions, publisher names or public demo cookies as identity. Capture authenticated headers once; the resolver revalidates the current local session.

```ts
const assets = await openPrivateLogoStore({ databaseUrl, trustFile });
const headers = new Headers(verifiedLocalRequestHeaders);
const resolve = () => localAuth.identity(headers);
try {
  const inspected = await assets.transfers.review(resolve, organizationId, exactBundleBytes);
  // Present blueprint name/type/configuration/modules, image metadata/layout/digests,
  // destinationConfiguration, expected revisions, usage and UNVERIFIED image/bundle publisher status.
  // No unprocessed image pixels are returned or rendered.
  // Obtain explicit current owner/admin approval to sanitize and store.
  const command = {
    format: "lms-private-logo-transfer-command", version: 1,
    operationId: crypto.randomUUID(), review: inspected.review, confirmed: true,
  };
  const receipt = await assets.transfers.accept(resolve, organizationId, exactBundleBytes, command);
  // Retained private asset, STORED at commit. Not selected, associated or published.
  const identity = await resolve();
  if (!identity) throw new Error("Sign in again before private inspection");
  const image = await assets.read(identity, organizationId, receipt.asset.id, receipt.asset.revision);
  // Independently accepted private local inspection only; never a public URL or log.
  image.bytes.fill(0);
  const history = await assets.transfers.history(resolve, organizationId);
} finally { await assets.close(); }
```

This is a library workflow, **not a newly accepted interactive persistent browser transport**. Trusted host applications must present the review and obtain actual explicit confirmation. `confirmed: true` is not cryptographic evidence of human intent. Do not expose the SDK to arbitrary callers. The independent-process native test probe signs in through the actual unmounted Better Auth adapter; its automatic synthetic fixture confirmation is not an administration UI.

Review checks current role/session/instance/capabilities/quotas, validates the complete closed bundle and both nested components with the original readers, and returns validated blueprint and destination configuration plus metadata. It returns no raw PNG preview. Approval repeats exact bundle/component/image verification, requires matching destination actor/instance/configuration fingerprint and asset/association cursors, and **runs the original sanitizer again**. It shares the pinned `sharp-0.35.5/png-v1` processor, two-slot processing gate, timeout, container/frame/pixel/dimension/byte limits and metadata stripping. Filenames/MIME claims are unused. A correctly hashed animated PNG can pass structural review and still fail decoding without creating an asset.

Reviews expire after ten minutes; the existing session freshness rule can expire earlier. Sign in and explicitly refresh when necessary. After decoding the host resolves the same identity/session again. SQL then locks/checks the actual session and current membership through commit. Concurrent revocation either precedes/refuses the transfer or follows an already authorized committed operation; delivered bytes cannot be recalled.

## Private destination map v1

`src/core/logo-transfers.ts` defines strict private data-only contracts. None is a portable import envelope or authorization token. The immutable `lms-private-logo-destination-map` 1 binds:

| Field | Binding |
| --- | --- |
| `review.source` | Exact complete bundle SHA-256/bytes, exact nested Blueprint and Companion SHA-256/bytes, original PNG SHA-256/bytes/dimensions/layout, supported component versions |
| `review.organizationId`, `instanceId`, `actorId` | Independently authorized destination identities, never source-side ownership claims |
| `review.expected` | Published configuration revision/PostgreSQL JSONB fingerprint, asset mutation cursor and association revision |
| `review.reviewedAt`, `expiresAt`, `sanitizer` | Reviewed ten-minute window and pinned supported destination processor |
| `operationId`, `reviewStatus` | Confirmed operation and same-actor retry identity |
| `asset` | New destination-generated UUID, initial revision 1/stored state, sanitized output SHA-256/bytes/dimensions/profile |
| `assetStateRevision`, `occurredAt` | Committed destination cursor and database timestamp |

The configuration fingerprint uses the existing PostgreSQL JSONB text encoding, not a new portable canonicalization rule. Original/output digests are separate because re-encoding can change bytes. Local digests are not independently tamper-proof custody, publisher identity or rollback protection against compromised administrators/hosts.

`lms.logo_transfer_receipts` is both append-only mapping and transfer receipt; there is no redundant mutable mapping table. Scoped foreign keys bind organization, exact historical configuration, initial asset-history revision and the **existing asset operation receipt**. Forced RLS restricts metadata SELECT to current owners/admins; application table writes and TRUNCATE are denied. Staff/viewers get no transfer/mapping authority. Existing selected/associated image readers and raw-byte restrictions remain unchanged.

The transaction locks existing organization, membership, session, publication/association/asset fences, then invokes the **original asset store command** for UUID generation, 16 retained assets/2 MiB quota, ordinary 128-command budget and reserved cleanup slots, immutable bytes/history and receipts. Retired/blocked assets count; no budget refund. Asset/history/cursor/asset receipt, mapping and minimal audit event commit atomically. The complete current configuration is validated with the original versioned reader **before commit under the publication lock**; unsupported modules/configurations roll back every effect.

Audit payloads contain only contract version, operation ID and revision numbers. They omit pixels, image/component hashes, original filenames, configuration documents, cookies and session IDs. Private maps are neither portable exports nor migration-readiness reports. Never publish them as gallery/package metadata.

## Retry and retained lifecycle

| Situation | Result |
| --- | --- |
| Exact committed operation, same currently authorized actor, exact original file/command | Original durable receipt; no second decoder/store/history/audit event |
| Same operation with another actor/payload/bytes or an ordinary asset command | Refuse; no adoption of unrelated existing assets |
| New operation with stale configuration/association/asset state | Refuse; explicitly refresh instead of following newer state |
| Missing/non-recent/expired/revoked session, foreign organization/instance, absent capability/cursor, quarantined restore | Refuse, including committed retries |
| Failed sanitization, quota or transaction | No partial committed transfer; no deletion or retained-quota reset |
| Lost response after commit | Ambiguous to caller: retry the **identical** command/file first; no success claim without durable evidence |
| Later selection/replacement/unreferencing/blocking/retirement | Historical receipt unchanged; refresh current asset metadata/read |
| Missing/damaged asset | Verified reader refuses; no repair, recreation, reassignment or refund |

Receipt `stored` and asset revision 1 describe the original commit, not present eligibility. Independently review/select the new image through [migration-13 lifecycle](durable-private-logos.md), then explicitly review/apply [migration-14 association](private-logo-associations.md) to the exact current branded configuration. Transfer does neither. A schema-1 organization may retain the asset but is not upgraded or branded. Configuration rollback/publication still requires explicit rebinding and preserves historical references; no automatic image resurrection.

## Backup and remaining limits

Native same-schema backups now include mappings alongside private PNGs, asset/association/configuration history, receipts and audits. Keep archives private. The closed readiness inventory compares exact rows privately without exporting image/operational values in reports. Quarantined restores purge sessions/pending approvals, change instance identity and remain blocked by database settings/control state, runtime leases and SQL guards. Restored mapping instance IDs remain historical evidence, never authority to attach or activate the copy.

Testing establishes fictional same-schema preservation only, not production recovery, real-customer portability, schema transformation, encryption/off-device retention, monotonic witness guarantees, secure physical deletion or real-user security acceptance. The processing gate is per host, not a distributed public rate limiter or OS decoder sandbox. Trusted compromised runtime hosts/superusers can impersonate users or alter internally consistent evidence; independent trust custody remains essential.

Portable codecs and canonical summaries remain byte-for-byte unchanged: BusinessConfig/BuildPlan/Blueprint 1/2, detached attestation 1, Logo Companion 1 and Branded Bundle 1. The original bundle's fixed README describes mapping as future work in its original protocol text; this **separate private API** implements that host-only step without rewriting the protocol. Destination IDs/receipts never enter portable exports. A nested Blueprint signature does not authenticate the image or outer bundle.

Next: independently reviewed persistent private transport and real-user acceptance; independent key enrollment/retirement/freshness for the separate [complete-bundle signature protocol](branded-bundle-provenance.md); explicit portable published-image associations; separately authorized retention/disposal. No production media, automatic migration, destructive cleanup or recovery activation is provided.

[Actual verification](private-logo-transfers-verification.md) · [Bundle workflow](branded-blueprint-bundles.md) · [Security](../SECURITY.md)
