# Daily Operations — reliable Show All and bounded date-card navigation (PR #191)

## What this fixes

The seven-day workload card filter from merged #190 supports two views:
**Show active days only** and **Show dates with no saved activity only**.
The latter changes its button label to **Show all seven dates** when
selected. If the user also chose a weekend-only calendar filter, clicking
"Show all seven dates" previously cleared only the quiet-date mode,
leaving weekends selected and showing **two cards instead of seven**.

PR #191 fixes that misleading label: turning the no-saved-only mode
**off** now also resets the weekday/weekend filter to **All seven days**.
Turning it **on** still respects the user's current weekday/weekend choice,
so users can intentionally review only quiet Saturdays and Sundays.

The existing active-only mode, category focus, sort mode and
**Reset workload view** retain their original behavior.

## Supported navigation bounds

The Operations date input supports **2020-01-01 through 2100-12-31**.
The seven-day business-local workload can still display days that fall
outside that range when the user views the final days of 2100.

The first-quiet-day shortcut introduced in #188 already checks these
bounds. PR #191 brings **individual workload date cards** into
alignment:

- In-range date cards remain interactive native buttons.
- Out-of-range date cards still display their saved-record counts,
  but are **disabled**, carry a readable range notice and have an
  accessible label/description explaining the limit.
- The existing `selectDate` handler also rejects any **complete**
  `YYYY-MM-DD` value outside the supported range. Temporary
  partial date-input edits keep their prior behavior.
- There is **no silent clamping**, UTC-day conversion or automatic
  jump to a different date. The original `Temporal.PlainDate`
  business-local seven-day grouping remains unchanged.

## Verification

`tests/e2e/workspace.spec.ts` extends the **existing fictional
no-login session** to:

1. Enter a seven-day window without saved activity and enable
   no-saved-only plus weekends, observing two cards.
2. Click **Show all seven dates** and verify all seven cards return,
   the calendar-day filter is **All seven days**, and the pressed
   state is reset.
3. Re-enable quiet-only and weekends, then switch to active-only;
   verify exclusive modes and the existing Reset action.
4. Select **2100-12-31**. Verify all seven future cards remain
   readable but disabled, while the Operations date remains in range.
5. Restore the original date and continue existing export,
   accessibility and workspace tests without adding a demo session.

The action affects **only UI navigation and display filters**,
never the canonical authorized seven-day data, counts, the CSV
exports from #189, resource availability, booking authority,
organization access, storage, database or API.

## Merge gate

PR #191 remains **draft and unmerged** until all five checks on
its final head SHA pass: Foundation, PostgreSQL, Browser,
Release install Ubuntu, and Release install Windows.
Repair failures on the **same branch** and never auto-merge.

MIT licensing, the no-login fictional demo, migrations, release
behavior and all other repositories (including ForgeOS) remain
untouched.
