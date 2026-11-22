# Recurring visit planner — clarify dates with no saved appointment records (PR #228)

## Goal

LMS #227 made dates with **only cancelled** saved appointments legible directly on recurring-visit proposal cards and in focused visit details. Their opposite case—proposed calendar dates with **zero already-saved, non-archived appointments**—should be equally easy to spot, especially when Compact view hides the date cards.

Add a small text-only clarification for zero-record dates, explicitly avoiding a free/available/booked interpretation.

## User experience

- On each existing numbered proposed-date card whose **already computed** business-local `savedAppointments` total is exactly `0`, display:
  **No saved appointments on this calendar date — NOT BOOKED by this proposal; availability not confirmed.**
- In the **Reviewed proposed visit details** panel, when its currently selected date has zero saved appointments, display:
  **No saved appointments on this calendar date. The proposed visit is NOT BOOKED, and staff or equipment availability is not confirmed.**
- No marker is shown for a date with **any** non-archived existing saved appointment, including **Cancelled**, **Completed**, unknown/Other, or a valid overnight spanning appointment. Archived-only, unrelated entities and corrupt intervals remain excluded by the established authorized date/status calculator; they cannot prove staffing or availability either.
- **Empty-record dates** and **cancelled-only saved-record dates** are mutually exclusive. They must never both appear on the same date card or selected-visit panel.
- No free-slot status, optimistic availability icon, booking button shortcut or invented appointment time is added. The labels are context only and preserve the existing manual one-date appointment preparation and validation.
- Compact view continues to hide repeated cards but keeps the focused visit visible; its zero-record clarification remains in the focused panel. Invalid or overflowing proposals hide cards, selected panel, and these clarifications with the existing validation.
- Clear, high-contrast text and border styling reuse the existing dark/light responsive #227 status clarification CSS. Existing status breakdown, six calendar-only overview metrics, coverage counts, cancelled-only date list, previous/next shortcuts, and date-only clipboard/TXT/CSV exports remain unchanged.

## Implementation

- Add pure `hasNoSavedAppointmentsOnPlannedDate(status)` to `src/core/recurring-visit-saved-appointments.ts`. It returns `status.savedAppointments === 0` for a row from the same **already authorized, organization-scoped, business-local `PlannedDateAppointmentStatuses[]`** used by the date cards and overview. No new saved-record lookup, API call or mutation.
- Conditionally render the explanation in numbered date cards and reviewed visit details. Reuse existing accessible and theme-aware explanatory text styling; no separate client state.
- Do not conflate this record-presence predicate with **resource availability**, active reservations, appointment confirmation, future capacity or newly booked recurring visits.

## Tests

- Unit tests on authorized saved-appointment status rows: Scheduled, Cancelled and unknown/Other rows are **not** empty; archived-only and corrupt-only rows are empty **for non-archived saved appointment record presence**, without implying free capacity. Date zero count matches the existing coverage total, and no-saved and cancelled-only classifications are mutually exclusive. Preserve input and record immutability.
- Local-midnight overnight boundary: a single saved appointment spanning two business-local dates makes **both** dates non-empty; the following day with no saved appointment remains zero.
- Extend the **same** no-login Playwright Schedule test session used for both fictional Cleaning Company and Property Manager **without creating new demo sessions**:
  1. Derive four-date zero-record dates directly from the existing per-card `Already saved` totals. Exactly those cards get the new explanatory text.
  2. The selected visit shows the zero-record explanation if and only if its saved total is zero. Navigating to another eligible empty date and back updates it without re-anchoring the proposal. A card never shows both zero-record and cancelled-only explanations.
  3. On six-date plans the new label count matches the established `withoutSaved` count.
  4. In 12-date Compact view, full cards remain hidden but the selected-visit zero-record clarification matches the selected status total.
  5. Invalid/overflowing proposals hide the new labels. After the existing explicit single Scheduled appointment Save, the selected visit must **not** show the no-saved label.
  6. Preserve existing mobile/WCAG, record-isolation, conflict-checking, manual Save/Cancel, copy/TXT/CSV, recurring date validation and fixed 24-demo-session boundary tests.

## Safety

**Read-only explanation of absence of saved appointment records, NOT an availability or booking determination.** Zero saved records does **not** establish staff, equipment, space or time capacity. Do not introduce booking/reservations, new APIs, schema/migrations, stored data, role/auth/session changes, customer exports, notifications, payments, new demo sessions, ForgeOS or changes to other repositories.

## Merge gate

Leave **#228 DRAFT / UNMERGED** until all five checks pass on the *final PR head SHA*: Foundation, PostgreSQL, Browser, Release install Ubuntu and Release install Windows. Fix failures **on this same branch** and rerun/reverify all five. **Never auto-merge.**
