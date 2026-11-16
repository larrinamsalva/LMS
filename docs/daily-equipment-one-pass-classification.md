# Daily Operations — one-pass equipment panel classification (PR #181)

## Purpose

The read-only Daily Operations overview shows **Equipment to review**
and **Upcoming equipment inspections** from the same authorized,
non-archived equipment directory and the same organization-scoped
equipment-state list.

Earlier merged work (#176 and #177) introduced a first-match equipment
record index and scoped the state array once, but each equipment panel
still performed its own `flatMap` over every authorized state.

PR #181 builds both result arrays during **one pass** through that
already-authorized state array, resolving each equipment record
only once per state. It then applies the exact original **separate
sorts** to each result list.

## Preserved business semantics

- Same-organization state filtering and the non-archived,
  equipment-only record index remain unchanged. The **first**
  authorized equipment record for a repeated ID still wins.
- Duplicate state references and duplicate historical entries
  continue to produce duplicate alerts/inspections where the
  original implementation did.
- **Retired** assets never appear in either view.
  Other non-serviceable conditions still appear as saved alert
  reasons without inventing inspection due dates.
- **Serviceable** equipment with a saved inspection date at
  or before the selected business-local date still gets the
  original `Inspection due` warning.
- Only serviceable equipment with a saved date strictly after
  the selected date and at or before `upcomingThrough` enters
  future inspections. No dates are inferred, shifted, normalized,
  or reclassified by real-time clocks.
- Each view preserves its existing independent order:
  current alerts sort by equipment name, while upcoming
  inspections sort by due date, name, then record ID.
  Identical key ties preserve their original input order.
- Nothing is persisted. Each call constructs fresh result arrays,
  and the organization scope cannot be shared across calls.

## Regression coverage

`tests/unit/daily-equipment-one-pass-classification-parity.test.ts`
includes an **independent copy of the two original `flatMap` passes**
from verified five-green, merged LMS #180.

It compares the complete **row values, ordering, saved equipment
record identities, retained duplicate occurrences, alert reasons
and future dates** for 720 fictional equipment-state records
plus additional duplicates, across three time zones and five
business-local dates. It covers missing and foreign equipment,
archived revisions, first-ID-wins collisions, retired and unsafe
conditions, same-day/seventh-day/eighth-day inspection boundaries
and updates between summary calls.

These tests verify behavior parity, **not a measured speedup**.

## Non-goals and merge gate

This is a read-only presentation optimization. No persisted
equipment records or maintenance actions, health/safety decision,
resource availability, scheduling, booking authority, access
control, CSV schema, user interface, API/database/migrations,
releases, MIT license, fictional no-login public demo or
other repositories (including ForgeOS) are modified.

**PR #181 remains draft and unmerged** until Foundation,
PostgreSQL, Browser, Ubuntu install and Windows install
all pass on its **final head commit**. Fix any failures on
the same branch. Never auto-merge.
