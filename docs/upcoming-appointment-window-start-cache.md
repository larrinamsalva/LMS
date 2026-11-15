# Daily Operations upcoming appointment window — cached start instants (PR #174)

## Purpose

The Daily Operations summary reads an **already-authorized workspace
snapshot** and shows appointments that start in the next seven
business-local calendar days. The existing filter checked a saved
appointment start against its lower and upper boundaries by
converting **the same string timestamp twice**, then parsed the
same value again for other retained appointments using that start.

The upcoming-appointment window filter now uses a temporary
`Map<string, bigint>` that reuses the exact
`instant(value).epochNanoseconds` result for identical **string**
start instants **within one `summarizeDailyOperations` call**.

* The same `Temporal.PlainDate` next-local-midnight and
  day-plus-eight-midnight bounds define the upcoming window.
  The window includes the next seven business-local dates,
  correctly handling 23- and 25-hour DST days and leap years.
* The same `start >= nextMidnight && start < dayPlusEightMidnight`
  half-open condition controls inclusion. Cancelled, archived,
  foreign-organization and non-appointment records are rejected
  exactly as before, ahead of parsing the upcoming timestamp.
* For **non-string historical values**, the original two-instant
  condition and per-use coercion remain unchanged; they are
  **not cached**. Invalid permitted timestamps still throw
  rather than producing fabricated appointments.
* The original sorting comparator using
  `Temporal.Instant.compare` remains untouched, preserving
  appointment order, ties, duplicate retained occurrences and
  original record references.
* The cache is created during a single summary call; it is not
  shared across future dates, business time zones, changed
  records or organizations.

## Regression coverage

`tests/unit/daily-operations-upcoming-start-cache-parity.test.ts`
implements an **independent copy of the original upcoming-appointment
window filter and comparator** from verified merged LMS #173.
Tests compare **exact selected appointment record identities,
counts and ordering** against the updated read-only summary across
**720 fictional appointment revisions**, multiple dates and three
time zones, repeated starts/duplicate object references, archived,
cancelled and foreign records, both fall-back 01:30 occurrences,
business-local midnight boundaries, changed historical starts
between calls and malformed legacy values.

The tests are parity checks; **no benchmark speedup is claimed**.

## Boundaries

This PR does not alter the today's-appointments filter,
saved appointments, availability or booking authority, work
due dates, equipment inspections, UI, CSV schema, authorization,
database/API/migrations, release/deployment, MIT license,
fictional no-login public demo or other repositories
(including ForgeOS).

This PR must remain **draft and unmerged** until all five
checks on its final head SHA are successful: Foundation,
PostgreSQL, Browser, Release install Ubuntu and Release install
Windows. Never auto-merge.
