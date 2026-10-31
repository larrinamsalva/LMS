# Third-party notices

The LMS project is MIT licensed. Dependency licenses remain independent.

## ForgeOS

`src/server/request-body.ts` is adapted from `src/lib/request-body.ts` in [ForgeOS-Property-Manager](https://github.com/larrinamsalva/ForgeOS-Property-Manager) at `5831e20023c8f2f1e7269bbfb63b6ba0f21ee3b8`. Copyright (c) 2026 Larrina Salva. Its complete MIT notice is preserved in [third-party/ForgeOS-LICENSE.txt](third-party/ForgeOS-LICENSE.txt). Other source files in this foundation are independently written; architectural inspiration is documented in the extraction assessment.

## Dependencies

See [docs/dependencies.json](docs/dependencies.json) for the exact lockfile inventory and [docs/dependency-audit.md](docs/dependency-audit.md) for the review. Installed dependencies include their LICENSE/NOTICE files. Do not strip these when distributing source installations or application bundles. PGlite (Apache-2.0) embeds PostgreSQL; preserve the package's notices and bundled PostgreSQL notices. Playwright/TypeScript use Apache-2.0; axe accessibility tooling includes MPL-2.0 code.

Next.js has optional sharp/libvips platform dependencies carrying LGPL-3.0-or-later (some with combined expressions), even though this app does not use image transforms. Source/Binary redistribution must satisfy their notice, source availability and applicable replacement/relinking requirements. This PR supplies a source installation and dependency metadata, **not a certified redistributable container/binary package**. Packaging/source offers must be reviewed before a packaged release. Other transitives include MIT, ISC, BSD and related permissive terms; their actual notices remain authoritative.

The durable adapter adds `pg` (MIT) and development-only `@types/pg` (MIT) and `tsx` (MIT; esbuild transitives MIT). PostgreSQL/Docker images and installed native client tools are external prerequisites with their own upstream notices, not relicensed or bundled by LMS. The exact npm additions appear in the regenerated dependency inventory.

The local identity foundation uses Better Auth 1.7.14 (MIT) and Kysely 0.29.7 (MIT). Its core table contract informs migration 2; package notices remain authoritative. Better Auth telemetry is disabled, and no hosted identity account, external provider or email delivery is provisioned.
