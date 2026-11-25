# Recurring review row selection counter — LMS #238

In Schedule → Repeating visit planner → Preview saved-date review CSV, the read-only preview now displays the number of selected visit rows out of the total proposal. Select all visit rows and keyboard/manual selection update the counter. Partial selections count complete intersected visit rows, using the same helper as Copy selected review rows; header-only or empty selections count zero. Clear selection collapses the textarea selection and resets the counter and selected-copy feedback without touching the clipboard. Closing/reopening the preview or changing recurrence rules resets the selection state.

The counter and selection operate on the same strictly validated, organization-scoped date/status aggregate CSV. No booking, resource availability claims, raw records, customer/staff/resource identities, time data, persistent state, API or schema changes, new demos or other repositories are involved.

The existing desktop/tablet/phone Schedule scenario verifies initial zero, one selected row, select all, exact CSV copy, clear, no copy on empty selection, and reopening reset. No extra demo sessions. Keep the PR draft/unmerged until final-head Foundation, PostgreSQL, Browser, Ubuntu and Windows install checks all pass. Never auto-merge.
