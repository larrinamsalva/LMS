# Daily Operations — dates with no saved activity (PR #187)

## What this adds

The **Next seven days · workload by date** view now includes a small,
read-only **Dates with no saved activity** summary. It reports how many
of the upcoming seven business-local calendar dates have **zero saved**
appointment starts, unfinished job/task due dates, and (if the equipment
module is enabled) upcoming equipment inspections.

When there are such dates, their calendar dates are shown. When every
date has recorded activity, the summary says so. The existing selectable
daily date cards remain available immediately below.

**Important:** no saved activity does **not** mean that staff, rooms,
equipment or appointment times are available. Missing, unrecorded,
tentative and out-of-system commitments are not measured. The UI
states this limitation explicitly.

## Business and authorization rules

- The new `datesWithoutSavedActivity` helper operates exclusively on
  the **already-authorized** result of `sevenDayWorkload`. It neither
  queries nor combines data from other organizations.
- Uses **exactly the same positive-count predicate** as the existing
  `visibleWorkloadDays(..., activityOnly=true)` display and
  `daysWithActivity` weekly totals, but selects its complement.
- When the business has no equipment module, inspection-only dates
  count as having **no enabled saved activity**. Enabled inspection
  counts remain included in the same saved-activity definition.
- The helper returns a fresh array, preserving original day object
  identities, date order, and duplicate occurrences. It does not
  modify callers' arrays, saved records, dates, counts, or existing
  filters/exports.
- UI summary **always uses the complete seven-date window**, regardless
  of selected category, weekdays/weekends, active-only filter, or
  date-card sort order. It cannot reclassify saved appointments or
  create staffing/booking decisions.
- Calendar dates still come from `Temporal.PlainDate` in the
  business time zone: DST transitions and leap dates are unchanged.

## Verification

`tests/unit/daily-workload-no-saved-activity-dates.test.ts` checks
the helper against an **independent reproduction of the previous
activity-count predicate** and against the complement of the
existing activity-only filter, preserving identities and order
for **720 fictional day cards**.

It also checks zero-activity weeks, repeated references,
inspection-only dates with equipment enabled/disabled, actual
organization-scoped seven-day snapshots across the fall DST
transition, archived/foreign records, leap days, and updates
between repeated calculations.

GitHub Foundation checks exercise the unit tests and type-check;
Browser and both release-install jobs exercise the integrated build
and UI. No performance benchmark or availability inference is claimed.

## Merge gate and non-goals

PR #187 stays **draft and unmerged** until all five checks on its
**final head** pass: Foundation, PostgreSQL, Browser, Release install
Ubuntu and Release install Windows. Fix failures on the same branch.
Never auto-merge.

No saved business data, application API, database, migrations,
CSV schemas, licensing, release/deployment, public no-login demo
or other repositories (including ForgeOS) are changed.
