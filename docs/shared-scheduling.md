# Shared customer relationships and scheduling

PR #10 adds one optional `scheduling` manifest, one record engine and one generated form/schedule interface for fictional property and cleaning workspaces. No public persistent-business/authentication endpoint, notifications, billing, production account or recovery activation is enabled.

## Try both workflows

Run the existing setup (`npm ci`, `npm run dev`) and open the no-login fictional demo. Each browser keeps its own temporary property and cleaning organizations. The supplied examples already include one linked appointment and exclusive resource; **Schedule** opens an agenda at the first appointment's date.

1. Choose **Cleaning Company**. Add a customer. In **Cleaning jobs**, create a job and select that customer. Create a **Crew or resource**, choosing Crew, Worker or Equipment. These are fictional catalog entries, not staff accounts or crew membership.
2. Open **Schedule → Add appointment**. Select the customer, linked cleaning job and assigned crew/resource. Enter start/end, booking time zone, status and optional notes. Scheduled date follows the start in that booking zone. Save, return to Schedule and select that date.
3. Try a second overlapping appointment for that same resource: it is rejected. A back-to-back appointment or a different resource is allowed. Use **Edit / reschedule** to move the first booking; no new appointment is created by an edit.
4. Choose **Property Manager**. Create a customer and a **Maintenance request**, link its customer and optional site/unit, then create a Worker or resource. Schedule that request through the same Schedule interface. The site follows the request; a conflicting customer/site is rejected.
5. Archive an appointment and enable **Show archived appointments** to view its retained links/history. Restoring rechecks availability. Referenced customers, work, resources or sites cannot be archived while active records still depend on them: archive the dependent appointments/work first. There is no destructive delete command.

The form lets users choose only same-workspace records. PostgreSQL enforces scope and target type independently; changing an ID manually cannot link another organization. A viewer cannot schedule or edit; owner/admin/staff follow the existing operational-write permissions. Role/ownership administration remains separate.

## Configuration and shared records

New presets/examples use `BusinessConfig.schemaVersion:1`, optional `timeZone` (older configurations default to UTC), `reference` fields with an explicit `target`, and `datetime` fields containing absolute RFC 3339 instants. Existing fields and module API v1 remain compatible. Required references need an enabled target; optional references to disabled modules retain history but cannot acquire new links until that module is enabled.

| Shared entity/field | Meaning |
| --- | --- |
| `customers` | Existing customer records |
| `jobs.customer` / `tasks.customer` | Customer reference on work; optional for ordinary records, mandatory before that work can be scheduled |
| Property `tasks.site` | Optional unit/site reference |
| `resources` | Configured exclusive crew/worker/equipment catalog; one resource per appointment |
| `appointments.customer`, `work`, `resource`, optional `site` | Typed, organization-scoped links; work target is `jobs` for cleaning and `tasks` for property |
| `appointments.start`, `end` | Normalized UTC instants, whole-minute precision, positive duration up to 24 elapsed hours |
| `appointments.time_zone`, `scheduled_date` | Retained IANA booking zone and start date in that zone; supported local dates 2020–2100 |
| `appointments.status`, `notes` | Scheduled, In progress, Completed or Cancelled; optional plain-text notes |

Names/terminology, navigation and work-reference targets live in configuration. A reviewed custom work entity can participate if it declares the same customer reference; there is no industry-specific scheduling service. The manifest example is [scheduling.module.json](../examples/scheduling.module.json).

A job's legacy service date/due date and work status remain independent work details; appointment times/status are the scheduling authority. Scheduling does not silently change those work fields. Automatic workflow/status synchronization is deferred. An appointment retains its customer/work/site identity: edit its times/resource/status/notes, or archive it and create another for different work. Once work has any appointment history, its customer/site identity is retained; create a new work record to change that historical relationship. Titles/notes/status remain editable within their normal rules.

## Time zones and DST

**Business time zone** in Project & modules changes display and new-booking defaults through a new configuration revision. It never shifts stored UTC instants or rewrites an appointment's booking zone/date. Schedule shows the selected day's overlapping intervals in the current display zone, including overnight work; booking edits use the appointment's retained zone.

Local form times are converted with the maintained Temporal polyfill. Nonexistent spring-forward times are refused for every occurrence choice. A repeated autumn time requires **First occurrence** or **Second occurrence** explicitly. The saved occurrence/offset is retained when editing notes; editing its clock time or booking zone requires a fresh choice if ambiguous. Changing the booking zone reinterprets the entered clock times, so review before saving.

The API accepts explicit absolute instants with offsets, not ambiguous local wall times. It normalizes them to UTC and verifies the scheduled date in the booking zone. Invalid/zero/reversed ranges, seconds/fractions, unknown zones, date mismatches and durations over 24 elapsed hours fail. PostgreSQL independently validates range/date/zone/precision. Installed browser/Node/PostgreSQL time-zone data must be maintained consistently; this phase does not certify every historical/global timezone revision.

## Database constraints and archive behavior

Migration `007_relationship_scheduling.sql` adds `btree_gist`, organization-scoped `record_links`, a trigger-maintained appointment projection, operation receipts and a private coordination epoch. Records remain the source of truth and reuse the existing audit trigger. Composite foreign keys bind source/target records to the same organization; new/changed/restored references require an active, correctly typed target. Ordinary roles can read authorized projections but cannot mutate them or receipts directly. All added tables enable/force RLS; the coordination epoch has no runtime grants.

The GiST exclusion constraint covers `(organization_id, resource_id, [start,end))` for non-archived, non-Cancelled appointments. Equal boundaries do not overlap. Completed work retains its historical reservation; cancellation or appointment archive releases it. Restoring/reactivating can fail if its interval has been taken. No override/allow-conflict field exists.

A narrow private trigger advances a real coordination-row version per organization before record/config mutations. Together with the existing engine organization lock, this serializes relationship/archive checks and makes stale REPEATABLE READ writers fail rather than admit a write skew. The exclusion constraint independently rejects overlapping assignments. Serialization/deadlock/busy failures require reload/review; no automatic retry occurs. Raw SQL still depends on the existing trusted server identity assertion, not browser-supplied user IDs.

Archiving never cascades into child deletion. Active incoming links block target archive; archived records keep their IDs and references. Correcting/deleting source history is not an archive operation. Physical deletions remain unavailable to ordinary roles; native backups retain projection/receipt metadata. The temporary demo's documented session expiry still removes its complete fictional organizations.

## Duplicate submissions and host API

The existing engine methods now accept an optional operation UUID:

```ts
await engine.saveRecord(principal, organizationId, 'appointments', data,
  existing ? {id: existing.id, revision: existing.revision} : undefined,
  operationId);
await engine.archiveRecord(principal, organizationId, recordId,
  expectedRevision, true, archiveOperationId);
```

Use one new UUID per intended save/archive. Retry the **identical** request with the same UUID after an uncertain response. The receipt is scoped to organization and actor, commits with record/projection/audit, and returns the original result without another write, even after later edits. Reusing a UUID with different data/revision fails. A different actor cannot obtain that result or reuse the operation. Stale edits with a new UUID fail normal optimistic revision checks. Unkeyed clients/configuration writes have no idempotent-retry guarantee.

The generated form keeps its operation ID for an unchanged retry; a changed payload is a new intent. After an uncertain response, retry unchanged or reload/review current records before starting a different intent. The demo transport accepts `operationId` on its existing save/archive actions; it exposes no SQL/principal or persistent-business route. Raw SQL outside the engine must still obey DB constraints, but is not a client command API.

## Safe upgrade and limits

Back up, stop identity/business hosts and run `npm run db:migrate -- --database lms_development` using the existing separate local administrator. Migration 7 takes the exclusive maintenance lock/table locks, installs the contrib extension and schema atomically, and keeps migrations 1–6/checksums unchanged. PostgreSQL server packages must include `btree_gist`; no paid service is needed. The embedded demo registers PGlite's packaged extension and loads the **same** migration 7 after immutable migration 1, without identity/recovery schemas or credentials.

Existing configurations, records, memberships and audits are not rewritten or given fabricated links. Untracked preexisting `appointments` rows refuse migration instead of being silently adopted. Populated entity field contracts remain immutable; adding customer reference fields to an older populated work schema needs a separate reviewed data/config migration. Start a fresh fictional workspace to use the updated presets, or rehearse an explicit compatible configuration upgrade. Do not erase history or alter applied SQL to obtain a passing upgrade.

Limits remain 250 total records/workspace and 40 configuration revisions. Resources have capacity one; crew members, availability, skills, time off, buffers and multiple-resource appointments are later work. This is a responsive daily agenda, not a drag/drop or recurring calendar. Recurrence, external calendars, reminders/messages, live finance and AI optimization are deferred. Native PostgreSQL persistence remains host-only; ordinary business writes still need complete public authentication/session fencing and production acceptance. Every credential/recovery/publication control and activation blocker remains in force. See [verification](shared-scheduling-verification.md) and [roadmap](../ROADMAP.md).
