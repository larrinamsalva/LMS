# LMS — Living Management System

**One engine. Any business. Your data. Your control.**

An MIT-licensed, independent open-source foundation for small-business management software. Inspired by [ForgeOS](https://github.com/larrinamsalva/ForgeOS-Property-Manager); ForgeOS is unchanged. No mandatory cloud account, subscription, payment processor or AI service.

## What works in this foundation

- One TypeScript engine and one responsive React workspace render **Property Manager** (customers, sites/units, maintenance tasks, supply catalog) and **Cleaning Company** (customers, cleaning jobs, service dates, crew notes, tasks, supply catalog).
- Configuration-generated forms with strict validation; create, edit, search, archive and restore operational records.
- Reviewed, versioned module manifests with dependency checks; disable modules while retaining data.
- Versioned business configuration: edit name/terminology/navigation, publish with conflict checks and roll back by appending a revision.
- Actual embedded PostgreSQL row-level security, organization memberships and owner/admin/staff/viewer roles. Tests attack the database directly, independent of the UI.
- Append-only database audit history; project JSON and organization-scoped workspace exports.
- Accessible light/dark themes, phone layout and no-login **fictional-data-only** demo.

This is a working foundation, **not production business software**. Scheduling conflict protection, staff administration UI, service pricing/quotes, stock ledgers, invoices, documents, complete production recovery/import, workflow automation, the guided builder and deployment/export packaging are [later stages](ROADMAP.md). No live financial, messaging, payment or AI action is implemented.

## Run locally

Requires Node.js **22 or newer** (verified on Node 24), npm and about 1 GB of free memory. Install requires network access; the demo uses no external service after dependencies are installed. Commands run from the repository root:

```sh
git clone https://github.com/larrinamsalva/LMS.git
cd LMS
npm ci
npm run dev
```

Open **http://127.0.0.1:3000**, then choose **Explore the working demo**. Switch between the two businesses using **Business workspace**. Add a made-up customer, refresh, then explore **Project & modules** to disable the supply catalog, apply, and restore a revision. The same engine handles both workspaces.

The public demo needs no environment file, database account or Docker. The default embedded PostgreSQL database is in memory, **resets on server restart**, and is not a backup. Each browser receives separate fictional organizations; sessions expire after two hours. The process caps active sessions at 24, records at 250 per workspace, and config revisions at 40. Export anything you want to keep before expiry/restart. Do not enter real personal or business information.

For a production-mode **local demo**:

```sh
npm run build
npm start
```

Both commands bind to loopback by default. Publishing this single-process demo needs separate operational review, HTTPS, an exact `LMS_APP_ORIGIN` matching the public origin, resource/rate limits and a persistent shared session design. Nothing here deploys automatically or connects a production database. Real-business hosting remains gated on verified identity/session security, complete recovery acceptance and access-control review. The experimental PostgreSQL adapter is available only to trusted host code and maintenance commands.

## Experimental durable PostgreSQL

A separate host-only PostgreSQL adapter now implements the existing engine interface. It adds a bounded pool, checked runtime roles, transactional checksum migrations, Docker Compose storage and native backup/restore commands. **The no-login website still uses its own temporary database.** No persistent business HTTP endpoints are exposed.

Follow [the local PostgreSQL setup and recovery rehearsal](docs/postgres-setup.md). Setting up this optional backend does not enable authenticated HTTP business routes or authorize real business use. See [migration rules](db/README.md) and [network verification results](docs/postgres-verification.md).

## Experimental local authentication

The separate [local identity adapter](docs/local-auth.md) adds Better Auth password sign-in and revocable PostgreSQL sessions for provisioned fictional accounts. It is **host-only and unmounted**: the demo still opens without login, and persistent business routes remain closed. It includes separate runtime credentials, private identity tables, database throttling and recovery that does not revive old sessions. See [verification and remaining gates](docs/local-auth-verification.md).

## Experimental owner access

The [owner access host API](docs/owner-access.md) adds session-bound reviewed role changes, removal and atomic ownership handover, with durable audits and confirmation receipts. A guarded local command can create a new fictional workspace for a provisioned owner. It remains **host-only**: no staff UI, real-user invitations or business routes are exposed. See [verification and recovery limits](docs/owner-access-verification.md).

## Experimental account lifecycle

The [host-only password-change API](docs/account-lifecycle.md) verifies the current password, requires a sign-in within five minutes, revokes all account sessions/approvals and records a secret-free credential event atomically. Owner access commands use the same recent-authentication rule. The [lost-access recovery plan](docs/local-recovery-plan.md) is design only; no reset/deletion tool or public route is enabled. See [verification and limits](docs/account-lifecycle-verification.md).

## Verify

```sh
npm run check
npx playwright install --with-deps chromium
npm run test:e2e
```

Browser tests use a **production build**, started automatically on loopback port 3100, with desktop and phone Chromium projects. `npm run check` includes type checking, unit and real-SQL integration/security tests, dependency inventory verification and the production build. `npm audit` is a separate current-registry check. If browser downloads are restricted, `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/to/chromium` selects an installed Chromium; report its version when using this override. Never call unrun checks passing.

## Architecture and extension points

| Path | Purpose |
| --- | --- |
| `src/core/config.ts` | Versioned config/field schemas and record validation |
| `src/core/engine.ts` | Framework-independent engine API and SQL adapter interfaces |
| `src/modules/registry.ts` | Explicit reviewed manifest registry (API v1) |
| `src/presets/index.ts` | Property and cleaning configuration plus fictional fixtures |
| `src/components/` | Shared generated forms, workspace and minimal config editor |
| `src/server/` | Temporary demo adapter/sessions and separate host-only PostgreSQL adapter |
| `src/app/api/demo/route.ts` | Bounded same-origin demo transport; no real-business routes |
| `db/001_foundation.sql` | RLS, memberships, immutable record scope and audit triggers |
| `examples/` | Reusable validated configuration and manifest examples |

To add operational records, use the `custom-records` manifest and a `custom-` entity ID, define fields, enable the module and add the entity to navigation. Existing populated field schemas require a reviewed migration; renaming a field must not silently orphan data. New executable modules require code review, explicit capability contracts and tests. No arbitrary plugins or configuration-supplied scripts are executed.

Read the [architecture](docs/architecture.md), [API contracts](docs/api.md), [file-level extraction assessment](docs/extraction-assessment.md), [dependency/license audit](docs/dependency-audit.md), [verification evidence](docs/verification.md), [staged plan](docs/implementation-plan.md), [security policy](SECURITY.md) and [contribution guide](CONTRIBUTING.md).

## License and attribution

LMS is [MIT licensed](LICENSE), copyright 2026 Larrina Salva. The bounded request-body reader is adapted from ForgeOS at commit `5831e20023c8f2f1e7269bbfb63b6ba0f21ee3b8`; its [original MIT notice](third-party/ForgeOS-LICENSE.txt) is retained. All other foundation implementation is new. Dependencies keep their own licenses, including Apache-2.0, MPL and LGPL components; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The project license does not replace their obligations.
