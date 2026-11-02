# Private logo transfer verification

Scope: trusted fictional PostgreSQL hosts only. No public persistent route, automatic selection/association, configuration publication or production recovery acceptance.

## Reproduce

```sh
npm ci
npm run check
npm run test:postgres
npm run test:e2e
```

Use the [disposable PostgreSQL setup](postgres-setup.md#run-the-network-tests). Native suites require explicit fictional credentials and never silently skip. The new suite creates random `lms_test_transfers_*` / `lms_restore_transfers_*` databases and removes only these test-created resources. No production database, private customer logo or ForgeOS modification is involved.

## Verified implementation

All three jobs passed in [GitHub CI run 41392914376](https://github.com/larrinamsalva/LMS/actions/runs/41392914376) for implementation commit `67001071e2ab3744fdc3cf68e8966cf9f1adb359`:

| Check | Actual result |
| --- | --- |
| Foundation / `npm run check` | **297 passed / 44 files**, 83.74 seconds; TypeScript, **188 dependency license declarations** and production build passed |
| Real PostgreSQL | **219 passed / 16 files**, 132.19 seconds; PostgreSQL/`pg_dump` **16.15** |
| New native transfer file | **14 passed**, 6.006 seconds, including actual independent processes and same-schema quarantined restore |
| New embedded SQL transfer file | **8 passed**, 2.802 seconds; installed actual migration/host implementation |
| Browser regression | **75 passed**, 5.3 minutes; desktop/tablet/phone, public Studio, branding/fallback, package/companion/bundle, keyboard and light/dark Axe checks |

[Foundation job](https://github.com/larrinamsalva/LMS/actions/runs/41392914376/job/125107987650) · [PostgreSQL job](https://github.com/larrinamsalva/LMS/actions/runs/41392914376/job/125107987708) · [Browser job](https://github.com/larrinamsalva/LMS/actions/runs/41392914376/job/125107987395).

The final source formatting preserves normalized TypeScript ASTs in all seven formatted files; the remaining changes record these results. GitHub's PR checks show subsequent head verification. No old SQL/checksum, portable codec, dependency, public route or UI component changed.

Eight initial embedded tests and TypeScript also passed locally before an execution-environment interruption. The interrupted full local check is **not counted**. The native/restore evidence above comes from actual GitHub PostgreSQL execution, not an embedded database, inferred backup success or a mocked transport.

An earlier native run passed 217/219: its old-snapshot test mistakenly retained the review's organization lock, preventing its intended competing first store and leaving a later test without its fixture. The correction obtains the review in a normal short transaction, then establishes an old read-only snapshot before the competing commit. Both tests now pass. No application authorization, timeout, quota, recovery or storage check was weakened.

The [fictional-logo-previews artifact](https://github.com/larrinamsalva/LMS/actions/runs/41392914376/artifacts/13118242489) contains synthetic screenshots from the unchanged browser workflows (30-day retention). They establish presentation/regression evidence, not an accepted persistent HTTP transfer UI.

## Coverage

The new embedded SQL suite exercises actual migration 15/host code, original decoder and session guard; exact retries, authorization/isolation, stale state, changed bytes, failed mapping insertion, audit privacy, forced RLS, immutable history, complete configuration validation before commit and activation refusal.

The new native PostgreSQL suite signs in through actual unmounted Better Auth. It covers destination UUIDs, current owner/admin authority, expired/revoked sessions, revocation during decoding, concurrent retries/stores/selections, operation collisions, stale publication/association revisions, a repeatable-read snapshot predating the first cursor, checksum-valid hostile PNGs, quotas, failed transaction rollback, lost committed response/exact retry, legacy unbranded configuration, missing/damaged/blocked assets, explicit separate association and independent application processes/reconnection.

Its same-schema native round trip must preserve exact PNGs/mappings/receipts/history, keep source rows unchanged, purge restored sessions and refuse both runtime attachment and transfer SQL in the copy. The interruption test loses a caller's result after a real commit; it does not claim physical power-cut or native network fault injection. Existing security/recovery/lineage/checkpoint, foundation, business-module, template, migration-readiness, backup and all browser regressions remain required.

## Presentation boundary

No persistent browser UI or transport is added. Existing public Studio and image/companion/bundle controls remain temporary and separately tested on desktop/tablet/phone in light/dark modes with Axe. Existing [bundle screenshots](branded-blueprint-bundles-verification.md#initial-synthetic-workflow-screenshots) show the unchanged public workflow, **not** persistent transfer or accepted real-user transport. Host inspection uses existing verified image readers/branding components only through a separately accepted private local transport; this phase creates none.

[Operator workflow, exact contract and limitations](private-logo-transfers.md)
