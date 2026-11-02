# Equipment calendar mapping — fictional workspaces only

This optional `equipment-reservations` 1.0.0 capability connects retained machines to the existing shared schedule. It depends explicitly on Equipment, Scheduling and Workforce (Equipment also requires Inventory and Tasks). Existing businesses, Gallery snapshots, saved drafts and portable formats are unchanged. Enable it deliberately in Studio, review dependencies and use the existing publication controls. No independent calendar or automatic checkout is introduced.

## Try the workflow

1. In the no-login fictional workspace, use BuildPlan Studio to select **Equipment calendar mapping**, review its dependencies, save and explicitly publish a compatible configuration. Populated-schema restrictions still apply.
2. In **Equipment & Tools**, add a fictional machine and storage location. Complete the existing inspection/release review with an active employee. New machines start blocked for inspection.
3. Add a scheduling Resource with kind **Equipment**. A similar name is not a mapping.
4. On the machine's **Review calendar mapping**, select the exact resource, describe the review, check the confirmation and confirm. Owner/admin permission and exact equipment/resource/configuration/mapping revisions are checked in PostgreSQL.
5. Open **Schedule**, add a customer-linked work appointment and select that resource. The existing one-resource model reserves the machine only. A separate crew appointment is not linked or promised by this phase.
6. Review the readable machine identity in Schedule and its current/upcoming/history list in Equipment. Use the period checker for a preliminary view. The authoritative transaction can still refuse stale or conflicting work.
7. Try an overlapping booking: the original `exclusive_resource_time` PostgreSQL exclusion refuses it. Back-to-back intervals are allowed. Cancel/archive releases the calendar slot; restoring or rescheduling checks safety, enrollment, resource availability and conflicts again.
8. Report a problem even with future reservations. They remain intact and display a safety warning. No cancellation, physical collection, return or message is automatic.

Host-only persistent fictional callers use the existing authenticated-host `Principal`, `Engine.mapEquipment(principal, organizationId, input, operationId)` and ordinary `saveRecord`/`archiveRecord` scheduling methods. The only added browser action is on the **temporary demo** transport with its existing HttpOnly cookie, expiry, same-origin and scoped-organization checks. There is no persistent business HTTP route. Never treat a UUID or mapping receipt as authorization.

## Authoritative storage and history

Migration **018_equipment_reservations.sql** is additive and uses the stopped-runtime advisory lease plus exclusive table locks. Apply using the existing documented `npm run db:migrate` local-fictional procedure after stopping hosts. Migrations 001–017 are unchanged. It does not infer mappings or rewrite historical appointments.

| Table | Purpose |
| --- | --- |
| `lms.equipment_resource_mappings` | Current revision per physical machine; unique active resource within its organization |
| `lms.equipment_mapping_history` | Immutable map/unmap snapshots, exact source revisions, actor and operation identity |
| `lms.equipment_reservations` | Immutable physical-machine/mapping snapshots per appointment revision; cancellation/archive snapshots retain history |

All three force RLS. Current members can read only their organization; `lms_app` has no direct mutation grant. Scoped foreign keys protect every retained reference. Commands use existing organization locks, record epochs, current membership row locking and operation receipts. Mapping, history, secret-free audit and receipt commit together. Identical authorized retries return the original committed result; changed input or actor cannot reuse an operation. Failed transactions leave no partial projection or receipt. A lost commit response requires the identical operation retry.

An Equipment calendar resource is permanently enrolled to one physical machine in this phase. Unmapping is explicit and refuses retained **blocking** reservations (including completed historical intervals) or active custody. A different resource may be reviewed only once old commitments have been explicitly released. A previously enrolled resource cannot be renamed/retyped into a second physical identity. Unmapped/disabled enrolled resources refuse new or restored blocking bookings. This prevents evading physical conflicts with a second mapping. Legacy unenrolled PR #10 resources remain resource-only when the optional capability is absent; no physical-machine availability is claimed for them. When the capability is enabled, an Equipment resource must have a reviewed mapping to accept a blocking booking.

Database booking guards share the same organization lock with custody and condition changes. They require current serviceable/clear evidence, no active checkout and completion before the recorded next inspection date (business-zone day, exclusive end). Existing workforce resource-unavailability windows and calendar exclusion remain authoritative. Scheduling, mapping and safety changes cannot race past their transaction ordering. Terminal retirement and maintenance do not erase reservations; dynamic warnings identify retained commitments requiring human review.

## Custody and time limits

A booking is a reservation of time, not proof of collection. Existing explicitly confirmed physical checkout remains independent; it may occur while calendar reservations exist and can make a retained booking require review. New bookings refuse current checkout, even if its expected return precedes the booking: an expected date is not a guarantee. No automatic reservation-to-checkout transition or future custody guarantee is supported. Safety reports always remain possible.

The agenda and period checker reuse Temporal, existing IANA business/booking zones, explicit offset instants, whole-minute precision, repeated-time choices and nonexistent-time rejection. Saved instants are not rewritten when the business display zone changes. Appointment ranges retain the existing 24-hour bound. Dates/overdue warnings run in the interface without background jobs. A period checker is advisory; only the database transaction accepts a booking.

## Persistence, recovery and compatibility

The native readiness closed inventory includes all three tables. The equipment native test additionally verifies active/cancelled reservations, immutable mapping snapshots, custody, real maintenance events, config revisions, audits and receipts across reconnection, a separate Node process, native same-schema `pg_dump`/restore and a quarantined destination. It compares source data again after restore. Actual run results are recorded in [verification](equipment-reservations-verification.md); this description is not a claim that an unrun restore succeeded.

Restored databases remain activation-blocked under the existing credential/lineage/checkpoint/recovery controls. Backups do not authorize real-data copying, schema transformation or recovery activation. Ordinary configuration rollback does not restore a database or undo mapping history. Disabling/restoring modules retains enrollment and bookings; explicit re-enabling/publication never silently remaps a machine.

BusinessConfig/BuildPlan 1 and 2, Blueprint ZIP 1 and 2, both detached publisher protocols, Logo Companion 1 and branded bundles retain their existing formats. The new capability is a reviewed manifest dependency, not a portable asset reference or format upgrade. Unknown older engines must refuse unsupported modules. MIT and ForgeOS attribution remain unchanged.

Deferred: multiple resources per appointment, reservation-linked custody approval, transfer of calendar identity, recurring maintenance, notifications, qualification certification and production identity/transport/retention acceptance. No production activation, public persistent-business endpoint, destructive history purge, automatic migration or ForgeOS change is included.
