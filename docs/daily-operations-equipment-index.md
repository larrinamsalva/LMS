# Daily Operations — indexed equipment record lookup (PR #176)

## Purpose

The read-only **Equipment to review** and **Upcoming equipment
inspections** sections both resolve saved equipment state snapshots
to the same authorized equipment directory. Previously, each state
independently scanned all of the organization's current records
using `records.find()`, once per section.

Both sections now use one temporary `Map<string, WorkspaceRecord>`
keyed by the **record ID**, built from the **already
same-organization, non-archived** record array within
`summarizeDailyOperations`. Only records with
`entity === "equipment"` are indexed.

## Compatibility and safety

- The **first matching current equipment record wins**, exactly
  matching the original `find()` behavior for duplicate retained
  revisions with the same ID. A later duplicate cannot override it.
- Non-equipment records, archived equipment, and records belonging
  to other organizations are excluded from the lookup. Identical
  equipment IDs across organizations remain isolated.
- A state record continues to be selected only when
  `state.organization_id` matches the current workspace.
  Duplicate state occurrences are retained; this is not a
  deduplication or repair.
- Current warnings still use the recorded equipment condition,
  retiring conditions, and due/overdue inspection dates. Upcoming
  inspections still include **serviceable** assets with an actual
  saved next-inspection date in the following seven business-local
  calendar days, never an inferred inspection date.
- Both original stable presentation orderings and reason labels
  are unchanged. No record is rewritten, reclassified or marked
  safe by this optimization.
- The index is constructed afresh for each read-only summary call
  and is not cached across edits, organization changes or dates.

## Regression verification

`tests/unit/daily-operations-equipment-index-parity.test.ts`
includes an independent reference copied from merged five-green
LMS #175: it uses **the original repeated `records.find()`
logic** for both current equipment warnings and future inspections.

The tests check the exact **record references, row order, reasons,
dates and duplicate occurrences** for **720 fictional equipment
state revisions** across three time zones and five selected dates.
The fixture includes current/archived/foreign equipment,
same-ID revisions, non-equipment collisions, retired and unsafe
conditions, serviceable inspection boundaries, duplicate state
references and state/record edits between summary calls.

The tests establish behavioral parity, **not benchmarked speed**.

## Non-goals and merge gate

No equipment safety decision, equipment action or retirement
workflow, persisted history, authorization, employee scheduling,
booking authority, UI, export schema, API/database/migrations,
release/deployment, MIT license, fictional public no-login demo,
or other repositories including ForgeOS is changed.

PR #176 remains **draft and unmerged** until Foundation, PostgreSQL,
Browser, Ubuntu install and Windows install have **all passed on the
final head SHA**. Repair failures on the same branch. Never
auto-merge.
