# Daily Operations — one authorized equipment-state subset (PR #177)

## Scope

The read-only Daily Operations **Equipment to review** and
**Upcoming equipment inspections** panels both use the exact same
authorized equipment-state snapshot. Previously, each view independently
ran `snapshot.equipmentStates.filter(state => state.organization_id ===
snapshot.organizationId)` before using the already-indexed equipment
records introduced in PR #176.

PR #177 computes this identical **organization-scoped state array once**
per `summarizeDailyOperations` invocation, then supplies it to both
existing panel calculations. The scope is presentation-only; these
panels are not equipment-maintenance commands or booking authority.

## Preserved behavior

- The source filter still checks only the current snapshot's
  `organizationId`. Both views use the same authorized entries.
  Foreign-organization states never enter either panel.
- The array uses the original input order. It does not sort,
  deduplicate, change status, edit references, or remove retained
  duplicate state occurrences.
- Current equipment alerts still use the saved condition and
  inspection threshold, exclude retired equipment, and sort by
  displayed equipment name as before.
- Upcoming inspections still include only **Serviceable** states
  with a saved next-inspection date in the original seven-calendar-day
  window. Dates are not invented or moved.
- The record index remains the PR #176 same-organization,
  non-archived, equipment-only lookup with the **first matching
  saved record winning** when IDs repeat.
- The filtered state array is temporary to one summary call.
  New snapshots, edits, organizations, zones, and dates each
  receive a freshly selected array.

## Regression verification

`tests/unit/daily-equipment-state-scope-parity.test.ts` contains an
**independent copy of the two separate state filters and equipment
panel mappings from verified merged #176**. It checks both result
arrays' **exact row values, source equipment record references,
ordering, and retained duplicate occurrences** across **720
fictional equipment states** and 240 equipment records.

Fixtures include archived and foreign-organization collisions,
repeated resource IDs, identical object references, serviceable,
unsafe and retired conditions, inspection dates near selected
boundaries, three business time zones, and changes to saved
conditions and organization membership between summary calls.

The tests verify semantic parity, **not a measured speedup**.

## Non-goals and merge gate

No persisted equipment state, health/safety decision, checkout
or return action, authorization policy, user interface,
CSV schema, scheduling/availability/booking decisions,
API/database/migrations, release/deployment, MIT license,
fictional public no-login demo or other repositories
(including ForgeOS) are changed.

Keep PR #177 **draft and unmerged** until Foundation,
PostgreSQL, Browser, Ubuntu install and Windows install
all succeed on the **final PR head SHA**.
Fix failures on this same branch; never merge automatically.
