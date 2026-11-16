# Daily Operations — review first date without saved activity (PR #188)

## Purpose

Following the merged #187 **Dates with no saved activity** summary,
Daily Operations now offers a **Review YYYY-MM-DD** button that jumps
directly to the earliest **reviewable** date in the full seven-day
business-local outlook with no saved appointment starts, unfinished
work due, or enabled equipment inspections.

This is an **inspection/navigation shortcut**, not a booking action,
resource-reservation suggestion, confirmed availability, or promise
that a business is open on that date. The original plain-language
warning remains immediately below the shortcut:

> No saved activity does not confirm staff, space or equipment
> availability. Check schedules before planning.

## Behavior and guardrails

- Reuses the already-authorized `datesWithoutSavedActivity` result
  from #187; no new database/API fetch or cross-organization lookup.
- Chooses the first qualifying date **in chronological calendar
  order**, independent of the on-screen workload category, active-only
  toggle, weekday/weekend filter, or most-recorded sort.
- If no date qualifies, no button appears. A date can be shown in the
  seven-day outlook but fall **outside the existing Operations date
  input range** (`2020-01-01` through `2100-12-31`). Such dates
  are not offered through the new shortcut.
- Clicking the button reuses the existing `selectDate` navigation,
  including its normal reset of list pagination. There is no new
  state machine, selected-day calculation, record mutation or
  booking/scheduling authority.
- The original date summary, workload day cards, full-week totals,
  CSV exports, equipment settings, permissions and business-local
  timezone calculations are unchanged.
- The button uses native button keyboard interaction and a distinct
  accessible label containing the target date.

## Browser verification

The existing `tests/e2e/workspace.spec.ts` fictional no-login
session test now exercises the shortcut. It selects a distant,
unpopulated calendar window, confirms all seven dates are shown
as having no saved activity and that the warning is present,
then navigates to the first listed day and asserts the Operations
date control has changed.

It also selects the upper supported date and checks that the
shortcut does not offer an out-of-bounds date before restoring
the original selected date and continuing the existing workspace
tests. No additional demo session is allocated.

## Merge gate

**PR #188 remains draft and unmerged** until its final head has
five successful GitHub checks: Foundation, PostgreSQL, Browser,
Release install Ubuntu, and Release install Windows.

Fix any failing checks on this same branch. Never auto-merge.

No saved records, schema, migrations, service APIs, CSV format,
license, release/deployment, login behavior or other repositories
(including ForgeOS) are modified.
