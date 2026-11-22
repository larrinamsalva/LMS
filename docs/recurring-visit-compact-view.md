# Recurring visit planner — compact date-card view (PR #216)

## Goal
The LMS Schedule planner supports a strictly bounded 2–12-date
**unsaved** recurring visit preview with a **Reviewed visit**
details panel and a **Jump to planned visit** dropdown, alongside
First/Previous/Next/Last navigation. On phones, a twelve-card grid
makes the user scroll through repeated date cards even when only
one selected visit matters.

PR #216 adds an optional **Compact view — hide date cards** checkbox
so an operator can keep just the relevant planning and focused
visit controls visible. The full set of cards remains the default.

## Behavior
- For every valid, complete preview, the labelled native
  **Compact view — hide date cards** checkbox appears immediately
  above the proposed-date list. It defaults to **unchecked**.
- Checking it hides **only** the numbered date-card `<ol>`,
  replacing the list with a plain-language note stating that
  the cards are hidden, the proposed dates and existing saved
  appointments are unchanged, and the control can show the cards.
- The **Jump to planned visit** dropdown, Reviewed visit X of Y
  details/status counts, **Prepare this visit manually**, and all
  First/Previous/Next/Last buttons remain visible and operational.
  The proposed-only overview, CSV download and Copy planned dates
  also remain in place.
- Choosing any date from the dropdown while the date cards are
  hidden still updates the exact current review, selected date,
  saved status breakdown and normal agenda. Clicking the panel's
  manual-preparation action still opens only the existing single
  appointment editor, subject to its original checks.
- Unchecking restores all 2–12 original date cards, their dates,
  existing saved counts and the exact `aria-current="date"`
  review highlight. No re-anchoring, reset of the recurrence
  interval, or stored-record write occurs.
- The view preference is transient React component state and
  persists while Schedule stays mounted; navigating to a separate
  editor and returning opens a full view again by default.
- No preview (e.g. invalid or overflowing range) means no
  compact-view control or date cards, preserving the existing
  visible validation error. The checkbox is disabled while
  a workspace mutation is busy.
- The native checkbox uses a 20px check mark within a minimum
  44px label target, normal keyboard focus, readable theme tokens
  in light/dark mode, and mobile-friendly wrapping. Hidden cards
  are removed from the DOM instead of remaining focusable.

## Non-booking guarantee
**Compact view changes presentation only.** It never alters the
validated start date, interval, occurrence count, chosen agenda
date, stored appointments, organization data or availability.
No API call, new database schema, migration, authorization
change, booking, resource allocation, automatic recurrence,
payment, notification or export-format change. ForgeOS and
other repositories are not touched.

## Test coverage
Extend the existing **two-business** no-login Playwright
scheduling session (Cleaning Company and Property Manager),
without opening additional demo sessions:
- Default unchecked / four cards shown.
- Checking hides only cards and displays the explanation while
  Reviewed visit, proposed overview, CSV and copy controls
  remain present; unchecking restores four original cards.
- With twelve proposed dates, checking hides twelve cards
  while the selected visit's **Prepare** remains enabled.
  The native picker can select visit 10 in compact mode;
  agenda and Reviewed visit details update.
- Unchecking restores all twelve cards, with the exact tenth
  card marked `aria-current="date"`, and the picker can
  return to visit 3 before restoring six-date tests.
- Invalid/out-of-range preview hides the compact checkbox
  and date cards. The existing tests for retained bookings,
  WCAG/mobile fit, CSV, clipboard, explicit Save/Cancel,
  resource checks and authorization remain unchanged.
- Existing fixed 24-session demo limit remains intact.

## Merge gate
Keep #216 **draft and unmerged** until **all five jobs on the
final head** succeed: Foundation, PostgreSQL, Browser,
Release install Ubuntu, and Release install Windows.
Repair failures on **this same branch**, rerun and verify.
Never auto-merge.
