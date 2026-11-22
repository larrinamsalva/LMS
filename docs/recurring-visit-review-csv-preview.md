# Recurring visit planner — preview full saved-date review CSV (PR #235)

## Goal

After #230 added a date-level status-count CSV download and #234 added a matching clipboard copy, offer a **read-only, selectable full-table preview** so phone/tablet users can inspect the exact date/count data in LMS before copying or downloading, or select it manually when clipboard permission is unavailable.

## Experience

- In Schedule → Repeating visit planner, preserve existing Download planned dates CSV, Download saved-date review CSV, Copy saved-date review CSV and date-only Copy planned dates buttons.
- Add a separate **Preview saved-date review CSV** native button with initial `aria-expanded=false`. When expanded, label becomes **Hide saved-date review CSV preview**. Below the export actions, show a labeled, read-only and selectable textarea **Selectable saved-date review CSV — NOT BOOKED**. The control is hidden entirely along with the export section if a recurring proposal is invalid or overflows.
- The textarea receives the **exact same pure `recurringVisitSavedStatusCsv` output** as #230's download and #234's clipboard action: bounded 2–12 original proposed visit ordinals, ISO business-local dates, existing authorized non-archived saved appointment counts, Scheduled/In progress/Completed/Cancelled/Other breakdown, fixed classification, and **Proposal only - NOT BOOKED - availability not confirmed** notes. It never includes customer/work/staff/resource names, IDs, appointment times, free text, or raw records. **Zero existing saved appointments is not proof of availability.** This preview never saves, books, reserves, or checks resources.
- Native HTML textarea `value` normalizes CRLF to LF for visual/selectable text. The underlying pure CSV formatter, existing downloaded file and clipboard button keep their **original CRLF** representation, unchanged. The preview is for viewing and manual text selection; no new clipboard/Blob calls are triggered by opening it.
- Button and textarea stay available in **Compact view**, where repeated date cards are hidden; they use existing high-contrast theme-native `.recurring-visit-note-preview` styles with a small monospace enhancement and bounded textarea height for narrow phone screens. Existing keyboard, focus, live feedback and manual scheduling actions remain unchanged.
- Preview disclosure is ephemeral React state keyed to the **current recurring plan + the entire organization's current date-level saved status summary fingerprint**. It closes if the proposal's saved status totals change (e.g. after an explicit manual single appointment Save/Cancel), and also on explicit Previous day, Next day, Schedule date re-anchor, repeat interval and preview count changes. Rule change away and back never revives an old expanded textarea. Selecting a different proposed date via read-only planner navigation does not change this **full-plan** preview.
- No new user settings, persistent state, server queries, database migrations, record writes or data formatters.

## Verification

- Extend **the existing** two-organization no-login Playwright scheduling session; do **not** create new sessions (preserve the strict 24 demo session boundary).
- Verify initial collapsed button, aria-expanded state, and missing textbox; expand, confirm readOnly textbox and that its text exactly equals the already downloaded saved-date CSV with HTML newline normalization, including fixed original visit numbering, all saved status totals and explicit NOT BOOKED warning; no customer/work/resource content.
- Verify manual collapse; in Compact mode, open preview while normal date cards are hidden and run the existing phone/tablet/desktop fit checks.
- Expand again, change the repeat interval, verify it is closed, then restore the old interval and verify it stays closed (no resurrected stale preview).
- Invalid/overflowing dates hide the control and textarea. After the test's explicit manual single Scheduled appointment Save, expand again and assert the preview exactly matches the newly refreshed CSV download and therefore current saved status totals.
- Keep all existing accessibility audits (WCAG 2/2.1 AA), available desktop/tablet/phone scenarios, isolated fictional business workspaces, unchanged clipboard feedback and all standard manual appointment/resource verification tests.
- #230's strict unit validation of `recurringVisitSavedStatusCsv` is unchanged: only canonical date strings, safe nonnegative integers and fixed labels can reach preview, copy or download.

## Safety and merge gate

**Read-only view of already-authorized, organization-scoped proposed date/status aggregates**. No automatic recurring bookings, calendar availability claims, appointment/customer export, capacity/resource allocation, new query/API/database/schema/migration, persistence, auth/session change, notifications, payments, added demo sessions, ForgeOS or unrelated repo changes.

Keep **#235 DRAFT / UNMERGED** until **all five checks on the final head SHA** pass: Foundation, PostgreSQL, Browser, Release install Ubuntu, Release install Windows. Any failure must be fixed **on this same branch**, followed by full verification on the newest head. **Never auto-merge.**
