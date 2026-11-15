# Daily Operations CSV — repeated appointment start labels (PR #172)

## Scope

This optimization is confined to the **read-only Daily Operations CSV**
exporter. The function accepts an **already-authorized, organization-scoped**
daily summary supplied by its caller. It does not perform authorization,
change the summary, or determine business scheduling eligibility.

Many fictional appointments can share the same saved scheduled-start
instant. Previously the exporter independently called
`displayTime(String(start), zone)` for each appointment. It now caches
the returned display label for **identical string start timestamps** in
a `Map<string, string>` **local to one export invocation**.

* Repeated strings reuse the exact original time-zone formatting result.
* **Non-string values are not cached**, preserving their original per-use
  `String(value)` coercion and date handling.
* **Malformed timestamps preserve `displayTime`'s original fallback**:
  the incoming timestamp string is emitted rather than inventing a time.
* Different exports and time zones have separate caches; changing a value
  before another export cannot reuse stale text.
* The existing CSV header, columns, row order, appointment-status values,
  overdue/due work and optional equipment rows, CRLF line endings, and
  `csvSafeCell` quote and spreadsheet-formula safeguards are unchanged.

## Regression checks

`tests/unit/daily-operations-csv-time-cache-parity.test.ts` contains an
**independent copy of the pre-optimization exporter**, and compares the
**entire output byte-for-byte** with the updated function. The main
fixture contains **720 fictional appointment records** plus overdue work,
due-today tasks and an equipment alert; it exercises UTC, Los Angeles
and New York business zones across autumn and spring daylight-saving
transitions, duplicated appointment references, archived/cancelled and
foreign-organization records, formula-shaped titles, and equipment
inclusion/exclusion. Additional checks distinguish both 01:30 hours at
the autumn DST fold, verify per-export zone isolation, non-string
timestamp conversion, malformed text fallback and header-only output.

The tests verify **output parity**, not a measured runtime speedup.

## Non-goals

No persisted data, permission or organization boundary, appointment
scheduling or status transition, UI, export schema, API, database,
migration, release, MIT license, fictional no-login public demo, or
any other repository (including ForgeOS) is changed. This PR stays
draft until **Foundation, PostgreSQL, Browser, Ubuntu install and
Windows install** all pass on the final head commit. It is **never
merged automatically**.
