# Native Upgrade Readiness verification

PR #21 adds a host-only coordinator using the existing native archive utilities. No public route/UI, historical SQL/checksum, service grant, activation control, BuildPlan/package protocol, Gallery registry, operational Engine rule or ForgeOS source changes.

Coverage: strict local/role/database allowlisting; private trust files; complete organization evidence; immutable migration/configuration versions; source maintenance fencing; busy/populated/wrong destinations; successful native same-schema copies; source/history preservation; unavailable/cross-organization RLS; session purge; continued business/auth activation refusal; corrupt/truncated archives; interruptions; competing writers/coordinators; altered restored data; cleanup failures and refused reuse. Unit tests verify an interrupted child exiting zero still fails and is stopped before deleting its partial file.

The successful native fixture contains both property and cleaning module records, archived customers, scheduling/resource/employee assignments, exact stock and estimate snapshots, v1/v2 configuration/draft history and fictional credentials. Source values/hashes/tokens are not report payloads. Fault injection uses only trusted test tooling and newly minted random test databases. Test cleanup drops only databases it created; product tooling never drops them.

```sh
npm ci
npm run check
npx playwright install --with-deps chromium
npm run test:e2e
# Disposable PostgreSQL 16/native tools and LMS_TEST_ADMIN_URL:
# docs/postgres-setup.md
npm run test:postgres
```

Actual final-source results and workflow/job links are recorded in [PR #21](https://github.com/larrinamsalva/LMS/pull/21) and [its checks](https://github.com/larrinamsalva/LMS/pull/21/checks). Local native PostgreSQL/Docker are unavailable; unit/PGlite results are never claimed as a native restore. Real proof requires the unchanged PostgreSQL 16.15 CI job. All existing account/security/recovery/lineage/checkpoint, business-module, Studio/Gallery/package/branding/template/impact/rehearsal regressions remain enabled.

No real-data migration, external identity/credential-freshness acceptance, production recovery, schema transformation, power-loss certification, native activation, signed approval or deployment is claimed. Native report success never changes Studio's missing business-specific backup evidence. [Trust assumptions and workflow](native-upgrade-readiness.md).
