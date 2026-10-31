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
