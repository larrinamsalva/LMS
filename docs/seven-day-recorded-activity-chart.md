# Daily Operations — seven-day recorded activity chart (PR #195)

## Purpose

The existing **Next seven days · workload by date** view shows exact
upcoming appointment starts, unfinished work due and (for enabled
equipment modules) equipment-inspection counts in cards and totals.

PR #195 adds a compact **Saved activity by date** bar chart above
those cards, using the **same already-authorized seven business-local
dates**. It helps staff see which dates contain relatively more
saved records without opening or sorting each date card.

This is a **saved-record distribution, not capacity utilization**.
The chart cannot establish booking availability, staff hours,
appointment duration, room capacity, service urgency or equipment safety.

## Display rules

- The chart always uses the **complete seven-date snapshot** from
  `sevenDayWorkload`, regardless of the active-only, quiet-only,
  category, weekday/weekend or sorting controls applied to date cards.
  Full-week totals, existing cards, comparison and CSV exports remain
  independent and unchanged.
- The new `recordedActivityBars(days, includeInspections)` helper
  combines existing saved counts per date using exactly the existing
  `recordedItemCount` predicate, excluding inspections for workspaces
  with no equipment module. Foreign, archived, cancelled, completed,
  overdue or unrelated records have already been removed by the
  authorized daily overview's existing rules.
- Each date displays its **exact numeric count**, full YYYY-MM-DD date,
  and accessible label. Decorative bars carry
  `aria-hidden="true"`; color is never the only way to read them.
- The tallest nonzero bar represents **100% of the highest saved
  item count in this specific seven-day window**, not 100% capacity.
  Other bars are proportional rounded percentages. A nonzero count
  smaller than 1% stays visible at 1% minimum, with exact count still
  displayed; zero saved items have zero-height bars.
- The chart's narrow-screen layout scrolls horizontally instead
  of truncating the seven calendar dates. It uses the existing
  theme's background, border, text and accent variables for
  high-contrast light/dark display.
- The chart has no hidden interactive booking/navigation behavior.
  Existing keyboard-accessible date-card and review buttons remain
  the controls for navigating to a particular date.

## Regression verification

`tests/unit/recorded-activity-bars.test.ts` checks exact counts,
relative bar scaling, zero and tiny-positive counts, module-enabled
inspection behavior, immutability, order and duplication, and an
independent oracle across **720 fictional day cards**. It also
tests organization isolation and business-local DST/leap dates
using the existing authorized daily overview.

`tests/e2e/workspace.spec.ts` extends the **existing fictional
no-login demo session** to confirm seven accessible chart dates
in a fully empty 2035 week, a nonzero saved count in a known
2026 work window, an explicit capacity disclaimer, and no
change to the full chart when date cards are filtered to quiet
dates. No extra demo sessions or external requests are added.

## Merge gate and non-goals

PR #195 is **draft and unmerged** until all five checks on its
final head SHA pass: Foundation, PostgreSQL, Browser,
Release install Ubuntu and Release install Windows.
Repair failures on the same PR branch; never auto-merge.

No saved records, appointment/work status, organization
authorization, database/API/migrations, other CSV formats,
MIT license, demo login, release/deployment or other
repositories (including ForgeOS) are changed.
