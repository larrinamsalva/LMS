# Native upgrade blueprint verification

PR #22 adds descriptive design reports and a host-only private copy lifecycle. It reuses existing Engine impact/permission/version checks, PR #21 native trust/backup/restore/quarantine inspections and the existing Linux private-file/lock/sync primitives. There are no historical SQL/checksum, service-grant, public route/UI, package protocol, template registry, license or ForgeOS modifications.

Unit cases cover descriptive vocabulary, archived/populated blockers, strict unsupported requests, private immutable journal/pin validation, pending interruption, incomplete native evidence and logical retirement. File-protocol tests use explicit native/Engine test doubles; they are not native restore proof. Real PostgreSQL cases separately exercise prepare/copy/inspect/retire, unchanged source/copy configuration, legacy/branded proposals, archived records, stale draft/config revisions, wrong actor/organization/destination identity, edited copies, interrupted checkpoints, competing operations, corrupt archives and missing/unknown history. Existing native backup/security/recovery and module suites remain enabled.

```sh
npm ci
npm run check
npx playwright install --with-deps chromium
npm run test:e2e
# Disposable PostgreSQL 16/native tools per docs/postgres-setup.md:
npm run test:postgres
```

Actual final-source counts and workflow/job links are recorded in [PR #22](https://github.com/larrinamsalva/LMS/pull/22) and [its checks](https://github.com/larrinamsalva/LMS/pull/22/checks). Local native PostgreSQL/Docker are unavailable. Native evidence comes from PostgreSQL 16.15 CI, never PGlite or test doubles. Existing foundation, security/recovery/lineage/checkpoint, scheduling/workforce/pricing/inventory, Studio/Gallery/packages/branding/template/impact/rehearsal regressions run unchanged.

No transformation, migration execution, retained rollback archive, external identity/credential acceptance, physical destructive retirement, signed/monotonic approval, production activation, deployment or physical power-loss certification is claimed. [Workflow and failure model](native-upgrade-blueprints.md).
