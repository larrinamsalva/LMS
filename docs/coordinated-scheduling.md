# Coordinated crew and equipment appointments

The optional `coordinated-scheduling` 1.0.0 capability reserves one primary **Crew/Worker** and at most one additional **Equipment** resource on the same existing appointment. Both allocations use exactly the appointment's saved interval and status. Legacy single-resource bookings, including equipment-only appointments, retain their public record schema. No second calendar, automatic collection, cancellation or notification is introduced.

## Try the fictional workflow

1. Use Studio to select **Crew + equipment appointments** explicitly. Review its Scheduling, Workforce and Equipment calendar mapping dependencies (and their Equipment/Inventory/Tasks dependencies), then use existing save/publication checks. Existing organizations and Gallery starters are not opted in.
2. Prepare an active crew/worker and its effective roster/work windows. Register and inspect a fictional machine, create an Equipment scheduling resource and explicitly map it through the existing owner/admin mapping review.
3. In Schedule choose a customer and its existing cleaning job or maintenance task, select the responsible primary crew/worker, then optionally select additional equipment. Choose date/times with the existing booking zone and DST controls.
4. Review the two names, physical machine/permanent business ID, resource/mapping/configuration revisions and current warnings. Check the confirmation and save. Availability previews do not reserve resources or guarantee collection.
5. Inspect the single combined Schedule card, employee allocation and Equipment & Tools reservation. Reschedule through Edit, reviewing the entire set. A conflict on either resource refuses the whole change.
6. Cancel or archive to release both current allocations. Restoration requires explicit current resource review and rechecks both resources. Earlier snapshots remain available. Changing/removing the second resource is an explicit review, not a legacy client silently dropping it.
7. Report equipment problems through the existing equipment action. Retained appointments display review warnings; nothing is cancelled and equipment is never automatically checked out.

For a single equipment-only appointment, continue to choose that primary resource under the existing PR #33 workflow. The new two-resource workflow requires a Crew/Worker primary. Unenrolled primary resources remain transparently resource-only; assigning a crew does not invent employee identities or certify qualifications. Existing workforce enrollment, working hours, time off and cross-crew employee exclusion remain authoritative.

## One conflict authority and immutable evidence

Migration **019_coordinated_scheduling.sql** replaces the primary-only resource exclusion on `lms.appointments` with **one** `exclusive_resource_time` GiST exclusion on `lms.appointment_resource_allocations`. Every current primary and additional allocation participates in the same organization/resource/half-open interval constraint. A machine cannot evade it by appearing in the other slot. Adjacency is permitted; containment/partial overlaps are refused.

| Storage | Role |
| --- | --- |
| `lms.appointments` | Retained shared appointment/workforce projection; no competing primary-only resource exclusion |
| `lms.appointment_resource_allocations` | Guarded current projection, at most Primary and Equipment slots, exact common interval, selected/present and blocking flags |
| `lms.appointment_allocation_history` | Immutable per-revision snapshots of identities, names, revisions, physical machine/business ID, interval, actor, operation, origin and release/removal state |
| `lms.equipment_reservations` | Existing immutable physical reservation history, now emitted for either slot by the unified projector |

All new tables force RLS and grant `lms_app` scoped SELECT only. Scoped foreign keys protect appointment, resource, configuration and mapping history references. Current allocations are transactionally deactivated/upserted; no historical snapshot is changed to free a slot. The original relationship and workforce projectors remain the appointment and employee authorities. The resource projector runs after appointment projection and before employee projection. A late exclusion/history/employee failure rolls back the appointment, both allocations, links, audits and receipt together.

The established organization-first lock and record-epoch fencing are reused without adding a different ordering. The shared equipment booking validator is extracted from PR #33 and used for either slot; the old primary-only equipment projection is replaced by the unified projection. Additional resource availability changes call the existing workforce availability validator and refuse invalidating reservations. Mapping changes also inspect all allocation slots. Safety reports remain independent of reservation creation and cannot be refused because of future commitments.

Current owner/admin mapping authority is unchanged. Scheduling still uses current owner/admin/staff authority and current membership row locking. An asset ID, resource UUID, old approval or operation ID is not authorization. New/restored combined requests require the exact configuration, appointment, primary/resource, equipment and mapping revisions. Exact committed retries return the original receipt; conflicting retries refuse. Lost/ambiguous commit responses require the identical operation retry.

## API and compatibility

The existing Engine methods accept an optional final data-only `AppointmentResources` argument:

- `saveRecord(principal, organizationId, "appointments", data, existing, operationId, resources)`
- `archiveRecord(principal, organizationId, recordId, expectedRevision, false, operationId, resources)` for coordinated restoration.

The strict version-1 review envelope contains `configRevision`, `primaryId`, `primaryRevision`, optional/null `equipment` (resource/physical-equipment IDs and exact revisions, mapping revision), and explicit `CONFIRM FICTIONAL RESOURCE RESERVATION` acknowledgement. The Engine validates it and binds it into the existing record-operation request; PostgreSQL independently checks sources, revisions, roles and capabilities. It is **installation-local operational evidence**, not a new portable BuildPlan field or an authority token.

Existing single-resource calls and receipt payloads remain unchanged when no review is supplied. Active appointments retaining additional equipment refuse legacy edits/restores that omit the complete review. Cancel/archive may release a retained set without reapproving unsafe equipment; they cannot change retained identities through that release path. Module disabling retains allocations/history; reenabling does not automatically restore a booking. Existing configuration-impact, populated-schema and publication controls remain in force.

BusinessConfig/BuildPlan 1 and 2, Blueprint ZIP 1 and 2, logo companions, branded bundles and detached publisher protocols are unchanged. Only a reviewed optional manifest is added. Older engines must refuse unsupported modules. No local resource/asset IDs are added to portable configurations or signed packages.

## Migration, persistence and recovery

Stop runtime hosts and use the existing `db:migrate` procedure for trusted fictional lab databases. Migration 019 takes the established maintenance lease and exclusive table locks. It checks each legacy appointment against its exact current record projection and resource identity before adopting it. Missing, orphaned, mismatched or unsupported evidence fails closed. Adoption captures current resource names/revisions as **Legacy observed** evidence; it does not claim to reconstruct unavailable older labels or rewrite original records/audits. Earlier configuration, workforce, physical reservation and audit history is retained. Constraint replacement and adoption are one transaction; a failure leaves the prior exclusion intact. Migrations 001–018 remain byte-identical.

The closed native inventory includes both new tables. Native regression coverage compares current and immutable allocations, employee/physical links, active/cancelled reservations, configurations, audits and receipts across reconnect, a separate Node process, native same-schema dump and a separately quarantined restore. Actual completed results are recorded in [verification](coordinated-scheduling-verification.md) and PR #34; an embedded run is not proof of native restoration. Restored runtime attachment and activation remain blocked under all existing recovery/lineage/checkpoint controls.

The new history follows the established inventory boundary for trusted whole temporary-sandbox expiry: direct history mutation/deletion always refuses while its organization exists; runtime has no organization deletion grant. An existing trusted host can dispose an entire expired temporary organization, with cascades only after the parent is absent. Equipment/financial protected organizations retain their existing conservative expiry rules. This is not a per-record purge, slot reset, persistent disposal API or production retention acceptance.

## Deliberate limits

Only one primary resource and zero/one additional mapped machine are supported. No recurring visits, automatic checkout/return, qualification certification, GPS, messages, payroll, purchasing, payments, production activation or schema transformation is included. Current equipment custody or future safety changes may require human review of retained appointments; a booking never guarantees physical collection. Persistent calls remain trusted host-only and fictional. The public HTTP action remains on the isolated temporary demo transport only. MIT/ForgeOS attribution is preserved; ForgeOS is untouched.
