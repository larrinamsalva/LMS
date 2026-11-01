# Inventory verification

PR #13 adds the shared product/location/whole-unit ledger. This file records actual results; pending checks are not claimed passing.

## Evidence

- Focused local unit/embedded PostgreSQL run: **7 tests passed** (2 quantity/config tests and 5 ledger/security cases).
- Full local `npm run check`: **81 tests in 18 files passed**, TypeScript passed, **188 dependency license declarations** verified and production build passed.
- Real network PostgreSQL, concurrency and native dump/restore: pending GitHub CI (native PostgreSQL is not installed in this workspace).
- All **27 browser tests passed (2.3 minutes)** across desktop/tablet/phone using Chromium **153.0.8010.0**. Both inventory examples pass axe light/dark and overflow checks. Desktop/tablet/phone layouts were visually inspected; a separate phone viewport capture confirmed readable movement history.

## Coverage and acceptance

New native tests exercise cleaning/property work links, exact cases, competing raw usage/receipts, retried/duplicate receipts, both-way transfers and destination-overflow rollback, packaging-change races, frozen REPEATABLE READ writers, catalog archival/restoration, independent role/RLS/reference/projection attacks, compensating corrections, identity uniqueness, migration 9→10, adapter restart and native backup/restore with activation blocked.

New browser coverage creates catalog products, searches by SKU, enters an unknown and then known keyboard-scanner code, confirms exact case conversion, retries the original HTTP submission, uses units on linked work, archives/restores positive stock and checks light/dark accessibility and viewport overflow for both industries. It runs on desktop, tablet and phone. Existing security, recovery, lineage/publication, workforce, scheduling and pricing suites remain enabled.

## Limits

Whole indivisible units only; no fractional stock, lot/expiry tracking, value/accounting, purchasing, reservation, camera scanner, hardware certification or offline sync. Per-organization locations share member access; no per-person location ACLs. Catalog configuration enrichment of existing populated workspaces requires reviewed migration. Audit UI shows the last 100 generic events; immutable stock history/export retains all movements within the bounded 250-record demo. Browser emulation/axe does not certify every physical device or assistive technology. No live-business acceptance or restored-database activation is added.
