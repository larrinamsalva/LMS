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

## Observed evidence

Eight initial embedded-PostgreSQL integration tests and TypeScript passed before the local execution environment disconnected. The interrupted full check is **not** counted as successful. GitHub CI on the committed feature branch is authoritative for the final implementation; full foundation, native and browser results are pending.

## Coverage

The new embedded SQL suite exercises actual migration 15/host code, original decoder and session guard; exact retries, authorization/isolation, stale state, changed bytes, failed mapping insertion, audit privacy, forced RLS, immutable history, complete configuration validation before commit and activation refusal.

The new native PostgreSQL suite signs in through actual unmounted Better Auth. It covers destination UUIDs, current owner/admin authority, expired/revoked sessions, revocation during decoding, concurrent retries/stores/selections, operation collisions, stale publication/association revisions, a repeatable-read snapshot predating the first cursor, checksum-valid hostile PNGs, quotas, failed transaction rollback, lost committed response/exact retry, legacy unbranded configuration, missing/damaged/blocked assets, explicit separate association and independent application processes/reconnection.

Its same-schema native round trip must preserve exact PNGs/mappings/receipts/history, keep source rows unchanged, purge restored sessions and refuse both runtime attachment and transfer SQL in the copy. The interruption test loses a caller's result after a real commit; it does not claim physical power-cut or native network fault injection. Existing security/recovery/lineage/checkpoint, foundation, business-module, template, migration-readiness, backup and all browser regressions remain required.

## Presentation boundary

No persistent browser UI or transport is added. Existing public Studio and image/companion/bundle controls remain temporary and separately tested on desktop/tablet/phone in light/dark modes with Axe. Existing [bundle screenshots](branded-blueprint-bundles-verification.md#initial-synthetic-workflow-screenshots) show the unchanged public workflow, **not** persistent transfer or accepted real-user transport. Host inspection uses existing verified image readers/branding components only through a separately accepted private local transport; this phase creates none.

[Operator workflow, exact contract and limitations](private-logo-transfers.md)
