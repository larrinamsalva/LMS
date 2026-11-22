# Recurring visit planner — restore Compact view on manual appointment return (PR #217)

## Purpose
PR #216 introduced a **Compact view — hide date cards** checkbox for
valid, unsaved, 2–12-date recurring visit previews. It removes the
long date-card list from the page while retaining the visit selector,
focused visit details, saved appointment statuses, First/Previous/
Next/Last review, CSV/copy exports, and single-date manual preparation.

A user may prefer compact layout while reviewing a 12-visit plan,
then manually prepare **one** appointment. After **Cancel** or a
successful **Save**, the existing one-appointment return workflow
already restores the selected calendar date, preview anchor, interval
and count—but previously reset compact layout to the expanded list.

PR #217 restores the **same optional compact presentation** after
those two *explicit* return paths only.

## Behavior
- Opening Schedule normally always defaults to **full date cards**.
  Users explicitly opt into Compact view with the existing checkbox.
- When the user opens the existing manual appointment editor from
  either **Prepare this visit manually** in the focused panel or a
  numbered date card, only one additional **boolean**
  `compactPreview` preference is sent in the **current volatile
  RecurringVisitReturnPlan**, along with already validated start
  date/weekly rule/count/selected date.
- The parent Workspace retains the route **only in component state**
  and only for the **same organization** while the single
  appointment is being edited. It is never written to the
  server, localStorage, sessionStorage, a browser cookie or a
  downloaded export.
- **Cancel** and successful **Save** use the pre-existing
  `returnToPreparedRecurringPlan` flow. The return plan is
  revalidated, the same selected business-local date and series
  are restored, and the Schedule's initial checkbox state is
  initialized from `compactPreview === true`.
- When the user did **not** check compact mode, the return remains
  expanded as before. Legacy return plans without this optional
  field remain fully compatible and default expanded.
- When compact mode was checked, the returned checkbox is still
  checked, the numbered cards remain hidden, and the direct
  visit picker, focused saved-status counts and single-date
  Prepare shortcut remain fully usable.
- The user can uncheck at any time to reveal all the original
  proposed date cards and the exact selected visit highlight.
- An unrelated Add, ordinary navigation, different organization,
  or any reset of the transient return route **never carries
  over** compact mode.
- Wrong-type return preferences (including strings, numbers, null,
  objects or arrays) are rejected with a RangeError rather than
  being coerced into true or persisted. The entire preview
  membership check still runs before a return can be restored.

## Safety
**Compact mode is strictly a UI preference.** It changes no date,
time, saved appointment, customer, resource, crew, booking, status,
business configuration, authorization, invoice, payment, notification,
workspace session, appointment editor validation, or other app.

No new server API, database table, migration, persistent recurrence,
staff/equipment reservation or transaction is introduced. The
existing 24-session fictional demo cap, organization boundaries
and all final Save conflict/authorization checks stay intact.
ForgeOS and every other repo remain unchanged.

## Testing
- Vitest: old, four-field return route remains byte-for-byte
  identical; true/false compact flags remain boolean and validated;
  wrong types are rejected; original date/interval/count validation
  still enforced without side effects.
- Extend the **same** Cleaning Company and Property Manager
  no-login Playwright scheduling session—**no extra demo sessions**:
  - Set Compact view before manual appointment preparation from
    the focused visit; confirm Cancel restores checked layout
    with hidden cards and correct visit details, then uncheck
    to confirm all six original cards return.
  - Start another explicit manual booking while in compact mode
    using the focused panel; complete ordinary required fields
    and Save. Confirm the returned plan keeps compact view and
    the same selected date/status counts. Uncheck and confirm
    existing per-date saved appointments show the newly saved
    record—exactly one write from the explicit form.
  - Existing tests still verify normal Add does not inherit a
    stale planned date; invalid previews, 12-visit navigation,
    mobile fit, WCAG checks, CSV/copy and session boundaries.
- Do not alter the production 24-session cap or add separate tests
  that consume sessions.

## Merge gate
Keep #217 **DRAFT / UNMERGED** until all five checks on the
**final head SHA** succeed: Foundation, PostgreSQL, Browser,
Release install Ubuntu and Release install Windows. Fix failures
on **this same branch**, rerun and reverify. Never auto-merge.
