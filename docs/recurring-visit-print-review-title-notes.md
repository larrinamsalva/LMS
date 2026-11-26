# Optional print report title and planning notes — LMS #244

Open Schedule → Repeating visit planner → Preview saved-date review CSV → Optional print report title and notes. Enter an optional custom title (100 characters) and planning notes (500 characters). These appear as literal text below the fixed LMS NOT BOOKED heading and warning in the printable report. The notes are visibly labeled user-entered. Do not enter private customer, staff or resource details; the text is included in any report you print or share.

Annotations are temporary local component state keyed to the current review CSV. They are never included in the CSV or clipboard exports, saved to records, or sent to an API. Clear print title and notes explicitly removes them; closing/reopening the CSV preview and changing recurrence context reset them. Existing reports are snapshots and must be closed or discarded separately.

The existing desktop/tablet/phone scheduling scenario checks optional blank fields, literal markup-looking text, unchanged CSV, fixed warning, clear and reopen reset. No new demo sessions, booking, availability claims, schema/auth/database changes or other repositories. Full suite not run locally; all five final-head checks must pass before merging. Never auto-merge.
