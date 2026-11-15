# Daily Operations — repeated appointment overlap instants (PR #175)

## Purpose

The **read-only selected-day appointment list** in Daily Operations
includes already-authorized, non-archived, non-cancelled appointments
that overlap the chosen **business-local calendar date**.

Previously it parsed the appointment start and end strings separately
for each retained appointment record. Fictional schedules can contain
multiple saved revisions with identical start/end timestamps. The
updated day-overlap filter stores successfully parsed
`epochNanoseconds` values for **identical strings**, reusing them
only **within a single `summarizeDailyOperations` call**.

* All filtering remains constrained to the snapshot's explicitly
  requested `organizationId`; only current (non-archived)
  appointment records with a non-cancelled status enter this list.
* The exact strict **half-open overlap condition** is unchanged:
  `appointment.start < nextBusinessLocalMidnight` and
  `appointment.end > selectedBusinessLocalMidnight`. A booking
  ending exactly at the beginning or starting exactly at the end
  of the selected day does not match.
* Day boundaries continue to use `Temporal.PlainDate` with
  the configured business time zone. Fall-back 25-hour days,
  spring-forward 23-hour days and leap dates are preserved.
* **Non-string historical values are never cached** and still run
  through the previous per-occurrence `String(value)` conversion.
  Invalid included timestamps still throw; no times are invented.
  Short-circuiting avoids parsing an end timestamp if its start
  cannot overlap the selected day.
* The existing `Temporal.Instant.compare` ordering, stable ties,
  duplicate historic IDs/references and record identity are intact.
  The separate **upcoming seven-day appointments** filter added
  in #174 is unchanged.
* The cache is private to one summary invocation. No value is
  stored across different dates, zones, records or organizations.

## Regression verification

`tests/unit/daily-appointment-overlap-cache-parity.test.ts`
includes an **independent reference** of the exact prior filter
and comparator from five-green merged LMS #174.

For **720 fictional appointment revisions** and additional duplicate
retained rows, it checks the resulting **record identities, order
and counts** across UTC, Los Angeles and New York zones and multiple
business dates. Additional scenarios exercise fall-back clock
repetition, local midnight exclusions, changing saved timestamps
between calls, malformed legacy timestamps, foreign-organization
data, cancelled/archived records and unrelated entities.

These tests establish observable behavior parity; no benchmark
speedup is claimed.

## Boundaries and merge gate

No persisted data, business scheduling or booking authority,
staffing or availability decisions, permissions, UI, CSV schema,
API/database/migrations, deployment/release, MIT license, fictional
no-login public demo or any other repository (including ForgeOS)
is modified.

PR #175 must remain **draft and unmerged** until all five checks
on its final head pass: Foundation, PostgreSQL, Browser, Release
install Ubuntu and Release install Windows. Never auto-merge.
