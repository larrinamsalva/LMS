# Recurring visit planner — saved appointment status breakdown (PR #204)

## Why
PR #201 previews 2–12 weekly/fortnightly/four-week cleaning or
maintenance dates without booking anything; #202 lets users review a
suggested date in the authorized Schedule; #203 shows how many
non-archived saved appointments overlap that business-local date.

That total can include **Cancelled** and **Completed** records. PR #204
adds a visible breakdown so the operator needn't mistake the total
for active/upcoming bookings.

## Display and behavior
- For each proposed date, show:
  **Saved statuses: Scheduled N · In progress N · Completed N · Cancelled N**.
  If an older retained record has an unrecognized/missing status, also
  show **Other N** rather than pretending it is scheduled.
- Preserve the #203 label **Already saved: N non-archived appointments**.
  The five status buckets sum exactly to that total.
- All existing **Review** buttons keep their accessible names and now
  describe both total and status text via scoped `aria-describedby`.
  Labels remain readable and neutral in light/dark modes and on phones.
- The preview remains anchored when reviewing a visit. Direct date
  editing/Previous/Next re-anchors as before. No time, resource,
  customer, appointment form or conflict constraint is changed.

## Source and safety
- The pure `savedAppointmentStatusesOnPlannedDates` accepts the same
  **already-authorized workspace in-memory records and IANA business
  zone** as #203. Parse each saved interval once, then use exact
  local-midnight overlaps for every proposed date.
- **Non-archived** appointments with a valid positive saved start/end
  interval count on every local day they overlap, even across midnight
  and 23/25-hour DST days. All statuses are preserved without
  reinterpretation; archived, other entities and corrupt intervals
  are excluded.
- The existing `savedAppointmentsOnPlannedDates` remains
  backward-compatible by projecting total counts from this exact
  shared calculation, preventing divergent counting semantics.
- **Zero or cancelled counts never confirm available staff, equipment,
  space or booking slots.** Completed history and cancelled records
  remain visible as saved-record history. No implicit priority, resource
  release/assignment proof or safe-to-book claims.
- No new API, database, migrated schema, saved recurrence, automatic
  booking, permission change, invoice/export or deployment. Other repos
  including ForgeOS are untouched.

## Verification and merge gate
- Unit tests assert explicit Scheduled/In progress/Completed/Cancelled/
  Other totals, archived and malformed exclusions, midnight and
  daylight-saving overlaps, legacy total parity, 720 fictional
  calendar dates and immutability.
- Extend the existing fictional no-login Playwright scenario in **both**
  cleaning and property workspaces: visible status labels, their
  summed parity with total, accessible descriptions, cross-date
  review stability, re-anchoring, full-range rejection and zero writes.
- Keep PR #204 **draft/unmerged** until final-head Foundation,
  PostgreSQL, Browser, Ubuntu release install and Windows release
  install are all green. Fix failures on the SAME branch; never
  automatically merge.
