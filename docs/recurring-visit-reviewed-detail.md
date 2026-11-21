# Recurring visit planner — reviewed-visit details (PR #215)

## Goal
The LMS Schedule planner can preview 2–12 unsaved recurring dates,
show day-by-day saved appointment counts and statuses, label weekdays,
export/copy proposals, navigate First/Previous/Next/Last, and jump
directly to a date from a native dropdown. On a narrow phone, the
numbered list can still make it difficult to see the selected visit's
relevant saved-status information and reach its manual appointment
preparation action.

PR #215 adds a compact **Reviewed proposed visit details** section
beside the picker, so the user can review one selected date in context
without scrolling to its numbered row.

## UI behavior
- If the agenda day **exactly matches** one of the current **valid**
  proposed dates, the panel shows:
  - **Reviewed visit X of Y**, from the current date-only preview.
  - Its business-local weekday and canonical YYYY-MM-DD date.
  - **Saved on this date: N non-archived appointments**, including
    cancelled/completed entries from the existing per-date index.
  - The same **Scheduled / In progress / Completed / Cancelled /
    Other** saved-record status breakdown already shown on its card.
  - A prominent explanation: **counts include records on the
    calendar date, not confirmed bookings for the proposed visit,
    and never prove staff/equipment availability**.
  - **Prepare this visit manually**, using exactly the same
    single-date validation and manual appointment editor as the
    numbered visit cards.
- Changing the current agenda via the dropdown, First/Previous/Next/
  Last, or a numbered card updates the panel without touching the
  original preview anchor or any saved record.
- If the agenda date is **not** one of the proposed dates (e.g.
  after changing the recurrence rule), the panel disappears rather
  than showing a stale date or count. Incomplete/overflowed previews
  also show only their existing validation errors.
- The new manual preparation button is disabled if the current user
  cannot write or a workspace mutation is busy. It is never a
  quick-save or batch-create command.
- Both the new shortcut and each numbered card call shared
  `preparePlannedDate(date)`. It uses
  `plannedVisitAppointmentDraft(anchor, interval, count, date)`
  to recheck exact membership in the same bounded validated plan,
  then passes **only the selected date and transient return route**
  to existing `onPrepareAppointment`. It does not carry time,
  customer, work or resource selections, create any booking, or
  bypass existing authorization/conflict checks.
- After one manual appointment Cancel/Save, the app returns to the
  unchanged unsaved plan and shows the selected date's details,
  refreshing already-saved counts when a successful Save occurred.

## Accessibility and privacy
- Native labelled `<section aria-label="Reviewed proposed visit details">`
  with visible `<h3>`, `<time>`, clear plaintext status and action.
- Responsive wrapping, minimum 44px button height, full theme-based
  light/dark contrast and visible native keyboard focus. No color-only
  state. Existing reviews, original day navigators and exports
  retain behavior.
- All status data is from the **current organization's existing
  appointments**, via the existing saved-status index. No new API,
  database, migration, role, permission, session, external service,
  notification, payment or recurring booking system. The existing
  24-demo-session cap remains unchanged.
- No changes to ForgeOS or any other repository.

## Test plan
Extend the **existing** two-business, no-login Playwright Schedule
test without creating demo sessions:
- Confirm current first-of-four and third-of-six details, current
  weekday, and exact status text matching the selected numbered card.
- Confirm the panel disappears when changing recurrence rules excludes
  the selected agenda date, and returns when the rule includes it.
- Verify count changes from six to twelve to six preserve selected
  review focus; edge navigation updates focus to the last visit.
- Confirm invalid/overflowed previews hide the details and action.
- Use **Prepare currently reviewed visit** for the pre-existing
  one-date manual editor test: confirm date-only carry, empty
  title/time/customer/resource, no booking on Cancel, and same return
  plan. Existing numbered-card action is still tested for other dates.
- After an explicit **single** manual Save, verify the displayed
  date count refreshes and persists exactly one new record.
- Retain all existing DST/date-only unit tests, CSV/clipboard,
  keyboard/mobile, WCAG, authorization, resource conflict and
  no-auto-booking assertions.

## Merge gate
#215 remains **draft and unmerged** until all five checks on its
**final head** pass: Foundation, PostgreSQL, Browser,
Release install Ubuntu, Release install Windows. Fix failures
**on this same branch**, rerun and reverify. **Never auto-merge**.
