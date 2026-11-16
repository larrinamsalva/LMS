# Daily Operations — review first date with saved activity (PR #192)

## Purpose

LMS Daily Operations already highlights the **busiest recorded day**
and, since #187–#191, dates with **no saved activity**.

PR #192 adds the complementary **First date with saved activity**
summary to the full seven-day business-local outlook. It shows the
earliest upcoming date with recorded appointment starts, unfinished
job/task due dates, or (when the Equipment module is enabled)
upcoming serviceable equipment inspections. It includes the saved
item count and an accessible **Review YYYY-MM-DD** shortcut for a
date within the existing Operations picker range.

This is a **review and navigation cue only**. It does not determine
priority, availability, resources, opening hours, staff hours, booked
capacity or equipment safety. A clear disclaimer accompanies the UI.

## Data integrity and behavior

- `earliestRecordedActivityDay` takes the **already-authorized
  business-local seven-day date-card array**, and uses the same saved
  counts as the existing activity-only filter and weekly totals.
- It compares ISO business-local calendar **dates**, so it selects
  the earliest qualifying date even if the input cards have been
  reordered. It does not select the busiest date unless that is
  coincidentally the first date with activity.
- A saved item is counted only in its existing activity category;
  disabled equipment inspection counts cannot create an active day.
- The shortcut uses the existing `selectDate` handler and only
  appears for a date in the established **2020-01-01 through
  2100-12-31** Operations date-input range. The summary remains
  read-only for any date outside those bounds.
- An empty week reports that there is no saved upcoming activity
  and offers no navigation button.
- The shortcut is independent of visible-card filters, category,
  weekday/weekend selection and sort order. It never mutates records,
  changes a scheduled job, books an appointment or crosses business
  organization boundaries.
- Existing CSV exports, date navigation, full-week totals, no-saved
  dates and busiest-day summary are unchanged.

## Verification

`tests/unit/daily-first-recorded-activity-day.test.ts` compares the
helper against an independently defined active-day predicate across
**720 fictional date cards**, reversed and filtered inputs,
inspection-enabled/disabled views, empty sets and duplicates.
It verifies exact earliest dates rather than biggest counts and
that original data remains unmodified. Real authorized daily
summaries also test archived/foreign-record exclusion,
daylight-saving transition, leap dates and updates to saved work.

The **existing fictional no-login demo session** in
`tests/e2e/workspace.spec.ts` verifies the first-activity panel
does not offer a shortcut in a future empty week, navigates to a
known saved-work date, shows the planning disclaimer, and does not
offer an out-of-range navigation at the upper supported date.
No extra demo sessions are created.

## Merge gate

PR #192 remains **draft and unmerged** until its final head SHA
has five green GitHub checks: Foundation, PostgreSQL, Browser,
Release install Ubuntu and Release install Windows.

Fix any failure **on this same branch**, recheck, and
never auto-merge. No saved records, APIs, database, migrations,
existing CSV formats, MIT license, release/deployment, public
fictional no-login demo behavior or other repositories (including
ForgeOS) are modified.
