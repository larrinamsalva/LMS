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

This is a working foundation, **not production business software**. Scheduling conflict protection, staff administration, service pricing/quotes, stock ledgers, invoices, documents, complete backups/import, workflow automation, the guided builder and deployment/export packaging are [later stages](ROADMAP.md). No live financial, messaging, payment or AI action is implemented.

## Run locally

Requires Node.js **22 or newer** (verified on Node 24), npm and about 1 GB of free memory. Install requires network access; the demo uses no external service after dependencies are installed. Commands run from the repository root:

```sh
git clone https://github.com/larrinamsalva/LMS.git
cd LMS
# Before the foundation PR is merged:
git switch feat/configurable-foundation
npm ci
npm run dev
```

Open **http://127.0.0.1:3000**, then choose **Explore the working demo**. Switch between the two businesses using **Business workspace**. Add a made-up customer, refresh, then explore **Project & modules** to disable the supply catalog, apply, and restore a revision. The same engine handles both workspaces.

No environment file, database account or Docker is needed. The default embedded PostgreSQL database is in memory, **resets on server restart**, and is not a backup. Each browser receives separate fictional organizations; sessions expire after two hours. The process caps active sessions at 24, records at 250 per workspace, and config revisions at 40. Export anything you want to keep before expiry/restart. Do not enter real personal or business information.

For a production-mode **local demo**:

```sh
npm run build
npm start
```

Both commands bind to loopback by default. Publishing this single-process demo needs separate operational review, HTTPS, an exact `LMS_APP_ORIGIN` matching the public origin, resource/rate limits and a persistent shared session design. Nothing here deploys automatically or connects a production database. Real-business hosting is gated on identity, persistence, network PostgreSQL/concurrency and backup/restore acceptance.

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
| `src/server/` | Embedded database adapter and isolated fictional demo sessions |
| `src/app/api/demo/route.ts` | Bounded same-origin demo transport; no real-business routes |
| `db/001_foundation.sql` | RLS, memberships, immutable record scope and audit triggers |
| `examples/` | Reusable validated configuration and manifest examples |

To add operational records, use the `custom-records` manifest and a `custom-` entity ID, define fields, enable the module and add the entity to navigation. Existing populated field schemas require a reviewed migration; renaming a field must not silently orphan data. New executable modules require code review, explicit capability contracts and tests. No arbitrary plugins or configuration-supplied scripts are executed.

Read the [architecture](docs/architecture.md), [API contracts](docs/api.md), [file-level extraction assessment](docs/extraction-assessment.md), [dependency/license audit](docs/dependency-audit.md), [verification evidence](docs/verification.md), [staged plan](docs/implementation-plan.md), [security policy](SECURITY.md) and [contribution guide](CONTRIBUTING.md).

## License and attribution

LMS is [MIT licensed](LICENSE), copyright 2026 Larrina Salva. The bounded request-body reader is adapted from ForgeOS at commit `5831e20023c8f2f1e7269bbfb63b6ba0f21ee3b8`; its [original MIT notice](third-party/ForgeOS-LICENSE.txt) is retained. All other foundation implementation is new. Dependencies keep their own licenses, including Apache-2.0, MPL and LGPL components; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The project license does not replace their obligations.
