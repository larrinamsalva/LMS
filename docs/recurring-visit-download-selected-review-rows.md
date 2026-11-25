# Download selected recurring review rows — LMS #240

In Schedule → Repeating visit planner → Preview saved-date review CSV, choose visit rows manually, select all, or choose a saved-appointment status, then press **Download selected review rows**. The local CSV download uses the exact same validated selection as Copy selected review rows, retaining the original header, complete matching rows, original visit numbers, CRLF line endings and NOT BOOKED notes. Empty selections disable downloading. Separate feedback reports a download request, not a completed file save. Changing or clearing selection resets download feedback.

The file contains only organization-scoped aggregate date/status counts from the existing validated CSV. No raw appointment records, names, times, resources, booking, availability claim, API/database/schema/auth changes, persistent selection or other repositories are involved. The existing full CSV download remains available.

The existing desktop/tablet/phone scheduling test verifies single-row download byte equality to copied CSV, filtered rows byte equality, filename and empty selection disabling. No new demo sessions. Full local suite not run; keep draft/unmerged until all five final-head GitHub checks pass. Never auto-merge.
