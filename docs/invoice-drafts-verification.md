# Invoice-draft verification

This evidence concerns fictional demonstrations and a host-only PostgreSQL adapter. It does not accept production financial operations, customer messaging, legal/tax compliance or restored-database activation.

Verified application source: `1f8e552c6b2b6b7ee01e5133ce42f3c8f2636585`. Native migration-count regression fixes: `fcb363c5b4c1215a2abe5115b4834f1d6fec555b` (the production source is identical). The final documentation/screenshot/test-cleanup commit is checked separately; its exact head and CI results are recorded in [PR #31](https://github.com/larrinamsalva/LMS/pull/31) and [the current checks](https://github.com/larrinamsalva/LMS/pull/31/checks).

| Observed check | Actual result | Evidence |
| --- | --- | --- |
| Local `npm run check` | 344 tests / 50 files; 103.83 seconds; typecheck, 188 dependency license declarations and production build passed | Application source above; all unit/embedded integration suites enabled |
| Local full `npm run test:e2e` | 78 passed / 8.3 minutes; 0 unexpected, flaky or skipped | Three viewports; actual production build and fictional Engine; Playwright report stats verified |
| Local focused pricing/invoice journey | 3 passed / 55.8 seconds | Both cleaning and maintenance in each viewport; exact historical print, correction and void; no horizontal overflow; zero checked axe WCAG A/AA/2.1 AA violations |
| GitHub foundation | 344 tests / 50 files; 66.80 seconds; typecheck, 188 licenses and build passed | [Run 41493978145, foundation](https://github.com/larrinamsalva/LMS/actions/runs/41493978145/job/125443988512) at `fcb363c` |
| GitHub native PostgreSQL | 236 tests / 17 files; 144.78 seconds; all 16 invoice cases passed | [Run 41493978145, PostgreSQL](https://github.com/larrinamsalva/LMS/actions/runs/41493978145/job/125443990289) at `fcb363c`; PostgreSQL and pg_dump 16.15 |
| GitHub browser | 78 passed / 7.5 minutes | [Run 41493210715, browser](https://github.com/larrinamsalva/LMS/actions/runs/41493210715/job/125441314445) at `1f8e552`; unchanged application source |

Native PostgreSQL/Docker are unavailable in the local environment. Native evidence above comes from the real PostgreSQL 16.15 CI job, including native `pg_dump` and `pg_restore`; embedded PGlite and browser checks are never substituted for native restoration. Historical migration expectations were updated to 16; earlier applied SQL/checksums remain unchanged.

The native invoice restore test compares exact customer/source links, financial snapshots and every correction, origins, record links, receipts, audits and configuration history in a separate quarantined fictional database. It verifies forced-RLS isolation, unchanged source state and continued runtime activation refusal. Reconnection preserves the current draft. This is same-schema fictional backup evidence, not production recovery or migration-execution acceptance.

Coverage added: shared module opt-in/dependencies; unchanged legacy readers; strict commands; all pricing modes, saved extras/areas, BigInt rounding/overflow and invalid quantities; source/config/record revisions; identical versus conflicting retries; append-only corrections and terminal void; current roles/RLS; concurrent conversions/source changes/corrections; injected transaction failure; retained linked records; stopped-host migration; reconnection and separate quarantined same-schema restore of snapshots/links/receipts/audits. Existing business, security, recovery, credential/checkpoint, private logo/provenance, native readiness and Studio/Gallery/package suites remain enabled.

Screenshots use only the actual temporary fictional Engine workflow. [Desktop light](screenshots/invoice-drafts/desktop-fictional-invoice-cleaning-light.png), [tablet light](screenshots/invoice-drafts/tablet-fictional-invoice-cleaning-light.png), [phone dark](screenshots/invoice-drafts/phone-fictional-invoice-property-dark.png), [print](screenshots/invoice-drafts/desktop-fictional-invoice-cleaning-print.png). UUIDs/times are generated fictional record/operator identities. No credentials, signing material or private business data is included. CI retains the corresponding synthetic screenshots for 30 days.

See [workflow and limitations](invoice-drafts.md). Correcting invoice line structure/prices, production issuance/payment/accounting, verified persistent HTTP transport and independent financial history anchoring remain separate phases. No historical migration, original Gallery source pin or portable protocol was changed.
