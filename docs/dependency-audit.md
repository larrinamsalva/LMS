# Dependency and license audit

Reviewed 2026-10-31. Upstream source and lockfile are pinned to ForgeOS `5831e20023c8f2f1e7269bbfb63b6ba0f21ee3b8`. MIT allows reuse with its notice; it does not relicense third-party packages. This is a source/metadata audit, not a legal opinion or assurance of vulnerability absence.

## Upstream direct dependencies

| Package(s) | Locked version(s) | Declared license | LMS decision |
| --- | --- | --- | --- |
| next | 16.4.2 | MIT | Use separately pinned 16.4.3 patch |
| react, react-dom | 19.3.1 | MIT | Retain compatibility |
| zod | 4.6.7 | MIT | Strict runtime validation |
| @supabase/ssr, @supabase/supabase-js | 0.12.7, 2.118.0 | MIT | Defer optional adapter |
| tailwindcss, @tailwindcss/postcss | 4.3.3 | MIT | Omit; simple CSS tokens |
| lucide-react | 1.60.0 | ISC | Omit; no icon dependency needed |
| pdf-lib, @pdf-lib/fontkit | 1.17.1, 1.1.1 | MIT | Defer PDF module |
| @fontsource/noto-sans | 5.2.10 | OFL-1.1 | Omit; system fonts |
| @electric-sql/pglite | 0.5.10 | Apache-2.0 | Independently pin 0.5.14; embedded PostgreSQL for demo/tests |
| @playwright/test | 1.64.1 | Apache-2.0 | Responsive browser checks |
| @axe-core/playwright | 4.14.0 | MPL-2.0 | Development accessibility checks only |
| typescript | 6.0.3 | Apache-2.0 | Strict type checking |
| vitest | 5.0.5 | MIT | Unit and SQL integration checks |
| @types/node, @types/react, @types/react-dom | 22.20.5, 19.3.0, 19.3.0 | MIT | Development types |
| eslint, eslint-config-next, prettier, supabase CLI | 10.13.0, 16.4.2, 3.9.10, 2.121.0 | MIT | Omit initially; typecheck/tests/build and formatting conventions |

## Upstream transitive findings

The upstream lockfile has 523 package entries (including platform optional packages). Licenses include MIT, ISC, Apache-2.0, MPL-2.0, LGPL-3.0-or-later, OFL-1.1, CC-BY-4.0, BSD-2/3-Clause, CC0-1.0, BlueOak-1.0.0, Zlib and 0BSD. `@img/sharp-libvips-*` and several `@img/sharp-*` platform packages carry LGPL terms. `lightningcss` and `axe-core` carry MPL; `caniuse-lite` declares CC-BY-4.0. These are not converted to MIT by the project license. Next.js itself may bring sharp/libvips transitively even though this foundation does not use image processing. Distribution must retain package notices and satisfy applicable source/relinking obligations for included binaries; container/binary packaging remains a release gate.

## LMS audit procedure

`npm run licenses` generates `docs/dependencies.json` from the exact committed lockfile, including name, version, integrity and license. `npm run licenses:check` rejects missing/unrecognized license declarations and stale inventory; it is not legal compatibility certification. Installed npm packages retain their own LICENSE/NOTICE files. Development dependencies and optional platform packages are included in the inventory, clearly marked. Run `npm audit` against the current registry and record results in `docs/verification.md` before review. Do not silently upgrade major versions or copy the upstream lockfile.

LMS runtime has no Supabase client, payment provider, AI provider, analytics, remote fonts or mandatory subscription. No outbound business integration exists. Network access is needed to install dependencies and browser test binaries, not to operate the demo afterward.

## Durable PostgreSQL phase

Added exact versions `pg` 8.23.1 (MIT), `@types/pg` 8.23.1 (MIT, development) and `tsx` 4.23.15 (MIT, development). The regenerated lockfile inventory includes all new transitives and optional build-tool binaries. No cloud database SDK, provider, payment or AI dependency is added. The official PostgreSQL Docker image/client tools are separately installed local/CI prerequisites; preserve their upstream notices when distributing a combined package. See the separate PostgreSQL verification record for current checks and limits.
