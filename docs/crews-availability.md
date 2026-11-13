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

## Employee directory search and status (PR #107)

The **Crews & availability** employee directory has a read-only
**Search employee directory** box for name, descriptive work role and
skills, plus an **Active / Inactive** status filter. Search ignores case
and surrounding whitespace. The result count makes empty/matching
views clear; **Clear employee filters** restores the full employee list
for the current archived/current view. Existing **Show archived workforce
records** still controls whether current or archived employee cards
are presented; search and status filters apply within that choice.
Resource memberships, booking eligibility, availability periods and
retained assignment history are never filtered or modified by this UI.

Only already-authorized workspace records are searched. Contact email,
phone, internal IDs and other private fields cannot be searched by
these controls. The filters are ephemeral presentation state: they
do not affect record exports, auth, permissions, employee statuses,
crews, bookings, persistence or organization scope. Work roles and
skills remain descriptive, not certifications or authorization roles.
The fictional public no-login demo, MIT license and production
acceptance boundaries are unchanged.

## Availability period search and kind filters (PR #108)

In **Crews & availability → Availability**, choose an availability
date and optionally filter the displayed periods by **Working hours**,
**Day off**, **Vacation** or **Unavailable**. A separate search matches
the period title and the name of the linked employee or resource,
ignoring case and outer whitespace. Matching/total counts distinguish
the chosen day/archived-current view from a narrower search, and
**Clear availability filters** restores all periods in that same view.

These controls act **after** the existing business-local date,
overlapping-period and archived/current selection. They do not change
which records are saved, who is available to book, whether a crew is
eligible or how vacations and time off override working hours.
Saved appointments, employee assignments and the retained workforce
history are unchanged. No timezone conversion or recurrence is added.

The filter reads only the already-authorized business workspace
snapshot. Linked-name matching requires the linked employee or
resource to belong to the same organization as the period; absent
or foreign links cannot leak their names. Search never indexes
contact email, phone, internal IDs or period notes. Filters are
temporary view state only and provide no new permissions.
MIT licensing and the fictional no-login public demo remain intact.

## Resource directory search, kind and retained enrollment (PR #109)

In **Crews & availability → Resource directory**, search current or
archived resources by their displayed name, or filter the list to
**Worker**, **Crew** or **Equipment**. A separate employee-enrollment
filter distinguishes **Enrolled workers/crews** from **Resource-only
workers/crews**. It uses retained membership history, including
archived memberships: a crew with its last membership archived is
still enrolled and cannot evade employee scheduling protections.
Equipment does not have an employee roster, so it appears with
**All enrollment types**, not either employee-enrollment subtype.
Use **Clear resource filters** to restore the full list for the
existing current/archived view.

A displayed match count and specific no-results state make the list
easier to scan. Name search ignores case and surrounding whitespace.
The filtering helper never searches IDs, contacts, notes or foreign
organization memberships. It does not change resource/employee
records, rosters, appointment allocations, availability policies,
eligibility, exports, permissions or database enforcement. Filtering
for enrolled resources is a *historical enrollment indication*, not
a claim that a crew can be scheduled on the selected date.

The public fictional no-login demo and MIT license remain intact.

## Daily availability period overview (PR #110)

The Availability section now shows an explicitly **read-only period
overview** for the selected business-local date: counts of overlapping
recorded **Working hours**, **Day off**, **Vacation**, and **Unavailable**
periods. Totals use the complete authorized current or archived list
for that chosen day, **before** the presentation-only period-type or
text-search filters. This avoids hiding recorded leave simply because
a user searched a different worker or type. Each nonempty category has
a **View ... periods** action that selects its type and clears the old
text search, so the matching period cards become visible without
changing any stored data. Zero-count category buttons are disabled.

A count means **number of recorded periods**, not unique employees,
scheduled hours, complete-day coverage, staffing capacity, or
availability for an appointment. Multiple overlapping periods
belonging to one person are counted separately. Records from
**Show archived workforce records** are historical, not current
eligibility. Incomplete/invalid selected dates continue to show no
overlapping periods rather than fabricating work windows.

No period is created, approved, extended, deleted or combined.
Availability conflicts, crew enrollment, reservation constraints,
the database's booking authority, access controls, organization
scope, time-zone/DST behavior, the demo and license all remain
unchanged. The summary contains only category totals, never
employee names, contact details, record IDs, notes or customer data.

## Search and page retained assignment history (PR #111)

Expand **Assignment history** in **Crews & availability** to review
historical employee allocation snapshots. A **Reserved / Released**
filter narrows the displayed list without changing any reservation:
Reserved means the retained allocation is currently marked active;
Released means its allocation has been released but its revision
remains available for audit. Separate totals show both states before
filtering. Each item is an *allocation revision*, not a distinct
employee, appointment, available worker, timecard or capacity claim.

Search matches the employee name and descriptive role frozen in the
allocation snapshot, plus the linked appointment title only when its
record is present and belongs to the **same organization**. Archived
appointments may still be named when retained; absent/foreign
appointment links cannot leak titles. Contact data, internal IDs,
employee skills, appointment notes and customer data are never search
fields. Search ignores case and outer whitespace, and combines with
the state filter. **Clear assignment filters** restores all current
authorized history rows.

The browser initially displays at most **10** retained revisions,
with **Show more assignment history** / **Show fewer assignment
history** controls for larger lists. Narrowing filters returns to
the first ten; paging never edits or discards records or changes the
underlying database/export. The original retained revision order is
preserved. A no-match message distinguishes an empty history from
filtered results. These controls affect only the presentation of
already-authorized snapshots, not employee availability, schedule
eligibility, roster definitions, permissions, session scope,
recovery, hosting or financial records. The fictional no-login
demo and MIT license remain unchanged.

## Filter retained assignments by local scheduled start date (PR #112)

**Assignment history → Assignment start from / Assignment start
through** add optional, inclusive date bounds. A single endpoint is
open-ended; entering both limits selects only retained allocations
whose **saved appointment start instant** falls on a business-local
calendar day inside that range. For example, a job starting late in
the evening Pacific time remains on its Pacific calendar date even
if UTC has already moved to the following day. DST transitions and
leap days use the existing timezone-aware calendar conversion.

These dates are **not** the date a booking was created, an employee
was assigned, a reservation was released, or a record was audited.
They are independent of the **Availability date** shown above the
history section and do not affect booking eligibility or recorded
availability windows. The range combines with PR #111's Reserved /
Released status and employee/appointment search, then shows the
first 10 matches with existing incremental paging. Changing either
bound resets paging to the first 10. **Clear assignment filters**
clears both dates as well as text and status filters.

If an entered bound is not a real, complete ISO calendar date, or
From is after Through, the UI reports an explicit error and shows no
filtered matches until corrected. The total retained-history counts
remain independent of date, text, status and paging. Missing or
unparseable saved start instants are never assigned guessed dates.
This is a presentation-only view on the already-authorized history;
it never changes assignment records, scheduling decisions, exports,
access roles, organizational scope or release/recovery state.
MIT licensing and the fictional no-login demo are unchanged.

## Find retained assignments by resource and scheduled-start order (PR #113)

**Assignment history** search now also matches the **name of the
linked Worker/Crew resource**, when that resource record exists in
the same organization as the retained assignment snapshot. This is
in addition to the frozen employee name/role and authorized
appointment title. Foreign or missing resource links never reveal
their names; IDs, contacts, notes and staff skills remain excluded
from search.

A **Sort assignment history** selector now offers **Retained record
order** (the existing default), **Newest scheduled start first**,
and **Oldest scheduled start first**. Sorting compares the saved
appointment start instants, rather than snapshot revision, audit,
release or employee-availability dates. Equal start instants
preserve the original relative order; malformed start instants
appear last in either date sort. The sort is applied after the
existing status, text and optional business-local start-date
filters but before the first-ten/show-more display limit.
Changing sort resets pagination to ten; **Clear assignment
filters** also restores Retained record order.

These are read-only ways to navigate already-authorized retained
allocations, not changes to assignment, roster, booking, audit,
export, permissions or payroll rules. Historical employee names
remain frozen in the retained snapshot and are not overwritten
with current employee profiles. The fictional demo and MIT
license remain unchanged.

## Download filtered assignment history as a CSV (PR #114)

In expanded **Assignment history**, **Download filtered assignment history CSV**
exports **all matching retained allocation revisions**, not just the first
ten currently rendered. The report recomputes from the authorized business
snapshot and applies the same Reserved/Released status filter, employee /
appointment / worker-resource search, inclusive business-local scheduled-start
date range, and Retained/Newest/Oldest order. The export button is disabled
when a date range is invalid or when the current filters have no matches.
No server report endpoint, external service, release workflow or record
mutation is involved.

The CSV contains the **retained employee name and descriptive work role**,
Reserved/Released state, the authorized linked appointment title and worker
or crew name (if retained in the same organization), scheduled start/end
in the configured business time zone, historical appointment/membership
revision numbers and time-zone label. It never includes employee emails,
phones, skill lists, contact records, notes, raw record IDs or names linked
from another organization. Original snapshot names and roles stay frozen;
no staffing or booking eligibility is inferred from the file.

Because exports contain fictional employee names and job history, store
them with the same care as business paperwork. Every CSV cell is quoted
and spreadsheet-formula prefixes are neutralized. Existing workspace
JSON exports, saved history, audit records and scheduled appointments
are unchanged. MIT and the fictional no-login demo remain intact.

## Download filtered availability periods (PR #115)

In **Crews & availability → Availability**, **Download filtered availability
periods CSV** saves exactly the authorized periods matching the selected
**Availability date**, the current/archived view, the period-type filter
and the period-title or employee/resource-name search. It is disabled
when nothing matches. The selected date uses the configured **business
time zone**, and includes every period overlapping any part of that local
day (not just periods beginning on it). A period spanning midnight may
appear on two different daily reports. A 23- or 25-hour daylight-saving
day is handled by its real local midnight boundaries, not a guessed
24-hour UTC interval.

The export recomputes matches from the authorized organization's
records rather than trusting a caller-provided list. Each row contains
the selected date, recorded period title and kind, subject type and
authorized employee/resource name when present, local start/end, UTC
start/end instants, archived/current state and business time zone.
The UTC instants distinguish repeated wall-clock hours during an
autumn DST fold. Unknown or foreign linked subjects have **blank**
name fields; raw IDs, staff contacts, notes, skills, customer data,
appointment details and other organizations' periods are not included.
Spreadsheet formulas are neutralized using the existing safe CSV
encoder.

**This is a period-record review, not a staffing or capacity
certificate.** Working hours do not alone prove that a worker or crew
is bookable: employee status, stable roster, complete appointment
coverage, blocking time off and existing reservations still apply.
Archived periods are historical, not active availability. The CSV
is generated in-browser without a new report API, database mutation,
production upload or change to the existing JSON export. Handle
fictional staff names as business paperwork. MIT licensing and
the no-login fictional demo remain unchanged.

## Review roster membership periods on a selected day (PR #116)

In **Crews & availability → Resource directory**, the **Show resource
memberships** selector offers **All retained membership history** (the
original default, including archived membership records) or
**Overlapping selected day**. Choose a separate **Membership review
date** when using the date-focused view. The selected day is interpreted
in the business display time zone and includes every saved membership
whose half-open effective interval touches **any instant** of that
local calendar day. A membership can appear on two adjacent days when
it crosses midnight. Spring-forward and fall-back days use actual local
midnight boundaries (23 or 25 elapsed hours where appropriate).

Each resource card shows **matching versus retained membership counts**
for that resource. A clear no-match message distinguishes a resource
with no recorded membership from one whose membership history exists
but falls outside the chosen day. An invalid/partial date produces
an explicit message rather than guessing. **Clear resource filters**
resets this date-focused view to All retained membership history
alongside the existing resource name, type and enrollment filters.
The Membership review date is intentionally **independent** of the
Availability section's date and its period filters.

This is a **read-only historical period viewer**, not a "crew is
available" badge. Even a membership spanning part of a selected day
does **not** guarantee that its roster stays constant for an entire
appointment. It also does not establish an active employee profile,
covering work windows, absence of time-off conflicts, or absence of
other bookings. Archived memberships remain visibly marked
"Membership archived" if their retained dates overlap the review
day. A Worker/Crew's **enrollment** still depends on **any retained
membership ever**, including archived memberships outside the
selected date; selecting an empty day never changes enrollment,
resource-only labels, or booking authority.

The presentation helper uses only matching same-organization
resource-membership links and does not create, modify, archive,
restore or delete memberships. The original source order and
retained history are unchanged, as are existing scheduling
constraints, exports, access controls, MIT licensing, and the
fictional no-login demo.
