# Employee crews and availability

PR #11 extends the shared record/scheduling engine with an optional `workforce` manifest. All data is fictional. Employee profiles are business records, **not login identities, organization memberships or permission roles**. No payroll, timesheets, messages, production business route or recovery activation is enabled.

## Try the two workflows

Run `npm ci`, `npm run dev`, then open the no-login demo. Each temporary workspace has its own records, employees and resources. The cleaning sample reserves two fictional employees in Blue crew; the property sample reserves a maintenance worker for Cabin 02. **Crews & availability** opens their directory, dated memberships, finite work windows and retained assignment history.

To create your own fictional booking:

1. Add an employee profile with a name, descriptive work role, skills and Active status. Contact email/phone and notes are optional. A descriptive role such as “Owner” never grants application access.
2. Add a Worker or Crew through the existing resource records. Equipment remains supported without an employee roster.
3. In **Crews & availability → Add dated membership**, link each employee to that resource with an effective start/end and IANA zone. A Worker can have one employee at a time; a Crew can contain several. Employee/resource identity stays fixed on that membership; archive/create another to change it.
4. Add **Working hours** for each employee, choosing exactly one employee as the period subject. Each record is a finite work window of up to 24 elapsed hours, not a recurring weekly rule. Pick the dates you plan to book. Optional resource work windows further restrict crew, worker or equipment hours.
5. Link a cleaning job or maintenance request to its customer/site, then schedule it through the existing **Schedule** form. Use one resource per appointment. Every effective member must be active, available and covered for the entire booking. All overlapping memberships must cover the full appointment; a roster transition during the job is refused.
6. Add **Day off**, **Vacation** or **Unavailable** periods for an employee or resource. Each period is positive, explicit and at most 366 elapsed days. Time off always overrides work windows.

Owners and admins (the existing manager roles) can create/edit/archive/restore employee profiles, dated memberships and availability. Staff can schedule within those constraints and view the directory; viewers can only read. Existing Engine role checks and independent database enforcement apply. Contact fields are fictional shared-workspace data in this phase, not a production employee privacy model.

## Availability and conflict policy

- A staffed employee always needs **one published work window containing the whole appointment**. Separate adjacent windows do not combine into a shift in this phase.
- Resource work windows are optional: when any active Working hours exist for a resource, one must contain the whole appointment. Resource time off blocks appointments even for equipment or resource-only reservations.
- Crews reserve **every effective member** for the entire appointment, rather than selecting a subset. Skills are descriptive; there is no automatic skill/certification matching. Eligibility means an active profile, stable effective membership, covering hours, no time off and no conflicting reservation.
- Half-open `[start,end)` intervals allow back-to-back bookings and adjacent memberships. A Worker cannot map to two employees simultaneously. Duplicate overlapping membership of the same employee in one Crew is rejected.
- An employee cannot be reserved through another Crew or Worker at the same time. PostgreSQL exclusion constraints enforce both the existing resource conflict and the new cross-resource employee conflict.
- Completed, non-archived appointments retain their reservation. Cancelled or archived appointments release it. Reschedule, restore and cancellation reversal check the current roster, working hours, time off and employee conflicts again.
- Membership changes affecting reserved work are refused. Time-off, working-hours and inactive-profile changes that invalidate a reservation are also refused. Cancel or archive the affected appointments, change the roster/availability, then explicitly reschedule/restore. Completed historical reservations may need to be archived before correcting their former roster; records and allocations remain retained. No silent reassignment or force-override exists.

All periods use UTC instants plus a retained IANA input/display zone, whole-minute precision and supported local dates 2020–2100. Existing generated datetime controls reject DST gaps and require an explicit first/second occurrence for folds. Changing the business display zone never shifts memberships, work windows or appointments. A whole local day can span 23 or 25 hours across DST; enter its explicit midnight boundaries for time off. Time-zone data must remain consistent across Node, browser and PostgreSQL.

## PR #10 compatibility and enrollment

The existing appointment/resource contracts are unchanged. Worker, Crew and Equipment IDs, customer/work/site links, booking dates/status, archive rules and audit history remain intact. Old configurations remain valid; migration 8 fabricates no employees, memberships, hours or assignments.

An unenrolled Worker or Crew keeps PR #10 **resource-only scheduling**. The directory and appointment form label it explicitly: it reserves a resource, not a verified employee identity. Employee conflict/availability protection applies to enrolled resources and their actual employee IDs; it cannot identify a person from a resource name or a duplicate profile. Do not interpret resource-only reservations as employee availability.

The first dated membership permanently enrolls a resource. Before enrolling a resource with existing blocking appointments, explicitly cancel/archive those appointments; their unknown historical people are never fabricated. Restoring those appointments then requires the current eligible roster. Archived memberships keep enrollment: archiving the last member leaves an unbookable staffed resource, not a way to bypass employee checks. The enrolled resource also retains its Worker/Crew type.

Disabling the workforce module hides its management forms but retains its data, enrollment and database checks. Re-enable it to manage the constraints. Existing populated field schemas remain immutable; adopt new entity definitions by an explicit compatible configuration revision or a fresh fictional preset, rather than rewriting history. The three new entities fit both presets without changing existing resource fields.

## Transaction boundary and history

Migration `008_workforce_availability.sql` adds trigger-maintained `resource_memberships`, `availability_windows` and `appointment_staff` projections. Composite foreign keys, forced RLS and scoped reference/type checks bind every employee/resource/appointment/membership to one organization. App roles can read authorized rows but cannot mutate projections or assignment history. Narrow security-definer functions use an empty search path with no runtime execute grants.

The existing record-relationship trigger advances the private organization coordination epoch **before** workforce checks. Records, configuration changes, memberships, time off, profiles and appointment reservations share its transaction ordering. Stale REPEATABLE READ writers fail rather than make decisions from a frozen snapshot. GiST constraints independently refuse overlapping employee reservations and invalid Worker/membership overlaps, including direct SQL. There is no browser-only conflict authority or automatic retry after a concurrency error.

Each staffed appointment revision captures the effective membership ID/revision/span and employee name/descriptive role/skills. Later changes release the previous allocation while keeping its snapshot; new allocations commit atomically with the record, normal audit, and existing operation receipt. A failed mutation rolls all of these back. Membership and availability mutations reuse Engine optimistic revisions and exact actor-scoped operation UUID retries. See the [scheduling retry contract](shared-scheduling.md#duplicate-submissions-and-host-api).

The snapshot includes `staffAssignments`; the existing version-1 JSON workspace export adds the same history, including released rows and disabled-module records. This is additive metadata, not a new import/restore guarantee. Native backups retain all tables and audit history. Restored identity/business hosts **remain activation-blocked** under the existing recovery/credential controls.

## Safe setup, checks and limits

Fresh fictional demo: `npm ci`, `npm run dev`. Native local setup uses the existing Compose instructions in [db/README.md](../db/README.md). For a previously migrated local fictional database: back up, stop all identity/business hosts, then run `npm run db:migrate -- --database lms_development` as the separate local migration administrator. Migration 8 takes the maintenance/table locks and applies atomically; migrations 1–7/checksums are untouched. Untracked preexisting workforce entities refuse migration for a reviewed data transition. The Engine also refuses workforce activation/writes on a pre-migration-8 database instead of offering unprotected staffing. Never edit applied SQL or erase histories to bypass a failed upgrade.

Run `npm run check`, `npm run test:e2e`, and the documented disposable native `npm run test:postgres` setup. Native prerequisites are required; tests never silently skip. [Verification evidence](crews-availability-verification.md) distinguishes actual local and CI results.

One appointment still selects **one resource**. Multi-person crews reserve their entire stable roster; multiple independent resources, split shifts, recurring work-hour templates, staffing subsets, travel/buffers, skill certification and capacity planning are later phases. Limits remain 250 records/workspace and 40 configuration revisions. Employee profiles are not real-user accounts. Payroll, timesheets, recurring schedules, external calendars, notifications and AI optimization are deferred. Service rates/estimates, inventory movements and BuildPlan Studio follow this foundation; production access and recovery acceptance remain separate security gates.
