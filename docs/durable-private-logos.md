# Durable private fictional logo assets

This is a **host-only persistence contract and test-tooling phase**, not persistent media in the public website. The no-login demo still uses its separate temporary memory vault, two-hour sessions, original upload/cleanup quotas and unchanged Logo Companion v1. No persistent upload/read HTTP route, filesystem/object-store asset backend, production account acceptance, configuration publication or recovery activation is added.

## Boundaries and prerequisites

Use a previously established **fictional PostgreSQL lab**, the restricted `lms_runtime` login and the existing [private native-readiness trust file](native-upgrade-readiness.md). The source must be an exact allowlisted `lms_test_*` database on literal loopback (`127.0.0.1` or `[::1]`), with a password, no URL query/fragment/DNS alias, a matching instance UUID and listed organization. `lms_development`, unknown/remote/restored targets and administrator runtime credentials refuse. The process-owned 0600 trust file uses the existing native trust schema without modification. Names, UUIDs, an `example.test` identity or `fictionalOnly` declaration do **not** establish provenance; the trusted operator must verify the lab before enrolling it. Any non-test-domain local identity makes asset operations refuse as additional defense, not identity verification.

Apply reviewed migration **13** explicitly after backing up and stopping hosts. Use the existing `db:migrate` command with the lab's exact database/administrator URL; normal `npm run dev` never migrates or connects it. Applied SQL 1–12/checksums remain unchanged. A failed migration rolls back its schema and ledger transaction. The new runtime factory requires the existing restricted-login verifier, recovery/maintenance lease, matching unblocked instance and installed contract. It never runs migrations, changes ownership or repairs trust.

`Principal` has the **same trusted-host meaning as the existing Engine**. Before every operation, resolve the current caller through the existing local identity adapter (`createLocalAuth(...).principal(headers)`) and reject a missing/revoked session. Never accept user IDs from HTTP/JSON or cache a Principal as continuing authorization. The library reuses `Engine.asUser`, transaction-local role/context and existing `lms.has_role`; it rechecks current membership after native processing. It does not authenticate an HTTP request, create identities, extend sessions, or replace the host's session/recent-authentication obligations. The independent-process probes use explicitly trusted synthetic fixture principals, not real-user authentication evidence. Public transport/session integration and real-user acceptance remain blocked future work.

## Host integration

`src/server/postgres/logo-assets.ts` exports `openPrivateLogoStore({databaseUrl, trustFile})`. This server-only module is never imported by application routes or the demo. Credentials/trust stay in trusted host configuration, outside client bundles and files shared as blueprints.

```ts
// Inside an independently trusted local host; do not mount this as a public handler.
const principal = await localAuth.principal(currentHeaders);
if (!principal) throw new Error("Current local identity is required");
const assets = await openPrivateLogoStore({ databaseUrl, trustFile });
try {
  const current = await assets.snapshot(principal, organizationId);
  const receipt = await assets.store(principal, organizationId, fictionalImageBytes, {
    version: 1, operationId: crypto.randomUUID(),
    expectedRevision: current.revision, display: "rectangle",
  });
  // Stored bytes are not selected, published or attached to a BusinessConfig.
  const checked = await assets.read(principal, organizationId, receipt.assetId, receipt.assetRevision);
  // Explicitly authorized private inspection only. Do not log or expose checked.bytes.
  checked.bytes.fill(0);
} finally { await assets.close(); }
```

`store` accepts **bytes only**, no filenames, paths, MIME trust, URLs or "already sanitized" switch. It uses the original `sanitizeLogo` pipeline: actual PNG/JPEG/WebP signature/container/frame/dimension/pixel checks, 1 MiB input, strict native decode, 3-second native timeout, metadata stripping and static sRGB PNG output up to 512×512 / 256 KiB. `read` verifies stored dimensions, byte count, SHA-256 and the pinned `sharp-0.35.5/png-v1` profile with that same decoder again, then rechecks authority/revision. It returns an independent byte copy. Damaged/unsupported bytes remain unavailable; there is no relaxed decode path. A future codec update that changes canonical PNG bytes requires reviewed compatibility, not silent acceptance. Native decoding and buffer clearing are not an OS sandbox or guaranteed erasure.

Both backends share **one two-slot process-wide processing gate**. The temporary demo retains its existing collection/storage reservations and limits. Durable storage has no public request surface or new distributed rate limiter. Trusted hosts must not expose this library to arbitrary anonymous work.

## Contract, SQL controls and quotas

Four additive forced-RLS tables are in the reviewed native inventory:

| Table | Purpose and authority |
| --- | --- |
| `lms.logo_assets` | Server-generated UUIDs; immutable PNG bytes/identity, exact dimensions/byte count/SHA-256, display, codec version, asset revision and lifecycle timestamps |
| `lms.logo_asset_states` | Organization-wide mutation revision and optional future selection; scoped foreign key prevents cross-organization association |
| `lms.logo_asset_receipts` | Append-only actor/operation/digest/result receipts; no image bytes or original filenames |
| `lms.logo_asset_history` | Append-only asset revision/state/actor/operation/time history; no pixels, input metadata or credentials |

The application role has no table INSERT/UPDATE/DELETE/TRUNCATE and **no SELECT on image content**. Metadata RLS admits owners/admins, or only the current selected asset for staff/viewers with current membership. Elevated entry routines have fixed empty search paths, exact command vocabulary/fields and independent organization/actor/online checks. They lock the organization, then the current membership, then the state cursor/assets, ordering role changes and asset operations. A real cursor update rejects stale repeatable-read writers. Receipt/history foreign keys are scoped; history references commit atomically with the command receipt. There is no cascade deleting retained image history when an organization/user is removed.

SQL verifies bounded reviewed PNG structure, exact digest/size, immutable identity and valid lifecycle transitions. It is **storage defense**, not an alternative decoder or proof that arbitrary SQL-supplied bytes were sanitized. Only the trusted host's reviewed sanitizer may supply intake bytes. As with the Engine, runtime database credentials and transaction-local principals are trusted host capabilities, never browser credentials. Malicious hosts/superusers can impersonate users, disable protections or forge consistent data; self-stored SHA-256 is not independent publisher authenticity or tamper-proof custody.

Per organization, **all retained states count** toward **16 assets / 2 MiB**. Ordinary commands have 128 receipts; 32 additional slots are reserved for explicit unselect/release/retire/block handling (at most two terminal cleanup steps per retained asset). These counters persist across reconnection/restart. Retirement does not refund bytes, counts or receipts. At exhaustion, refuse and require future reviewed retention work; do not drop/overwrite rows to continue.

## Explicit lifecycle

Every command binds version 1, organization, exact organization revision, operation UUID, asset UUID and exact asset revision. `change` accepts only `select`, `unselect`, `release`, `restore`, `retire`, `block`. Creation starts `stored`; callers cannot choose an ID or invent an initial state.

| Current state | Explicit supported next action | Meaning |
| --- | --- | --- |
| Stored | Select, release, block | Selection is a future local association only; no published configuration changes |
| Selected | Select a different stored asset, or unselect | Atomic replacement marks the old image superseded; unselect marks it unreferenced |
| Superseded | Release or block | Earlier bytes and assignment history remain retained |
| Unreferenced | Restore to stored, retire, block | Metadata identifies eligibility for future review at 30 elapsed days; no deletion occurs |
| Retired / blocked | Inspection only | Terminal in this phase; retrieval/selection/restoration refuse; bytes remain retained |

Unselect before retiring/blocking a current selection. No operation silently detaches a published reference (none are supported). Unreferenced/retired labels are **not proof that physical deletion is safe**. Historical and future references, retention approvals, backup consistency and secure disposal need a separate design. No physical purge, overwrite, automatic cleanup job or quota-reset command is implemented.

Identical **committed** retries return the original receipt without another asset/history change. Different actors/payloads with the same scoped operation ID refuse. A receipt records the earlier result, not current live selection; refresh `snapshot` afterward. Failed transactions leave no partial asset/selection/history/receipt. If commit outcome is uncertain, retry the exact operation first; never change its payload or assume failure means it did not commit. New explicit operations require refreshed revisions. Input decoding failures create no database state.

## Persistence, native backups and quarantine

Native PostgreSQL backups intentionally include **private PNG content, retained/retired images, selection cursors, immutable history and receipts**. Protect them as private business data; this is distinct from safe configuration/report export. Existing session/verification/pending-approval exclusions and post-restore purging remain unchanged. The closed readiness inventory now requires migration 13 and the four tables; older evidence/copy roots must be refreshed explicitly. Internal native HMAC comparison covers exact row bytes and ACL/column grants, never exports PNGs/digests/operational values in readiness reports. Existing 16 MiB serialized-row / 10,000-row-table / 50,000-total-row limits still refuse oversized labs; assets are not an exemption.

The new native suite checks independent application process exit/restart, reconnect, identical approved PNG retrieval, lifecycle/retries/concurrency, scopes/roles/revocation, quotas, corrupted content, failed commands, unchanged Engine records/history, and a guarded same-schema native round-trip. The restored copy is inspected by trusted offline maintenance only. Both normal adapter attachment and asset SQL entry routines must remain activation-blocked. Source configuration, customers, audits and histories are compared unchanged. Successful image preservation is **not** recovery acceptance, schema-transformation safety, encryption/off-device retention, cluster failover or production activation.

Run the existing [disposable network-test setup](postgres-setup.md#run-the-network-tests), then:

```sh
npm ci
npm run check
npm run test:postgres -- tests/postgres/private-logo-assets.test.ts
npm run test:postgres
npm run test:e2e
```

No native test silently skips without `LMS_TEST_ADMIN_URL`. Only randomly generated test databases created by the suite are dropped in test cleanup; the storage library itself never drops or deletes databases/assets. Do not run these tests on a shared/production cluster.

## Public demo, inspection and future protocols

The public Brand Your Business controls still say **temporary/session-only**, including Save My Logo and unsigned companion inspection. They never load the durable store or read its environment/trust. Its embedded schema does not install migration 13. No public-persistent image route, Next optimizer, remote URL, SVG input or wider CSP is introduced.

A **test-only presentation fixture** renders synthetic sanitized pixels with the existing `BusinessIdentity`/logo components, light/dark colors, responsive layout and broken-image fallback. Browser route interception exists only inside that test; the underlying app still returns unauthorized for the UUID. It is not an authenticated native-storage UI, public feature flag or database activation/attachment. Real native bytes/persistence are independently verified by PostgreSQL tests; screenshots must not be represented as end-to-end production transport acceptance.

BusinessConfig 1/2, BuildPlan JSON 1/2, Blueprint ZIP 1/2, detached publisher attestation 1 and Logo Companion 1 retain their existing formats and validation. No asset ID, private URL or PNG bytes is inserted in them. A future **explicitly versioned** branding/configuration/package protocol must bind immutable image descriptors/digests, reviewed image-bearing publisher payloads, destination re-sanitization/authorization, reference tracking, publication/rollback, transfer mappings and retention. Existing blueprint signatures never authenticate an independent image/companion. Durable production identity/session/transport acceptance, rate limiting/codec isolation, encrypted/off-device backups, physical retention/disposal and real-user provisioning are separate future work.

[Actual verification and screenshots](durable-private-logos-verification.md) · [Original sanitizer](private-logos.md) · [Portable companion](logo-companions.md) · [Security](../SECURITY.md)
