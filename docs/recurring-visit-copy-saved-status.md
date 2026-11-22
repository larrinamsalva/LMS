# Recurring visit planner — copy reviewed saved-status summary (PR #233)

## Goal

After #232 added a mobile-friendly, read-only, selectable preview of a reviewed recurring visit's existing saved appointment status counts, make sharing those same **non-identifying, validated date-level totals** easier without long-pressing text or downloading a TXT file.

## User experience

- In Schedule → Repeating visit planner → **Reviewed proposed visit details**, add **Copy saved status summary** beside the existing date-only **Copy reviewed visit**, **Download reviewed visit TXT**, **Download reviewed visit status TXT**, **Preview visit note** and **Preview saved status summary** controls. Distinct wording deliberately avoids silently changing date-only copy behavior.
- A press uses the browser's native `navigator.clipboard.writeText`, called **only** on click (not during render or a React effect). The exact copied value is generated at click time with the already-existing, strictly validated `recurringVisitReviewedSavedStatusText(startDate,everyWeeks,occurrences,selectedDate,statuses)`, the **same formatter as #231's TXT download and #232's read-only preview**. This avoids a diverging, unsafe fourth data format.
- The text contains **one** proposed visit's original ordinal, canonical business-local date, existing authorized non-archived saved appointment total, five numeric status categories, fixed no-saved/cancelled-only/other classification and explicit **NOT BOOKED / availability not confirmed** disclaimers. Never include customer/work/employee/resource names or IDs, appointment instants/times, raw statuses, notes or record details. No resource availability lookup or appointment creation.
- If the clipboard write succeeds, show a transient, accessible status message: **Saved status summary copied. No visit was booked or confirmed.** If the clipboard API is absent, permission is rejected, the browser is in an unsupported context, or validation fails, say **Could not copy saved status summary. Clipboard access may be blocked; use Download reviewed visit status TXT or Preview saved status summary instead.** Never show a false success.
- Use a **separate** `statusCopyFeedback` state; leave #231's date-only review copy feedback and full-proposal copy feedback untouched. Its identity is keyed to the **exact proposal, reviewed date and five saved-status counts plus saved total** so a previous async write cannot show a stale success under a changed organization/date/count. Reset it on read-only reviewed-date navigation, direct Schedule date re-anchor, previous/next calendar day, and recurrence interval/count changes (including change away then back). It is not persisted.
- The button stays usable in Compact mode even with normal date cards hidden. If the agenda is no longer part of the proposal or the proposal becomes invalid/overflowed, the whole reviewed panel—including this button and its feedback—disappears.
- Reuse the existing high-contrast dark/light accessible feedback CSS and 44px native button styling, with a **distinct class** `.recurring-visit-reviewed-status-copy-feedback` for the status summary message.

## Tests

- Extend **existing** no-login Playwright Schedule session for both fictional business workspaces, no new demo sessions:
  - Starts with enabled **Copy saved status summary** and no status-copy feedback.
  - Stub browser clipboard in this already-existing test session. A successful copy must be **byte-for-byte equal to #231's downloaded reviewed status TXT (minus the file's trailing newline)**. Confirm no names/customer/work/resource content or ISO appointment timestamps.
  - Ensure copying a saved-status summary does **not** show the separate date-only reviewed copy success.
  - Stub a permission rejection; verify visible failure guidance, never stale Copied success.
  - Changing reviewed date/plan resets the feedback; restored rules do not resurrect it.
  - Compact twelve-date view retains the button, while a nonmember agenda date and invalid/overflowed preview hide it and feedback.
  - After the test's explicit, single Scheduled appointment Save, copy the newly reviewed 4th visit and assert exact equality to the **newly refreshed** saved-status TXT, including the Scheduled count and fixed nonbooking caveat.
- Existing #231 unit tests cover the shared pure formatter's strict validation of proposed dates, bounded count, nonnegative safe integers, exact status sum, archived/cancelled/Other rules, and no record fields. This PR does not change the formatter or add duplicate unit tests.

## Safety and merge gate

**Read-only, user-initiated clipboard copy of the already-visible, current-organization date-level numeric summary**, not a booking, availability check or staff/equipment assignment. No new query, API/database/schema/migration, authentication/session change, persistence, automated recurrence, customer data, payment, notification, additional demo sessions, ForgeOS or unrelated repo change.

Keep **#233 DRAFT / UNMERGED** until **all five checks on the final PR head SHA** are green: Foundation, PostgreSQL, Browser, Release install Ubuntu and Release install Windows. Fix failures **on this same PR branch**, rerun/reverify final-head CI, and **never auto-merge**.
