# Recurring visit planner — reviewed date saved-status TXT (PR #231)

## Goal
After #230 added a complete, validated **saved-date review CSV**, offer an equally safe one-date status summary alongside the existing **Download reviewed visit TXT** button. This makes focused review practical on a phone or offline without exporting customer details or claiming a proposed booking.

## Experience
- In Schedule > Repeating visit planner > **Reviewed proposed visit details**, add a clearly distinct **Download reviewed visit status TXT** button. It sits beside the unchanged **Download reviewed visit TXT** (which remains a date-only note) and other reviewed-visit actions.
- Its download filename is **`lms-reviewed-visit-status-YYYY-MM-DD-NOT-BOOKED.txt`**, where the selected date is an exact validated member of the existing bounded 2–12-visit proposal. It is visible only when a valid proposed date is actively reviewed, including **Compact view**. Hidden when the agenda is not in the proposal or the proposal is invalid/overflowing.
- The text contains the **original one-based visit position**, selected business-local date (no time), total existing non-archived saved appointment overlaps on that date, numeric Saved status counts (Scheduled, In progress, Completed, Cancelled, Other), the existing classification (No saved appointment records, Cancelled-only saved records, Has non-cancelled saved records), and two explicit non-booking/nonavailability disclaimers. **No raw appointment record values** or free-form status strings are included.
- This TXT is a distinct file from the existing date-only reviewed visit note and from the full date-count CSV. The existing **Copy reviewed visit** and **Preview visit note** remain date-only and unchanged to avoid silently changing previously established sharing semantics.
- The saved-record status counts are **already visible, authorized, business-local per-date summary numbers**, derived from current organization-scoped data. A Cancelled non-archived saved record remains counted as saved. Overlapping overnight records follow the existing local-calendar overlap policy. Dates with zero saved records are **NOT** deemed available.
- Data is generated locally at click time without new queries, server requests, persistence, appointment Save, staff/equipment reservations, or recurring booking. The download is a text Blob and a canonical YYYY-MM-DD filename, with no user-controlled file path.

## Validation
- Extract a common pure `validatedSavedDateProposal` helper from #230's CSV generator so **both** exports use the same strict guard: the preview is valid (2–12 dates), status rows match exact date/position, each count is a nonnegative safe integer and the five status subtotals exactly equal each day's total.
- Use a shared fixed-label `savedDateClassification` to ensure CSV and TXT use identical no-saved/cancelled-only/other classification. The selected date must match exactly one member of the regenerated proposed date series, otherwise throw before returning content.
- Only numeric data and canonical date strings reach the file; don't export raw status values (even if unknown), customer names, job/service text, staff names, equipment names/IDs, organization identifiers, appointment times, location/notes, or spreadsheet formulas.

## Tests
- Unit: mixed Scheduled+Cancelled, cancelled-only, archived-only/no-saved, unknown Other and unrelated records; verifies exact one-date content, one-based original position, immutable input, and zero record/time/customer leak. Invalid selected/nonmember date and malformed/misaligned/noninteger or inconsistent totals are rejected. The shared #230 CSV unit tests ensure no CSV regressions.
- Extend the **existing** no-login Playwright Schedule session across **both fictional organizations** without adding any demo sessions: download selected first visit's TXT and match saved count + status breakdown to the already-rendered focused panel; assert exact safe filename and nonavailability, no customer/resource/work/timestamp. Keep the action present in Compact view; hide it when agenda date falls outside the plan and on invalid/overflowing previews. After an **explicit single appointment Save**, download the refreshed status TXT on visit 4 of 6, check nonzero Scheduled category and correct non-cancelled classification while retaining NOT BOOKED warning.
- Preserve current WCAG/mobile tests, original date-only copy/download and CSV, organization isolation, staff/equipment conflict checks, existing manual Save/Cancel protections, and fixed 24-demo-session cap.

## Safety and merge gate
Read-only text export of already-authorized aggregated **date statuses**. No automatic appointment, customer data export, availability claim, confirmed booking, server API, database/schema/migration, authorization/session change, notification, payment or change to ForgeOS or unrelated repositories.

Keep **#231 DRAFT / UNMERGED** until **all five checks on the final head SHA** pass: Foundation, PostgreSQL, Browser, Release install Ubuntu, Release install Windows. Fix failures **on this same branch**, rerun/reverify all five, and **never auto-merge**.
