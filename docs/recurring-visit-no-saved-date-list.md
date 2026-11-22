# Recurring visit planner — review proposed dates without saved appointment records (PR #229)

## Why this exists

After LMS #228, date cards and the focused selected-visit panel make it clear when a proposed calendar date has **zero overlapping non-archived saved appointment records**. In Compact view, the date cards are hidden. This small improvement adds an **optional expandable date-only list** of those proposed dates inside the existing "Saved appointment date coverage" group, parallel to the prior cancelled-only list.

**Important:** A date with no saved appointment record is **not** a free time slot, available staff/equipment, or an appointment booked by this proposed recurrence.

## Behavior

- **Show proposed dates without saved appointments (N)** appears directly after the existing cancelled-only list toggle. Initially collapsed; a native button exposes `aria-expanded`. If N is 0, the toggle is disabled and no list appears.
- When expanded, the accessible list **Proposed dates without saved appointments** includes exactly the dates returned by `noSavedProposedDateList(statuses)`, preserving the order of the validated 2–12-date recurring proposal.
- Each row displays **Proposed visit X of N**, where X refers to the **original** visit ordinal in the full proposal rather than the filtered subset; the business-local weekday, the ISO date, and a native ≥44px **Review proposed date without saved appointments YYYY-MM-DD** button.
- The currently reviewed date, if present in the filtered list, has `aria-current="date"` plus the textual **Currently reviewing** label. Its Review button is disabled. Clicking a different date calls the *existing read-only* `reviewPlannedDate` pathway (changes only the local Schedule agenda focus), preserving proposal anchor/frequency/count and closing stale visit-note/copy feedback. No appointment is prepared, written, booked, confirmed or reserved.
- Explanatory text inside the list explicitly states **NOT BOOKED** and says staff/equipment availability has **not** been checked. Existing resource/conflict validation is still required for any future manual Save.
- The list uses the current, authorized and organization-scoped, already calculated `PlannedDateAppointmentStatuses[]`: `hasNoSavedAppointmentsOnPlannedDate` returns true only when `savedAppointments === 0`. Archived-only, corrupt and unrelated records remain excluded under existing rules; cancelled-but-not-archived records **count as saved** and their dates never appear in the no-saved list.
- Business-local date overlaps, overnight appointments and DST keep the unchanged shared policy. No new raw appointment records, staff/equipment/customer data, guessed appointment times or resource capacity are displayed.
- List remains available in Compact view although normal date cards are hidden. It is automatically collapsed whenever Schedule's **Previous day, Next day, date input, repeat frequency or preview count** changes the proposal; changing a rule back does not reopen a stale list. Invalid/overflowed proposals hide the toggle/list with the entire overview. It updates immediately from the same scoped saved status source after the existing manual single-appointment Save/Cancel.
- Reuse dark/light responsive styles for the existing cancelled-only list by grouping CSS selectors, while keeping distinct accessible labels, class hooks and state for the no-saved list. No added demo sessions, no new nested `<details>` elements, and no changes to exports or existing date navigation.

## Test plan
- Unit tests: a mixed six-visit proposal with Scheduled, Cancelled, Other, archived-only, malformed and unrelated records, ensuring exact no-saved date output in original order and original one-based ordinals; total equals `savedDateCoverage(...).withoutSaved`; separate cancelled-only list remains disjoint; reverse input and empty input behave deterministically; all inputs immutable.
- Business-local overnight boundaries: one saved appointment spanning two local dates makes both dates nonempty. All empty or all saved proposals behave correctly.
- Extend the **existing** two-org no-login Playwright scheduling scenario (**Cleaning Company and Property Manager, no new sessions**): initial collapsed/disabled behavior, four-date list exactly matching saved count labels, original visit numbers, current-date marker, review then return without re-anchoring, zero-state no list; six-date count and collapsed after recurrence changes; twelve-date Compact view still presents correct number, date ordinals and current selection; invalid/overflowed preview hides it; after explicit single appointment Save the list count reflects remaining zero-record proposed dates.
- Preserve all existing WCAG/phone checks, status classification, screenshots/notes, clipboard/TXT/CSV, strict 24-demo-session boundary, organization isolation and single-appointment manual Save/Cancel safeguards.

## Safety and merge gate

**Read-only date navigation; no availability, reservation, capacity, auto-booking, recurring appointment creation, additional resource check, customer export, API/DB/schema/migration, auth/session change, persisted setting, notification, payment, ForgeOS or unrelated project changes.**

Keep **#229 DRAFT / UNMERGED** until **all five GitHub checks on final PR head** pass: Foundation, PostgreSQL, Browser, Release install Ubuntu and Release install Windows. Fix failures on this **same PR branch**, rerun/reverify all five, and **never auto-merge**.
