# Private logo association v1

This host-only fictional PostgreSQL contract connects an explicitly reviewed retained PNG to **one exact published branded configuration revision**. It is not a portable BusinessConfig field, a public image endpoint or production media acceptance. Uploading/selecting an asset still does not associate or publish it. The public no-login demo remains temporary and unchanged.

## Prerequisites and authority

Use the existing [durable private store](durable-private-logos.md), literal-loopback fictional source allowlist, private process-owned trust file, restricted runtime login and online/recovery lease. Verify the lab's provenance before enrolling it; a database name or fictional-domain email is insufficient. Stop hosts, protect a native backup, inspect pending migrations and explicitly apply additive **migration 14** with the existing `db:migrate` tooling. No previously applied SQL/checksum changes, automatic upgrades, restore acceptance or force-unblock option are introduced. The original asset methods still support migration 13; association methods require 14.

Resolve a **fresh current principal through the existing local identity/session adapter before every host operation**, including confirmation and retrieval. A caller-supplied UUID is not authentication. This SDK reuses Engine role/context, SQL membership checks and current asset trust; it neither authenticates a public request nor provides a second identity/permission model. Native fixture principals are reviewed synthetic tooling, not real-user session acceptance. Owner/admin authority is required for review, mutation and history. Current organization members can inspect/read only the eligible current association through guarded SQL functions; possession of an asset UUID, old review or receipt grants no access.

## Workflow

The existing `openPrivateLogoStore` now exposes `.associations` without another connection/trust backend:

```ts
// Trusted host integration only. Never mount this as a public handler.
const principal = await localAuth.principal(currentHeaders);
if (!principal) throw new Error("Current verified local identity required");
const store = await openPrivateLogoStore({ databaseUrl, trustFile });
try {
  // First store, inspect and explicitly select a PNG using the existing asset API.
  const review = await store.associations.review(principal, organizationId, {
    mode: "image", display: "rectangle", historyRevision: null,
  });
  // Show the reviewed image, current config palette/revision and association revision.
  // Ask for explicit confirmation in the trusted host. Resolve a fresh principal again.
  const confirmedPrincipal = await localAuth.principal(confirmationHeaders);
  if (!confirmedPrincipal) throw new Error("Current verified local identity required");
  await store.associations.apply(confirmedPrincipal, organizationId, {
    format: "lms-private-logo-association-command", version: 1,
    operationId: crypto.randomUUID(), review, confirmed: true,
  });
  const result = await store.associations.read(confirmedPrincipal, organizationId);
  // Only status=active supplies logo bytes; otherwise show the built-in identity.
  // Do not log/serialize image bytes. Release the returned private copy after inspection.
  result.logo?.bytes.fill(0);
} finally { await store.close(); }
```

Review is data, **not a signed approval or authorization token**. The host must actually present it and obtain deliberate confirmation; `confirmed: true` is not proof of a human click. SQL reconstructs every review fact with current authority before committing. The host adapter reruns the complete existing `validateConfig` reader inside that same transaction while the operation holds the publication lock; malformed stored configuration rolls back all pending association, cursor, receipt and audit effects. SQL branding/storage checks are not a second complete module validator. Review and commit both require exact organization, actor, published revision/configuration fingerprint, asset selection cursor, selected asset ID/revision/digest, association cursor and contained layout. A stale or mismatched review refuses; refresh and confirm deliberately. The configuration fingerprint is SHA-256 of PostgreSQL's UTF-8 `jsonb::text` representation in the supported same-schema PostgreSQL environment, not a new portable encoding or independent tamper anchor.

`inspect` returns the existing validated configuration (including palette), association metadata and eligibility status. `read` returns a private byte copy only for an active eligible image, using the **same pinned sanitizer and shared two-slot processing gate** as ordinary stored-image reads. It verifies digest/size/profile and rechecks membership, asset state, association/configuration revisions after native work. On authorization, corruption or a mid-read state change, refuse and let the host render the built-in mark; do not expose diagnostics or cached pixels. Already delivered pixels cannot be recalled from a compromised client/host.

To revert, review `{mode:"builtin",display:null,historyRevision:null}` and explicitly apply a new command. The old image/history is retained. For historical restoration, inspect `.history`, explicitly restore/select the same retained image using existing asset transitions, then review `{mode:"image",display:"square",historyRevision:oldRevision}` against the **current** configuration and current asset revision. This appends a new association with `restoredFrom`; it never resets a pointer or silently revives a blocked/retired asset. An unavailable historical image refuses.

## Eligibility and rollback

| Situation | Result |
| --- | --- |
| Sanitized PNG stored or selected, no binding | Built-in identity; no publication |
| Explicit association to current branded schema-2 revision | Eligible private image |
| A different image merely uploaded/selected | Previous associated image remains eligible while retained and valid; no implicit replacement |
| Configuration publication, including compatible palette/label changes | Old image association becomes ineligible; built-in fallback until fresh review/binding |
| Configuration rollback to identical historical JSON | A **new** configuration revision; no image resurrection; fresh review/binding required |
| Explicit built-in association | Built-in mark; all earlier history remains |
| Asset blocked, retired, missing, damaged or unsupported codec | Refuse/read unavailable or built-in status; never serve unchecked bytes |
| Restored database | Existing recovery quarantine remains; no runtime attachment |

The approved asset revision references immutable **selected-state history**, not an indefinitely frozen selection cursor. Subsequent selector changes can supersede/unreference that asset without changing approved pixels. The current bytes/digest must remain identical, the approved history must exist, and current state must not be blocked/retired. Unreferenced is a lifecycle label, **not absence of historical references**. Any historical association prevents retirement; physical purge, overwrite and quota refunds remain unsupported. Blocking remains possible after explicit unselection, so unsafe pixels can be made unavailable without erasing history.

Existing Engine configuration validation, explicit publication permissions, impact checks, populated-schema migration blockers and rollback rules remain authoritative. Association operations never publish a configuration, mutate business rows, save a BuildPlan or migrate a schema. Schema-1 configurations remain unbranded; image binding refuses rather than upgrading them.

## Database contract and concurrency

`lms-private-logo-association` version 1 records organization, association revision, configuration revision/fingerprint, mode, exact asset ID/approved revision/digest (or all-null built-in), reviewed square/rectangle layout, actor, operation UUID, optional historical source revision and timestamp. It is installation-local private metadata. `src/core/logo-associations.ts` strictly validates the review, explicit command, association/history and inspection envelopes.

Three new forced-RLS tables are included in native backup inventory:

| Table | Purpose |
| --- | --- |
| `lms.logo_associations` | Append-only reviewed associations; scoped configuration, historical asset revision, receipt and self-history foreign keys |
| `lms.logo_association_states` | Organization-wide optimistic concurrency cursor, initialized at zero before a first binding |
| `lms.logo_association_receipts` | Append-only actor/request-digest/result receipts |

The app role has SELECT under RLS and no direct INSERT/UPDATE/DELETE/TRUNCATE. No new raw-image grant is added. Security-definer entry routines have fixed empty search paths, existing online/fictional/instance/membership checks and closed operation vocabulary. Configuration insertion now acquires the organization lock **before** the existing record-epoch trigger, including restricted direct SQL. Association/asset operations use the same organization-first order; existing membership/record epochs, asset selection/history and association cursor locks reject stale read-committed and repeatable-read writers. Migration 14 initializes a zero cursor for every existing organization under an offline organization-table lock, and a narrow insert trigger initializes future organizations. Before retirement, the reference guard locks this real cursor: a repeatable-read snapshot older than even the **first** binding refuses instead of treating an invisible new history row as absence of references. Missing cursors refuse; the association operation never silently recreates them. History, cursor, receipt and a minimal secret-free event in the existing immutable audit table commit atomically. Audit payloads exclude image bytes, image hashes and configuration documents.

Exact committed retries by the same current authorized actor return their original receipt before stale review checks, without another history/audit event. Conflicting payloads/actors refuse. A receipt is an earlier result, not continuing eligibility: refresh `inspect`. If commit outcome is uncertain, retry the **identical** operation; do not alter its payload. Failed transactions leave no partial binding, receipt, history or audit. There are 128 ordinary association records plus one reserved final built-in fallback; exhaustion refuses and requires future retention review. Counters never reset on restart or retirement.

## Persistence, backup and inspection

Native backups now retain all three association tables alongside PNGs, approved asset history, receipts, configurations and audits. The existing closed native inventory verifies exact rows privately (HMAC), scoped counts, schema/constraints, policies and grants. No image IDs, digests, pixels or operational values appear in readiness reports. Existing backup bounds and session/approval purging still apply; refresh older readiness evidence explicitly. This is same-schema fictional preservation, **not** proof of a schema transformation, ordinary configuration rollback, recovery acceptance or production activation. The restored copy stays quarantined under existing database settings, control state and runtime/SQL refusals.

The test-only browser inspection harness renders synthetic response fixtures with the existing branding identity, contained layouts, light/dark palettes and unavailable-image fallback at desktop/tablet/phone widths. It installs no application route or durable HTTP loader; browser-only interception supplies the synthetic PNG. Native PostgreSQL tests separately establish actual durable bindings/restarts/restoration. Screenshots demonstrate presentation/accessibility, not end-to-end persistent transport/session acceptance. A trusted host must provide a separately reviewed private local transport before serving these bytes interactively; this PR intentionally supplies no public persistent logo route.

## Compatibility and future work

BusinessConfig 1/2, BuildPlan JSON 1/2, Blueprint ZIP 1/2, detached attestation 1, Logo Companion 1 and the temporary public demo are unchanged. Asset IDs, private references and image bytes are **never** injected into these formats. A future explicit portable branding/package version must define image descriptors and canonical signed coverage, transfer mappings, destination authorization/re-sanitization, independent freshness/retirement, publication/rollback and retained references. A signature on an existing blueprint **does not authenticate a separate logo**.

Superusers/trusted compromised hosts can impersonate callers or alter consistent data. Database-local digests/history are not independent tamper evidence, publisher authenticity or rollback protection against all trust anchors. Durable real-user identity/session/transport acceptance, distributed rate limiting, codec isolation, encrypted/off-device backups and destructive retention/disposal remain separately reviewed future phases. Recovery/lineage/checkpoint activation blockers remain intact.

[Verification evidence](private-logo-associations-verification.md) · [Native readiness](native-upgrade-readiness.md) · [Security](../SECURITY.md)
