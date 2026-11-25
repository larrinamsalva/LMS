# Status-based recurring review selection — LMS #239

In Schedule → Repeating visit planner → Preview saved-date review CSV, select **With saved appointments**, **No saved appointments**, or **Cancelled-only appointments**. With saved appointments includes cancelled-only records. Cancelled-only requires at least one saved record and all saved records cancelled. The selection counter and selected visit numbers identify matching rows, even when non-adjacent. The full read-only CSV preview stays unchanged; Copy selected review rows copies only matching complete rows with the original header, visit numbering, CRLF and NOT BOOKED warning. No matches means no clipboard write. Select all, Clear selection, or interacting directly with the textarea returns to manual selection. Closing the preview or changing the recurrence resets selection.

The feature works only on already-authorized aggregate date/status counts and the existing validated formatter; it cannot book visits or confirm resource availability. No raw record exports, names, times, persistence, API/schema changes or other repositories.

The existing desktop/tablet/phone scheduling test checks each selection against the validated exported CSV and verifies exact copy or no write when empty, then restores select-all. No new demo sessions. Keep draft/unmerged until all five final-head checks pass. Never auto-merge.
