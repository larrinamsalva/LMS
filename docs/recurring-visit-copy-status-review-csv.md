# Recurring visit planner — copy saved-date review CSV (PR #234)

## Goal

PR #230 added a downloadable, privacy-safe **saved-date review CSV** with numeric status counts for each proposed visit. Users, especially on phones or tablets, should be able to copy the **exact same validated CSV** into a spreadsheet without requiring a local file download.

## Experience

- Inside the valid 2–12-date **Repeating visit planner**, preserve **Download planned dates CSV**, **Download saved-date review CSV**, and the date-only **Copy planned dates** controls.
- Add a separate native **Copy saved-date review CSV** button alongside the saved-date CSV download. It uses **exactly** the existing pure `recurringVisitSavedStatusCsv` generator, with the same header, CRLF separators, original proposal visit ordinal, canonical ISO business-local date, non-archived saved appointment total, Scheduled/In progress/Completed/Cancelled/Other counts, fixed date classification, and explicit **NOT BOOKED / availability not confirmed** text. No new raw record reads or CSV formatter.
- Its copied content can be pasted into spreadsheet software with column headers. It includes no appointment timestamps, customer/work/staff/equipment names, identifiers or free-text fields, and no user-supplied spreadsheet formulas. The existing strictly validated generator rejects stale, invalid and inconsistent status summaries.
- Copy requires an **explicit user click** and native browser clipboard access. The app does not copy from render/effects or claim success on denied permissions.
- Separate `savedReviewCsvCopyFeedback` state and a dedicated accessible `role="status"` message keep it independent of the date-only **Copy planned dates** feedback and the one-date **Copy saved status summary** feedback. On success, display **Saved-date review CSV copied. No visits were booked or confirmed.** On clipboard denial/unavailability/validation error display **Could not copy saved-date review CSV. Clipboard access may be blocked; use Download saved-date review CSV instead.**
- The feedback identity is keyed to **the proposal anchor, recurrence interval/count and the current authorized per-date status totals for every proposed date**, so it cannot misrepresent new status counts after a single appointment Save/Cancel or a changed recurrence. The existing five explicit proposal re-anchor/change handlers also clear it so changing rules away/back never resurrects a prior message. Read-only selection of another proposed date keeps the full-plan CSV feedback valid because it doesn't alter the proposal.
- The button works in **Compact view** when numbered date cards are hidden. It disappears, along with the rest of the export actions, when an invalid or overflowing proposal cannot produce a bounded date sequence. Do not create any booking, staff/equipment reservation or claimed free capacity.
- Reuse dark/light accessible contrast styles, 44px native export buttons, and responsive wrap layout already used by the existing date-only clipboard feedback.

## Tests

- Extend the **existing two-organization no-login Playwright scheduling test** without adding demo sessions (retain the strict 24-session limit). Download the #230 saved-date review CSV for six proposed visits, press the new Copy button using a stubbed clipboard, and assert that copied text is **byte-for-byte identical** to the downloaded CSV (including header, numeric categories, visit numbers, fixed warning and CRLF).
- Verify clipboard denial yields visible failure/help instead of stale success and does not affect original date-only copy feedback. Changing the recurrence resets the full-table copy feedback (and doesn't resurrect it when rule is restored).
- Verify button visibility in Compact view and no button/feedback for invalid, overflowing recurrence.
- After the existing single **explicit manual Scheduled appointment Save**, download refreshed full review CSV and copy the current full review CSV; assert strict equality and no customer/work/equipment leakage. Original date-only copy and one-date status copy controls continue to have their own separate state and tests.
- The pure #230 CSV generator is reused unchanged and its existing unit tests already enforce exact date membership, nonnegative safe integers, summing status totals, fixed classifications, no injection and immutable inputs.

## Safety and merge gate

**User-triggered, read-only clipboard copy of already-authorized, organization-scoped date-level count data.** Not a booking, capacity check, free-slot determination, appointment export or automatic recurring Save. No new API, database/schema/migration, persisted data, authorization/session change, notification, payment, added demo sessions, ForgeOS or unrelated repo changes.

Keep **#234 DRAFT / UNMERGED** until all five GitHub checks pass on the **final head SHA**: Foundation, PostgreSQL, Browser, Release install Ubuntu, Release install Windows. Fix any failure **on this same PR branch**, rerun/reverify all five, and **never auto-merge**.
