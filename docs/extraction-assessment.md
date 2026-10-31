# ForgeOS extraction assessment

Reviewed 2026-10-31 at upstream commit `5831e20023c8f2f1e7269bbfb63b6ba0f21ee3b8` (main, PR #270). Source: https://github.com/larrinamsalva/ForgeOS-Property-Manager. This is an independent repository; no upstream writes, migrations, deployments or infrastructure connections are needed.

## File-level inventory

| Upstream path | Decision and LMS destination | Reason / adaptation |
| --- | --- | --- |
| `LICENSE` | Preserve verbatim in `third-party/ForgeOS-LICENSE.txt`; MIT LMS license | Copyright 2026 Larrina Salva; retain in distributions |
| `src/lib/request-body.ts` | Copy with attribution to `src/server/request-body.ts` | Framework-neutral JSON streaming byte limit and UTF-8 validation |
| `src/lib/request-origin.ts` | Pattern, independently implement in demo API | Require configured origin on mutations; do not trust forwarded identity headers |
| `src/lib/domain.ts` | Pattern only; replace with `src/core/config.ts` | Property/site/stay types cannot represent arbitrary businesses |
| `src/lib/validation.ts` | Pattern only; new strict config + record schemas | Allowlisted types, explicit required fields, safe values; no arbitrary code |
| `src/lib/api-session.ts` | Do not copy | Requires verified Supabase session; public demo must not impersonate production users |
| `src/lib/supabase/server.ts`, `src/proxy.ts` | Defer optional auth adapter | Avoid a mandatory hosted service; future adapter must verify identity server-side |
| `supabase/migrations/20261021022402_foundation.sql` | Patterns only, new `db/001_foundation.sql` | Organization memberships, RLS, scoped keys, immutable identity and audited writes; remove property/Auth coupling |
| `supabase/migrations/20261022003037_property_operations.sql` | Defer; optional operations modules | Inventory movements, assignments, locks and idempotency need dedicated typed ledgers, not generic JSON finance |
| `supabase/migrations/20261021191645_utilities_billing.sql`, `20261021201615_payments_collections.sql` | Defer entirely | Utility period claims, money rounding, tenant ledgers and reversals are domain-specific |
| `src/lib/billing-domain.ts`, `src/lib/collections-domain.ts` | Candidate future pure-function extraction; no copied code now | Requires separate money contract, attribution and focused tests |
| `src/lib/payment-processing.ts` | Design pattern only | Keep sensitive capabilities absent until a reviewed permission/confirmation contract exists |
| `src/components/record-form.tsx`, `src/components/modal.tsx` | Pattern only, new schema-driven form | Accessible labels, native controls and focus semantics; no property field switchboard |
| `src/components/theme-button.tsx`, `src/app/globals.css` | Pattern only, independent theme tokens | Light/dark contrast, visible focus and responsive navigation |
| `src/components/guest-demo.tsx` | Do not copy | Large property-specific local state; new demo exercises actual core SQL with fictional records |
| `tests/support/database.mjs`, `tests/database/foundation.test.ts` | Pattern only | PGlite runs PostgreSQL policies under an unprivileged application role |
| `.github/workflows/quality.yml` | Pattern only, independent checks | Typecheck, unit/integration/security, build and phone/desktop browser checks |
| `docs/backup-recovery.md`, `src/lib/account-export-registry.json` | Pattern only, separate export contract | An application JSON export is not a full DB/Auth/document backup |
| `public/tablet/*`, `src/lib/offline-*` | Defer entirely | Encryption, device identity, conflicts and recovery deserve a separate phase |
| `src/lib/*-pdf.ts`, fonts and private uploads | Defer entirely | Document authorization, private object storage and font licensing expand scope |

Only the bounded request reader is copied in this phase. The engine, SQL, presets, UI and tests are independently implemented, informed by the architecture above. No ForgeOS data, branding, environment files, deployment configuration, lockfile or git history is imported.

## Risks and extraction gates

- A property authorization hierarchy cannot become generic staff authorization by renaming tables. LMS starts with organization-scoped owner/admin/staff/viewer roles; assignment-level access is future work.
- Custom JSON records are for low-risk operational records. Finance, messaging and AI are unavailable capabilities, not arbitrary configurable entities.
- PGlite verifies real SQL/RLS, but is a single-process embedded PostgreSQL runtime. It does not certify network PostgreSQL concurrency, hosted Auth, PostgREST or object storage.
- The public demo accepts fictional data only. Identity, persistence, recovery and deployment hardening must pass later acceptance gates before real business use.
- Imported upstream dependency licensing includes copyleft components; see the dependency audit. Do not copy the upstream dependency graph wholesale.
