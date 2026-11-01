# Services and estimates verification

PR #12 adds a bounded fictional USD catalog and internal estimate drafts through the shared engine. No production financial operation, public business route, invoice, payment, message or recovery activation is enabled.

## Verified source and checks

Implementation: [`2f42bfda96dc1f4921977c07368d77e4e97bc037`](https://github.com/larrinamsalva/LMS/commit/2f42bfda96dc1f4921977c07368d77e4e97bc037). All three jobs in [CI run 41259913549](https://github.com/larrinamsalva/LMS/actions/runs/41259913549) passed.

| Check | Actual result | Evidence |
| --- | --- | --- |
| `npm run check` | Type checking, **74 tests in 16 files**, **188** license declarations and production build passed | [Foundation job](https://github.com/larrinamsalva/LMS/actions/runs/41259913549/job/124710866059) |
| `npm run test:postgres` | **104 tests in 9 files**, including **11 new pricing cases**, passed | [PostgreSQL job](https://github.com/larrinamsalva/LMS/actions/runs/41259913549/job/124710866101) |
| `npm run test:e2e` | **24 tests**: 8 scenarios across desktop/tablet/phone, passed | [Browser job](https://github.com/larrinamsalva/LMS/actions/runs/41259913549/job/124710865961) |
| Install audit | CI reported **zero known vulnerabilities** at verification time; no application dependency added | Time-dependent registry result, separate from the license check |

CI used Node 24, network PostgreSQL **16.15** and native PostgreSQL **16.15** dump/restore tools. Required native tests ran against real PostgreSQL in CI, not a local embedded substitute, and never silently skipped. Local `npm run check` and all 24 browser tests also passed on Node 24.22.1 with an external Chromium **153.0.8010.0** test executable. The default browser download failed locally; the test executable override is a development prerequisite, not an application dependency or runtime fallback.

Desktop/tablet/phone print screenshots were visually inspected. Browser tests also inspect readable light/dark forms, totals, dialog accessibility, print-media visibility and overflow. Each viewport uses an independent bounded demo runtime on ports 3100–3102, preserving the application's 24-session cap rather than increasing it for tests. No build ran concurrently with the completed browser suite.

## Verified behavior

- Shared fictional cleaning and maintenance workflows select persisted services and effective area rates, create linked internal drafts, load unit prices automatically, calculate discounts/manual tax and preview/print. A page reload reads the saved rate/draft again. A subsequent catalog-price edit does not alter the saved estimate's displayed/printed amount.
- Exact-money tests cover decimal-string parsing, half-cent line rounding, discount/tax rounding order, full discount, zero prices, fractional quantities, large values, bounds/overflow, malformed monetary values and extras requiring a base. Native PostgreSQL totals match the independent BigInt calculator across monetary vectors.
- Concurrent raw rate inserts admit one overlapping active rate; adjacent periods and distinct areas work. Raw catalog edits and draft preparation share the epoch: a saved snapshot uses the selected price or rejects stale evidence. A frozen REPEATABLE READ selection fails after a competing catalog commit.
- Concurrent identical estimate requests create one source record/audit/version; original-input retries return that same result after later catalog changes. Altered retries, stale selections and competing stale edits refuse. A failed edit retains the prior revision/history.
- Owners/admins alone can mutate pricing/drafts or prepare snapshots. Staff/viewer writes, foreign references, mismatched customer/work, raw forged totals/non-string prices and projection/history mutation are refused independently of browser filtering. Quoted work retains its customer link.
- Saved rate/description snapshots survive catalog edits, expiration/archive and quantity changes. New use of inactive rates refuses. Rate restoration rechecks overlap. Reviewed drafts require reopening before content edits; Void is terminal. Every status/archive revision remains in protected history.
- Migration 8 → 9 refuses an active runtime host and premature pricing activation, then preserves existing configuration, records, audit and workforce allocations when hosts stop. Applied migrations 1–8 are unchanged. No old pricing data is silently adopted.
- Closing/reopening the native adapter retains saved rates and draft totals. Native backup/restore retains exact pricing, revisions, line links and operation receipts. The restored runtime remains **activation-blocked**.

All **93 preexisting native tests**, **64 preexisting unit/embedded-SQL tests** and existing scheduling/workforce/browser scenarios remain enabled and passing. Credential lifecycle, sessions, owner access, offline recovery, external credential lineage and checkpoint publication were not weakened or disabled.

## Remaining limits

USD/two-decimal cents; 1–10 lines; bounded positive quantities/totals; explicit areas; whole-estimate discounts and one manually configured exclusive tax. No currency conversion, automatic service-area mapping, jurisdictional/compound/inclusive tax automation, signed acceptance or external financial action.

Browser emulation/automated accessibility and print-media screenshots do not certify every physical device, printer or assistive technology. Live-business identity/session fencing and financial/privacy acceptance remain separately gated. The public demo is still isolated and temporary; durable storage is host-only. See the [full contract](services-estimates.md) and [roadmap](../ROADMAP.md).
