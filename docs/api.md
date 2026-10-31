# API v1 contracts

## Core service (TypeScript)

`Engine` in `src/core/engine.ts` accepts a `SqlDatabase` with parameterized `query`, `exec` and transactional callback methods. The public demo uses embedded PostgreSQL (PGlite). The separate experimental node-postgres adapter in `src/server/postgres/adapter.ts` implements the same interface with a bounded pool, one checked-out connection per transaction, rollback, identity cleanup and dedicated network security/concurrency tests. It is host-only and has no business HTTP endpoint; see [PostgreSQL setup](postgres-setup.md).

`Principal { userId: UUID }` is **trusted server input**; never construct it from request JSON, organization selection or unsigned headers. The current HTTP transport constructs only fictional demo principals.

| Method | Input | Result / permission |
| --- | --- | --- |
| `snapshot` | principal, organization UUID | Config, active-module records, config history, role; member. Audit is owner/admin only |
| `saveRecord` | principal, organization, entity, data, optional `{id, revision}` | Created/updated validated record; owner/admin/staff. Existing revision required for edits |
| `archiveRecord` | principal, organization, record UUID, expected revision, archived boolean | Reversible archive/restore; owner/admin/staff |
| `publishConfig` | principal, organization, document, expected revision, optional restoredFrom | New integer config revision; owner/admin. Rollback must match a retained snapshot |
| `exportWorkspace` | principal, organization | Version 1 JSON config/history/all retained records, including disabled/archived; owner/admin |
| `asUser` | trusted principal, trusted SQL callback | Internal host/test boundary, **never** an endpoint for arbitrary client SQL |

Core errors distinguish unavailable scope (403), missing record/config (404), stale revision/capacity (409) and invalid input (400). Database failures are not converted to empty records/totals. JSON strings are plain text; React escapes them. Custom records do not provide relational foreign keys, stock ledgers or finance semantics.

## Configuration and module contract

`BusinessConfig` uses `schemaVersion: 1`, immutable project `id`/industry, display name, exact enabled module versions, entity definitions and navigation entity IDs. Each field has a safe key, label, type and required flag. Types are text, longtext, email, ISO civil date, nonnegative bounded number, and select with explicit unique options. Unknown keys and unsupported schema/module versions fail closed.

`ModuleManifest` declares id/version, engineApi, name/description, dependencies, provided entities and capabilities. A disabled module's entities remain defined but leave navigation; service CRUD refuses them and exports retain their data. Reviewed manifests are local code/data; installing arbitrary code is unsupported. The `custom-records` manifest accepts only `custom-` entity IDs. See `examples/` and validated presets.

Configuration rollback appends a revision and retains `restored_from`. There is no in-place rollback of data or schema. Populated entity field definitions, title field and module association cannot change without a separate reviewed migration; labels/name/navigation and module enabling can change safely.

## Fictional demo HTTP transport

All paths below are local `/api/demo`. Responses are private/no-store. GET requires a server-issued demo cookie; mutation JSON has an actual 64 KiB byte cap, exact same origin, strict schemas and no client-chosen identity. POST start requires no login and provisions only bounded fictional data; it never grants access to real businesses.

| Request | Body / query | Result |
| --- | --- | --- |
| POST | `{ "action": "start" }` | Start or resume current fictional session, HttpOnly cookie |
| GET | `?organizationId=UUID` (optional, defaults first) | `{session:{organizations,expiresAt}, workspace}` |
| POST | `{action:"save", organizationId, entity, data, existing?:{id,revision}}` | Refreshed session/workspace |
| POST | `{action:"archive", organizationId, recordId, revision, archived}` | Refreshed session/workspace |
| POST | `{action:"configure", organizationId, document, revision, restoredFrom?}` | Refreshed session/workspace |
| GET | `?organizationId=UUID&export=1` | Downloadable workspace JSON |

Errors are `{error:string}` with 400/401/403/404/409/413/415/503 as appropriate; internal database details are not returned. Unsupported actions (including invoice issuance, messages, payments and AI) are rejected. There are no real-business HTTP endpoints, production connections, hosted deployment adapters or import endpoint in this phase.

## Optional local identity host

The [local identity adapter](local-auth.md) can validate a distinct signed auth cookie against PostgreSQL and return a fresh verified Principal to trusted host code. It grants no organization membership and is not mounted in Next.js. The public demo API remains independent and persistent business paths remain absent. See the identity contract for strict handler allowlists, revocation, local throttling and remaining HTTP/recovery gates.

## Owner membership host

`AccessService(engine, auth.identity)` composes the existing database transaction boundary with a freshly verified session. Owner-only `snapshot` and `prepare` produce an organization-scoped roster and an expiring stored review. `confirm` requires the same session and explicit confirmation, rechecks database authorization, serializes on the organization and returns an idempotent audited receipt. Ordinary role changes cannot grant/remove owner; handover is atomic. See [exact schemas, setup, locking and recovery limits](owner-access.md). No access endpoint is mounted in Next.js.

## Credential lifecycle host

`createLocalAuth(...).changePassword(headers, input)` accepts only a new operation UUID, current/new password and explicit `CHANGE PASSWORD AND SIGN OUT`. Better Auth verifies the signed-cookie identity/current password and supplies hashing; PostgreSQL rechecks the matching recent session and expected credential, revokes all subject sessions/approvals, updates the password and appends an immutable event atomically. No replacement session is created. All owner commands now require a sign-in within five minutes. No HTTP/reset/deletion endpoint is added. See [inputs/errors/locking](account-lifecycle.md), [evidence](account-lifecycle-verification.md) and the [deferred recovery design](local-recovery-plan.md).

## Offline recovery maintenance

`OfflineRecovery({databaseUrl,databaseName,trustFile})` is a local administrator-only host/CLI boundary, never an HTTP handler. Strict `enroll`, `open`, `review`, `attest`, `apply` and read-only `verifyPassword` methods implement prior trust, two independent signatures, expiring one-use review and atomic reset/revocation/audit. Root file ownership, authority/cooling-off, offline locks and current credential/membership/instance versions fail closed. Recovered/restored databases remain activation-blocked. See [exact inputs, signing workflow, errors and remaining gates](offline-recovery.md).


## Offline lineage maintenance

`CredentialLineage({databaseUrl,databaseName,trustFile,journalFile,commitmentKeyFile,expectedCheckpointDigest?})` reuses the existing offline administrator lock/trust boundary. Strict `propose({mode:"genesis"|"advance",confirmation:"CAPTURE FICTIONAL LINEAGE FOR INDEPENDENT REVIEW"})` returns unsigned metadata/checkpoint material. `assess({confirmation:"ASSESS OFFLINE LINEAGE WITHOUT ACTIVATION"})` returns a consistency report and always `activationAllowed:false`. Neither method signs, publishes, updates a trusted receipt, revokes state or activates. The expected digest must come from independent latest-head custody. See [schemas, custody, signing purposes, CLI and failure behavior](credential-lineage.md). No HTTP method or module capability exposes this interface.


## Custodian publication API

`CheckpointPublisher({directory,trustFile,expectedRootDigest?})` runs on separate offline Linux custody storage with no database/HMAC/private signing key. `initialize(journal,input)` enrolls a new root using an independently reviewed checkpoint digest; `review(journal,input)` produces an expiring context; `publish(journal,input)` requires two purpose-specific signatures and confirmation; `resume(input)` completes only the exact unexpired intent; `verify(input)` requires an independently retained minimum receipt and returns the verified latest descendant/journal. Every result that reports activation says false. Strict schemas, durability sequence, custody separation, limits and CLI inputs are documented in [the publication contract](checkpoint-publication.md). No HTTP endpoint is added.
