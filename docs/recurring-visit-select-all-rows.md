# One-tap Select all visit rows — LMS #237

## Experience
From **Schedule → Repeating visit planner → Preview saved-date review CSV**, press **Select all visit rows** to focus the read-only textarea and select every proposed visit row with one tap, even on narrow phones. The existing **Copy selected review rows** button then copies those complete rows with the original CSV column header. This selection action **does not touch the clipboard automatically**. Long-press/manual selections and existing full-table copy/download remain available.

The selection excludes the CSV header and final blank line. Each selection is derived solely from the existing strictly validated `recurringVisitSavedStatusCsv` output; a stale or invalid textarea silently refuses selection. React does not store selections or persist new state. Existing Copy-selected success/failure feedback is cleared on a new select-all request; all existing plan/status fingerprint protections remain.

## Safety
Read-only access to already-authorized, organization-scoped date/status count aggregates. No raw appointment records, names, staff/resource identifiers, timestamps, extra queries, appointments, booking, availability claims, persistence, API/schema migration, auth/session changes, payments, notifications or modifications to other repositories.

## Verification
Extend the **existing** two-organization scheduling Playwright session (no new demo sessions). On all desktop/tablet/phone projects, verify one-tap selects precisely all visit rows and excludes the header; copying that selection exactly matches the existing validated full CSV, with its header and CRLF format. Assert customer/work/resource details remain absent. Keep earlier manual single-row selection, clipboard errors, Compact view and accessibility tests.

**Draft and unmerged** until all five final-head GitHub checks pass: Foundation, PostgreSQL, Browser, Release install Ubuntu, Release install Windows. Fix failures on the same branch, rerun and verify. **Never auto-merge.**
