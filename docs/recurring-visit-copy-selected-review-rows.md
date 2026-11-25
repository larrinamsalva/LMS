# Copy selected saved-date review rows — LMS #236

## Experience
In Schedule → Repeating visit planner → Preview saved-date review CSV, select text in one or more visit rows and press **Copy selected review rows**. The button copies **complete matching visit rows** plus the existing CSV column header, preserving original proposal ordinals and the existing strictly validated business-local dates and aggregate saved-status counts. A partial text selection anywhere in a row includes that full row. Selection of the header or warning alone copies nothing and prompts the user to select a visit row.

A clipboard denial or unsupported browser displays failure with a manual selection/full-download fallback; success is displayed only after the clipboard promise resolves. Selection and feedback are not persisted. A changed plan or aggregate-status fingerprint hides stale messages, and explicit schedule re-anchoring or recurrence change clears them. The preview remains a read-only phone-friendly textarea and existing full CSV preview, copy, and downloads stay available.

## Privacy and scope
Rows are selected only from the existing validated `recurringVisitSavedStatusCsv` formatter output, never directly from appointment records. There are no customer, job, employee, resource identities, times, free text, raw records or new queries. Copying does not create or confirm bookings, staffing/resource availability, recurring appointments, notifications, payments, or any changes to persistence/schema/API/authorization. No other repository (including ForgeOS) is touched.

## Tests and merge gate
Extend the **existing** two-organization Playwright scheduling session only (preserve the 24-session cap): verify empty selection feedback, partial selection expanded to complete data row plus header, no unintended rows or customer/job/resource leakage. Keep full-preview, compact mobile layout, invalid proposal and independent copy feedback tests intact.

Keep pull request **draft and unmerged** until final-head Foundation, PostgreSQL, Browser, Release install Ubuntu, and Release install Windows pass. Fix failures on the same branch and rerun all five checks; never auto-merge.
