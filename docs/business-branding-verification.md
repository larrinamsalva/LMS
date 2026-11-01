# Business branding verification

PR #17 adds a validated presentation extension, reviewed tokens/marks and explicit version compatibility. Applied SQL 1–11, identity/recovery/lineage/checkpoint logic and operational module contracts are unchanged. Existing native upgrade tests add migration 12 to expected histories; the intentional post-migration failure moves from 12 to 13 so it still exercises a real failed transaction rather than duplicate-version rejection.

## Coverage

- Seven unit cases cover all eight light/dark palette variants and contrast pairs, all reviewed marks, unsafe branding fields/markup/URLs/CSS/SVG, explicit schema/BuildPlan pairings, unchanged operational impact, detached Gallery copies, branded JSON/ZIP round trips, repaired-hash tampering and exact legacy PR16 package bytes.
- Shared embedded/native assertions cover branded draft revisions, concurrent stale edits, exact retry audits, role rejection and organization isolation; explicit publication, concurrent publication fencing and rollback to branded or legacy revisions retain customers, stock records/balances/movements, employee allocations and estimate history.
- Direct SQL cases reject unsafe branding, unknown versions, injected fields and version mismatches without residual writes. New private helpers receive no runtime execution access. Native tests additionally check migration-11 host refusal, missing-migration errors, failed migration-12 rollback, unchanged historical data after upgrade, restart durability and native backup/restore of v1/v2 drafts and branding with activation still blocked.
- Two browser flows run on desktop/tablet/phone: customize Gallery branding, inspect all palettes in both sample modes, reject markup, try the actual branded Engine workspace, save/reopen drafts, export/reimport JSON and package, preserve original workspace on import, and explicitly publish/restore compatible branding while retaining records and another organization's appearance. Axe, keyboard confirmation and no horizontal overflow checks remain enabled alongside all existing suites.

## Reproduce and evidence

```sh
npm ci
npm run check
npx playwright install --with-deps chromium
npm run test:e2e
# With the disposable fictional PostgreSQL control and native tools from docs/postgres-setup.md:
npm run test:postgres
```

Native tests do not skip when prerequisites are missing. The existing quality workflow runs foundation, PostgreSQL and browser jobs. [PR #17 checks](https://github.com/larrinamsalva/LMS/pull/17/checks) and its description record the actual final source commit, results, counts and environment limits; network evidence is distinguished from local PGlite results.

Local Node 24.22.1 results:

| Check | Actual result |
| --- | --- |
| `npm run check` | 139 tests in 25 files; TypeScript, production build and 188 dependency license declarations passed |
| Full browser regression suite | 45 passed (4.1 minutes): all 39 prior cases plus six branding viewport cases |
| Final branding layout/monogram controls | Six desktop/tablet/phone flows passed (51.8 seconds), including wide four-character initials and all light/dark palette samples |
| Final production build | Passed after the layout changes |
| Standard ZIP inspection | `unzip -t` passed for both a generated branded v2 package and the frozen v1 fixture |

Local browsers used temporary Chromium 153.0.8010.0 through the existing executable override. Final Studio controls, desktop preview and phone dark preview were visually inspected. The screenshots are from the running fictional application, not generated mockups. GitHub CI uses normal Playwright Chromium and reruns the full final source; exact run/job results are maintained in PR #17's description. Native PostgreSQL is unavailable locally: network migration/concurrency/backup claims require the actual GitHub PostgreSQL job, not inference from embedded tests.

No external accessibility audit, physical-device acceptance, authenticated publisher, production deployment or security activation is claimed.
