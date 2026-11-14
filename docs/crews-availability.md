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

## Download filtered roster membership review (PR #117)

In **Crews & availability → Resource directory**, choose a resource
name/type/enrollment filter and optionally **Overlapping selected day**
with its own membership review date. **Download filtered roster
memberships CSV** saves **all matching retained membership rows** for
the displayed resources, including archived membership history where
applicable. In the default **All retained membership history** view,
the report includes the entire retained membership list of those
matching resources. The selected business's **Show archived workforce
records** setting also determines whether the resources themselves are
current or archived. The CSV button is disabled when there are no
matching membership rows, or when the selected review date is invalid.

The report applies the same resource selection and date-overlap rules
again against the explicitly scoped organization data. It never accepts
a caller-provided list of unverified member IDs as its export
authority. Each row provides the review scope/day, resource
name/type/archived state, **retained** enrollment label, membership
title, same-organization employee name (or blank for absent/foreign
links), membership archived state, effective start/end in business-local
time and unambiguous UTC instants, and the business time-zone name.
All displayed time ranges are original recorded membership periods,
**not** proof of availability at every instant of the selected day.
Archived periods remain marked historical; enrollment remains based
on **all** retained membership history regardless of the date filter.

The export intentionally excludes raw identifiers, emails, phone
numbers, skills, notes, customer/job details, and other organizations'
linked names or membership rows. It uses the same quoted,
spreadsheet-formula-safe CSV encoding as other LMS reports. Downloading
takes place locally in the browser without a new API, data mutation,
database migration or modification of the existing workspace JSON
backup/export. Retained employee names are business history and should
be handled accordingly. This feature preserves scheduling safeguards,
organization permissions, MIT licensing and the fictional no-login
demo.

## Filter retained roster memberships by record status (PR #118)

In **Crews & availability → Resource directory**, **Filter membership
record status** offers **All retained memberships** (the default),
**Current membership records**, and **Archived membership records**.
This filter operates on the individual membership record's
archived/current flag. It combines with the existing resource-name,
resource-kind and enrollment filters and, when selected, the
**Overlapping selected day** membership-date view. A current record
means **not archived**, *not* that it overlaps the present date or
proves the worker is on duty. An archived record is retained history,
not permission to schedule.

Each resource card continues showing matched versus **all retained**
membership counts. When the status filter excludes all the
membership rows for an otherwise visible resource, the card says
**No retained memberships match this status filter.** When the date
matches no records at all, the existing local-day no-overlap message
takes precedence. **Clear resource filters** also restores the
membership status selector to All retained memberships.

The **Download filtered roster memberships CSV** action now uses this
same status filter alongside all the existing resource and local-day
filters, recomputing every report row from organization-scoped
records. It is disabled if no matching memberships exist. The
export still includes only authorized historical names, roster
labels and original dates, applies CSV formula protection and
excludes contacts, private notes, raw IDs and foreign-linked names.

Crucially, the resource's **Enrolled** vs **Resource-only** label
continues to depend on **any retained dated membership**, including
records excluded by the current status or date selection. Selecting
Archived or Current is a read-only history view; it never archives,
restores, changes enrollment or weakens booking eligibility checks.
No new database schema, permissions, API or deployment is involved.
The MIT-licensed fictional no-login demo remains unchanged.

## Sort retained roster memberships by effective start (PR #119)

In **Crews & availability → Resource directory**, **Sort membership
history** offers **Retained record order** (the unchanged default),
**Newest effective start first** and **Oldest effective start first**.
The selected order applies separately to each visible resource's
membership list after the existing current/archived record status
and optional overlapping business-local day filters. The resource
cards themselves keep their established directory order; the
matching versus retained counts do not change.

Sorting uses the original recorded **effective start instant** for
each membership, not its creation date, last edit, archive status
or the date someone opened the roster. Identical instants preserve
their original relative order; missing/invalid start timestamps
are placed last in both time-based orders rather than guessed.
A repeated local clock hour during a fall DST change is ordered by
unambiguous instants. **Clear resource filters** restores the
original retained record order alongside the other roster controls.

The **Download filtered roster memberships CSV** action applies the
same selected membership order per resource, after independently
recomputing resource, status and date filters from authorized
organization records. The report continues to exclude raw IDs,
contacts, private notes, skills and foreign organization linked names,
and to neutralize spreadsheet formulas. Sorting never changes
stored history, roster membership, eligibility, permissions,
enrollment, appointments, backups or exports other than the new
presentation order of this CSV. MIT and the fictional no-login
demo remain unchanged.

## Find roster membership history by employee name or title (PR #120)

In **Crews & availability → Resource directory**, the new
**Search roster memberships** field filters the **membership rows
inside the visible resource cards**, by saved membership title or
the name of a linked employee in the same authorized organization.
It ignores case and surrounding spaces, and combines with the
resource name/type/enrollment filters, membership record archive
state, optional selected business-local day, and effective-start
sorting. It does **not** search resource cards by employee name:
use the existing **Search resource directory** control to select
resource cards by resource name. Cards stay visible when their
member search has zero matches, with a distinct
**No retained memberships match this roster search** message.

Only names and titles already displayed in the authorized workspace
are searchable. Raw identifiers, emails, phone numbers, skills and
private notes are **not** search terms. Foreign or missing linked
employee identities are neither searchable nor revealed by the
membership row. Memberships still have retained historical meaning:
the search can show archived periods, but never treats an archived
record as current scheduling authority. Search does not change crew
membership, scheduling, employee activity, or the permanently
retained **Enrolled** designation.

**Download filtered roster memberships CSV** now applies the same
member-name/title query to the complete authorized roster history
before sorting; it is disabled if there are no matching rows.
All existing organization scoping, CSV formula protection, local
day/DST semantics, private-field exclusions, and archive-state
columns remain intact. **Clear resource filters** also clears the
member search, restoring the original retained-history view. No
database, permissions, scheduling, JSON backup, production release,
or other app is changed. MIT and the fictional no-login demo remain.

## Show only resources with matching roster memberships (PR #121)

In **Crews & availability → Resource directory**, check
**Show only resources with matching memberships** to hide resource
cards with **zero retained membership rows** matching the selected
membership date, current/archived record status and membership
title/employee-name query. The existing resource name/type/enrollment
filters apply first. The option defaults **off**, preserving the
original directory view with empty resource cards visible. It
does not automatically enroll, unenroll, archive or remove any
resource, crew or member. The result count reports the visible
resource cards, and a clear empty-directory message appears if
none of the selected resources contains matching retained rows.
**Clear resource filters** also unchecks this option.

This is a **historical record matching aid**, not a live availability
or staffing-capacity filter. A member record that overlaps any part
of a selected date does not confirm that a worker is eligible for a
job all day. A resource's **Enrolled** versus **Resource-only**
classification remains based on **any retained membership ever**,
including archived history omitted by the current date or status
filters. Memberships remain immutable unless an authorized user
separately performs an explicit record action.

**Download filtered roster memberships CSV** recomputes the same
resource-match selection from the authorized organization and
keeps every matching membership row. Resources with zero matching
membership rows never produce CSV detail rows even with the
checkbox unchecked, so toggling the option changes card visibility,
not the set of CSV membership rows. Existing privacy restrictions
exclude foreign-linked names, contacts, notes, skills and raw IDs;
CSV formula protection and effective-start sorting remain unchanged.
No database, scheduling rules, permissions, export backup format or
other app is modified. MIT and the fictional no-login demo remain.

## Roster membership overview for filtered Resource Directory (PR #122)

**Crews & availability → Resource directory → Roster membership
overview** shows how many directory-selected resources have at least one
matching retained membership, how many resource cards are selected by
the existing name/type/enrollment filters, and the total matching
membership **records** split into **Current records** and **Archived
records**. The counts recompute as the membership review day, archive
status, member-name/title search or resource filters change.

A *current membership record* is one that has not been archived, **not**
evidence of a currently active employee, on-duty crew, a complete
assignment roster or capacity to accept work. Archived memberships
remain retained history. The selected day uses the existing
business-local overlap rules, including daylight-saving changes; a
record overlapping part of a day counts once for each resource to
which it is legitimately linked. The totals are **membership rows**,
not unique employees or time slots. The default retained-history
view covers all historic membership periods regardless of date.

The **Show only resources with matching memberships** checkbox does
not change these summary totals: it hides zero-match cards but the
summary already counts only matching membership rows. The visible
resource-card count and the summary's directory-resource denominator
may differ when this checkbox is enabled. The overview does not
change the CSV's detail rows, any roster data, scheduling checks or
employee enrollment; exporting still follows the existing authorized,
filtered report. The calculation enforces the selected organization
inside the helper, even if a caller supplies mixed-organization
records. It does not expose contacts, private notes, raw IDs, skills
or foreign-linked names.

No API, database schema, permissions, scheduling logic, backups or
other repository is changed. MIT and the fictional no-login demo
remain intact.

## Sort resource cards by matching roster membership count (PR #123)

**Crews & availability → Resource directory → Sort resources by
matching memberships** offers **Original directory order** (the
unchanged default), **Most matching memberships first**, and
**Fewest matching memberships first**. Unlike the separate
**Sort membership history** control, this sorts the resource
**cards** themselves. It counts retained membership **records**
matching the selected resource directory, date, archived/current
membership status and employee-name/title search filters. Counts
are not distinct employees, available shifts, staffing capacity or
booking eligibility. Archived matching history may be counted when
the status filter includes it.

Ties retain the original directory order, including when every
resource has zero matching records. Sorting works whether or not
**Show only resources with matching memberships** is enabled:
when it is on, the zero-match cards are hidden before sorting.
**Clear resource filters** restores the original directory
order. This ordering does not change the original stored
resource order, retained membership counts, roster enrollment,
record archive state, employee availability or assignments.

**Download filtered roster memberships CSV** applies the same
card-count sort when grouping matching detail rows by resource,
then applies the independent membership effective-start sort
inside each resource. The CSV contains the same authorized
matching records regardless of card sort; only the row grouping
order changes. The reporting helper enforces organization
scoping even if supplied mixed-organization arrays and retains
formula safety and the exclusion of emails, phones, notes, skills,
foreign-linked names and raw IDs.

No database migration, API, permissions, scheduling change,
deployment or other repository is involved. MIT and the fictional
no-login demo remain unchanged.

## Download a one-row-per-resource roster overview (PR #124)

In **Crews & availability → Resource directory → Roster membership
overview**, **Download roster overview CSV** saves a compact, one-row-per-
visible-resource report. It is a companion to the existing detailed
**Download filtered roster memberships CSV**, not a replacement for
membership history. The summary contains the resource name/type,
current or archived **resource** record status, retained
**Enrolled/Resource-only** category (Equipment marked Not applicable),
total retained membership records, and the matching **Current**,
**Archived**, and **Total** membership-record counts. Each row also
states whether the review covers all retained history or a selected
business-local day, plus that date and the business time zone.
Individual employee names, contact details, notes, skills, customer
information and raw database identifiers are **not** included.

The summary applies the current resource name/type/enrollment,
membership day, record-status, employee-name/title search and
**Sort resources by matching memberships** selections. The separate
per-resource membership-history sort cannot change summary counts.
Unlike the detailed membership CSV, the summary **includes resources
with zero matching membership rows** while **Show only resources with
matching memberships** is unchecked. This helps explain a gap
without erasing the fact that a resource has retained history.
With match-only checked, empty cards are omitted from the summary,
as in the on-screen Resource Directory. The button is disabled when
no resource cards are visible or a selected review date is invalid.

The report independently reapplies organization scoping and all
filters to original authorized records and quotes/formula-protects
every CSV cell. Archived history stays marked as archived and
retained enrollment is never derived from the filtered count.
Matching rows are historic **records**, not unique employees,
available shifts, complete crew coverage or booking eligibility.
Downloading the report is a local browser action; no new API,
database, scheduling rule, access control, stored record, deployment,
workspace JSON backup or other repository is modified.
MIT licensing and the fictional no-login demo remain unchanged.

## Matching current and archived membership counts on resource cards (PR #125)

Each **Resource directory** card now displays a small
**Matching membership status breakdown** directly beneath
**Showing X of Y retained dated memberships**:

- **Matching records**: count of the filtered, visible membership rows.
- **Current**: those matching membership records not marked archived.
- **Archived**: those matching membership records marked archived.

The breakdown responds to the same business-local selected-day,
membership current/archived status and same-organization employee
name/membership-title filters as the visible membership list. The
counts add up to **Matching records**, stay accurate as the separate
membership effective-start or resource-card count sorting changes
order, and preserve zero matches when the card stays visible.
**Show only resources with matching memberships** can hide zero-
matching cards; turning it off restores them and their 0/0
breakdown. The **Roster membership overview** totals remain the
sum across the directory-selected resources.

Counts are for retained **membership records**, not unique employees,
current work assignments, availability, capacity, or the number of
people bookable for a job. A **Current** record means only that the
membership has not been archived. It is not proof that its effective
date includes today or that a person is on duty. Resource
**Enrolled / Resource-only** classification still depends on all
retained membership history, even if the selected filter has no
matching rows.

The breakdown reads only the already organization-scoped,
filtered membership records; it adds no personal fields, database
calls, saved-record edits, scheduling changes, exports or new
permissions. Both existing CSV downloads, MIT licensing and the
fictional no-login demo remain unchanged.

## Expand or collapse membership entries on individual resource cards (PR #126)

In **Crews & availability → Resource directory**, each resource
card now offers **Hide membership entries** and **Show membership
entries**. The membership list starts **expanded**, as before.
Hiding it makes long Crew or Worker directories easier to scan on
phones, tablets and desktops. Each card has its own independent
expand/collapse state, with an accessible button exposing its
expanded status to assistive technology. The card's resource
name/type, full retained-membership count, matching Current and
Archived record breakdown, and enrollment explanation remain
visible even when its membership entries are hidden.

Expanding a card restores the same authorized membership rows
and explicit member-record actions permitted by the current user
role, already filtered and sorted by the selected roster
controls. Collapsing an empty roster also hides its explanatory
empty-state message until the list is expanded; it never changes
the actual matching count. Per-card collapse state is scoped to
both organization and resource so one business's presentation
selection cannot affect another business with the same resource
identifier.

Collapse is **presentation-only**. It does not alter the
organization-scoped membership filters, roster overview, 
record-level authorization, employee eligibility, scheduling,
retained history, resource sorting, or the detailed and overview
CSV exports (which always include their full selected data).
No backend, database, migrations, JSON backups, deployment, or
other repository is changed. MIT and the fictional no-login
demo remain unchanged.

## Bulk expand/collapse of currently shown resource membership entries (PR #127)

Just above the **Resource directory** cards, **Collapse all shown
membership entries** and **Expand all shown membership entries**
offer a fast way to switch between a compact overview and a
detailed roster list. The two controls apply **only to resource
cards presently visible** after directory search, resource type,
enrollment and optional match-only filters. Cards hidden by a
filter retain their individual expand/collapse choices, so
changing or clearing a filter does not unexpectedly change
those cards. Both buttons are disabled when no resource cards
are visible; each button is also disabled when all shown
cards already have the requested state.

Individual **Show/Hide membership entries** buttons still work
after a bulk action. A card's resource type, enrollment label,
total retained records and matching Current/Archived breakdown
remain visible even with its list collapsed; expanding restores
the same filtered and sorted rows, including permitted record
actions. The current organization is checked inside the
bulk selection helper, and presentation state remains scoped
to organization plus resource ID.

This is **view state only**. Bulk controls never archive,
remove or otherwise change a membership record or employee,
alter roster selection, disable scheduling validation or
remove rows from either detailed or summary CSV download.
A historical membership is not evidence of staff availability
or booking eligibility. No database, role permission, API,
migration, JSON backup, deployment or other repository is
changed. MIT licensing and the fictional no-login demo remain.

## Show only resources without matching roster memberships (PR #128)

In **Crews & availability → Resource directory**, the new
**Show only resources without matching memberships** checkbox is the
complement of **Show only resources with matching memberships**. It
keeps resources from the currently selected organization and
resource name/type/enrollment filters only when they have **zero**
retained membership rows matching the chosen membership date,
current/archived record state, and membership-title or linked
employee-name search. The two opposite selections automatically
uncheck one another. Both default **off**, preserving the original
Resource Directory.

Use this view to inspect **historical roster coverage gaps** for
the selected filters. A zero match does **not** mean that an
employee or crew is available, unassigned, inactive or
permanently unenrolled: an archived membership, a membership
outside the selected date, a different title search, or a
resource-only entry can cause zero matching rows. The original
**Enrolled / Resource-only** explanation still uses all retained
membership history, independent of this checkbox. When every
directory-selected resource has at least one match, the view
shows a clear empty-result message.

**Download roster overview CSV** follows the zero-match card
selection, keeping one row per displayed resource with its
retained enrollment and historical total intact and matching
current/archived counts of zero. The detailed membership CSV is
disabled in this view because there are no matching membership
detail rows to export. The existing matching-only and all-
resources views continue to behave as before. Bulk and
individual collapse/expand, card count sorting, and Clear
resource filters continue to apply to the selected cards.

Both helpers and reports independently enforce organization
scoping; foreign organization matches are excluded even if
input arrays are mixed. No personal contacts, notes, raw IDs,
skills, record edits, scheduling eligibility, API, database
migration, JSON backup, other repository or deployment is
affected. MIT licensing and fictional no-login demo remain.

## Unmatched roster resource breakdown in the overview (PR #129)

The **Crews & availability → Resource directory → Roster membership
overview** now also summarizes **Resources without matches** for
the currently selected Resource Directory name/type/enrollment and
roster date, membership-status, and employee-name/title filters.
The number is divided into three mutually exclusive categories:

- **Enrolled workers/crews:** Workers or Crews with any retained
  membership record, including archived history, but **none**
  matching the current review filters
- **Resource-only workers/crews:** Workers or Crews with no
  retained membership record at all
- **Equipment:** Equipment resources with no matching membership
  records; equipment has no employee-enrollment requirement

The three categories sum to the **Resources without matches** total.
These numbers are calculated from the **directory-selected**
resources, independent of whether **Show only resources with
matching memberships**, **Show only resources without matching
memberships**, or no card-only filter is selected. Consequently
the summary stays useful when a view hides either matching or
nonmatching resource cards. Changing the membership review date,
record status, name/title search, resource type, or enrollment
filter recalculates the breakdown. Card ordering, member-history
sorting, and expand/collapse state do not change it.

These are counts of **resources without matching retained
membership records**, not counts of people who are off duty,
available for work, unassigned, or eligible for booking. An
enrolled resource with no selected-day match still retains its
historical enrollment; archived history remains history. Both
the historical roster CSV and the per-resource summary CSV
retain their existing authorized content and filters.

The calculation rechecks resource, membership and linked-employee
organization access even for mixed input arrays. No private
employee data, database, record edit, staffing rules, API,
permission, migration, deployment or other repository is changed.
MIT licensing and the fictional no-login demo remain intact.

## Review a missing-roster category in one click (PR #130)

In **Crews & availability → Resource directory → Roster membership
overview → Resources without matching roster records**, the three
new review buttons jump directly to the existing resource-card view
for a specific kind of missing membership match:

- **Review enrolled worker/crew gaps** selects Workers/Crews with
  any retained enrollment history but no membership matching the
  current roster review filters
- **Review resource-only worker/crew gaps** selects Workers/Crews
  with no retained enrollment history at all
- **Review equipment gaps** selects Equipment resources without
  a matching retained roster record; equipment is not governed
  by employee enrollment

Buttons are disabled when the corresponding category's count is
zero. Clicking a button applies the appropriate existing
Resource Directory **employee enrollment** and **resource type**
filters, turns **Show only resources without matching
memberships** on, and turns the opposite match-only filter off.
For Worker/Crew categories, an existing Worker-only or Crew-only
resource selection is preserved rather than unexpectedly
broadening that category; the Equipment category uses the
Equipment type with the enrollment filter set to All.

The quick views **preserve** the chosen business-local roster
date, membership current/archived filter, membership-title /
employee-name search, resource name search and sorting settings.
The overview is recalculated from the newly selected directory
scope. **Clear resource filters** restores the original
all-resources view; the checkboxes and dropdowns can also be
adjusted individually after using a quick view. The detailed
membership CSV remains disabled while the no-match-only view
has no matching member detail rows; the one-row-per-resource
overview CSV follows the authorized displayed selection.

A missing *historical record match* never means a worker,
crew or equipment item is free to schedule, has no active job
or is eligible for booking. These buttons make no record edits
or server requests, and cannot override organization access
or enrollment/booking safeguards. Existing CSV/JSON formats,
database schema, permissions, scheduling, MIT license and the
fictional no-login demo are unchanged.

## Return from a category drill-down without clearing roster review (PR #131)

Beside the three **Review ... gaps** shortcuts in **Roster membership
overview**, **Show all resource categories (keep roster filters)**
restores the full set of resource **types** and **employee enrollment**
categories, and unchecks both match-only and without-match-only
resource-card views. It is disabled when there is no such narrowing
to undo. The control is useful after reviewing a specific
enrolled, resource-only, or equipment no-match category because
the previous **Clear resource filters** action also reset the
selected roster review date and other search criteria.

This smaller reset **preserves** the current Resource Directory
**name search**, historical roster **date**, **all/current/archived**
membership status, membership-title/employee-name search, member
and resource-card sorting, and the expand/collapse state of
individual cards. It also preserves the selected **current or
archived resources** tab; it does not broaden the organization or
change anyone's access. Consequently, a name-specific resource
search can still narrow the displayed cards after clicking it.
For a complete reset of all resource and roster filters, use
the existing **Clear resource filters** action instead.

No membership, crew, equipment or employee records are changed.
The helper simply updates local presentation controls; overview
counts and existing CSV downloads then recompute using their
usual organization scoping. A missing historic roster match is
not worker availability or permission to book. Database,
permissions, exports, migrations, scheduling, deployments, MIT
licensing, the fictional no-login demo and other repositories
remain unchanged.

## Understand the selected filters in an exported roster overview (PR #132)

**Download roster overview CSV** now includes seven additional,
privacy-conscious columns after **Business time zone**, so a
downloaded report remains interpretable after someone changes
the filters in LMS or shares the file with another authorized
operator:

- **Membership record status filter:** All retained, Current
  only, or Archived only
- **Member name/title search applied:** Yes or No, never the
  search text or matched employee names
- **Resource name search applied:** Yes or No, never the
  literal name-search text
- **Resource type filter:** All types, Worker, Crew, or Equipment
- **Employee enrollment filter:** All, Enrolled only, or
  Resource-only
- **Resource card selection:** All selected, Matching only,
  or Without matches only
- **Resource card order:** Original directory, Most matching,
  or Fewest matching first

Each report row carries the same selection context in plain
words. The first eleven existing columns retain their original
names, ordering and count meanings. The report still includes
one row per selected resource (including zero-match resources
when requested), and can contain a header-only result if there
are no authorized resources in the selection. The detailed
**Download filtered roster memberships CSV** is unchanged.

The indicators use fixed, safe labels only: no raw member-name,
title, email, phone, identifier or directory-search text is
copied into the new fields. Resource names already visible in
the Resource Directory remain part of each selected resource
row. The exporter independently rechecks organization scope,
CSV formula protection and selected day validity.

These metadata columns describe historical filters, not
bookability, staff headcount, attendance or current employee
availability. No stored records, booking rules, permissions,
database/migrations, API, deployment, JSON backup or other
repository is changed. MIT and the fictional no-login demo
remain intact.

## Check the live roster review scope before exporting (PR #133)

In **Crews & availability → Resource directory → Roster membership
overview**, **Current roster review scope** now displays a compact,
read-only explanation of the active Resource Directory filters.
It identifies the current/archived resources tab, all-history
versus selected business-local day, current/archived membership
record status, Worker/Crew/Equipment resource type, retained
enrollment filter, all/matching/without-matches card selection,
and card ordering. It also shows **Yes/No** indicators for an
applied resource-name search and an applied employee-name or
membership-title search.

The scope refreshes with the existing controls, including the
three gap quick views, **Show all resource categories (keep
roster filters)** and **Clear resource filters**. It reuses
the same fixed safe filter labels as the roster overview CSV,
so the downloaded report and the screen describe those
selections consistently. The summary does **not** repeat the
search terms, names from employee records, contact information
or raw IDs. The Resource Directory's original search inputs
still show their own user-entered values, as before.

This is explanatory UI, not a new way to change access or
enrollment. Retained roster records do not establish actual
employee availability or booking eligibility. CSV outputs,
authorized record rows, time zone handling, sorting, enrollment,
scheduling, permissions, database, migrations, API, releases
and other repositories are not changed. MIT and the fictional
no-login demonstration remain intact.

## Reset membership review without clearing resource directory filters (PR #134)

Use **Reset membership review (keep resource filters)** in
**Crews & availability → Resource directory** when you want to
clear just the current *membership* review and return to
all retained membership history. It resets:

- Membership period from overlapping selected day to **All retained membership history**
- Membership record status to **All retained memberships**
- Membership-title / employee-name search to blank
- Membership-history sorting to **Retained record order**
- The hidden selected review date back to the main business review day

The button is disabled if those four visible membership-review
controls are already at their defaults. A hidden remembered
date by itself does not activate the button while **All
retained membership history** is selected.

Unlike **Clear resource filters**, this focused reset keeps
Resource Directory name search, Crew/Worker/Equipment type,
retained enrollment selection, matching-only/without-matches-only
resource-card view, resource-card ordering, current/archived
resource tab and per-card expanded/collapsed state unchanged.
The visible **Current roster review scope** updates alongside
the existing authorized totals and download eligibility.
The category **Show all resource categories (keep roster filters)**
button still performs the opposite narrower reset of type,
enrollment and card selection.

A missing matching membership record is only a historical
filter result, not worker availability or permission to book.
Neither reset modifies employee, resource or membership
records, CSV contents, organization scope, booking rules,
permissions, database/API/migrations, deployment, MIT license,
fictional no-login demo, or any other repository.

## Alphabetical Resource Directory card sorting (PR #135)

The **Sort resource cards** control in **Crews & availability →
Resource directory** now offers **Resource name A–Z** and
**Resource name Z–A** alongside the existing **Original directory
order**, **Most matching memberships first**, and **Fewest
matching memberships first** choices.

The new name sorts use the displayed resource name only. They
compare case-insensitively and with natural number order
(for example, Crew 2 before Crew 10 in A–Z), keeping original
directory order when names compare equal. Sorting never
changes the resources selected by directory search, kind,
enrollment, current/archived view, roster day/status/search,
or matching-only and without-matches-only filters. It also
does not alter the members within an individual resource
card; that remains controlled by **Sort membership history**.

Both the existing **Download filtered roster memberships CSV**
(resource-group order) and **Download roster overview CSV**
(one row per resource) follow the same authorized resource-card
name sorting. The overview CSV's existing **Resource card order**
field and the on-screen **Current roster review scope** report
**Resource name A-Z** or **Resource name Z-A**. No CSV columns
have been added or removed.

The sort runs entirely on an immutable view of the selected
resources, rechecking the organization boundary and preserving
the user's retained membership records and enrollment history.
These historical membership counts cannot establish actual
worker availability, staffing headcount or permission to book.
No database, permissions, API, scheduling, migrations, JSON
backup, deployment, other repository, MIT license or fictional
no-login demo behavior changes.

## Resource Directory type breakdown for selected and shown cards (PR #136)

In **Crews & availability → Resource directory**, the new
**Resource directory type breakdown** appears beneath the
**Showing X of Y current/archived resources** status line. It
displays two separate, read-only sets of counts:

- **Directory-selected resources:** The numbers of Crew,
  Worker, and Equipment resource records remaining after the
  Resource Directory's current/archived resource tab, name
  search, resource type, and retained enrollment filters
- **Shown resource cards:** The Crew, Worker, and Equipment
  counts currently displayed after the additional
  **Show only resources with matching memberships** or
  **Show only resources without matching memberships** choice

When neither matching-only checkbox is enabled, both sets of
counts agree. When a roster date, membership status, or
membership-title/employee-name search causes the card-only
filter to hide some resources, **Shown resource cards** can
be lower while **Directory-selected resources** continues to
describe the operator's directory selection. Zero-result
states display zero for all three categories. Resource-card
sort order, member-history sort order and expand/collapse
state do not change either count.

The counts are recomputed from resource records authorized
for the selected organization and ignore foreign records,
invalid resource kinds and employee records. They contain
no names, private search text, contacts, IDs, notes or
membership-row detail. A Crew resource is one Crew **record**,
not a headcount of employees; neither count indicates
available workers, scheduled labor, unused equipment or
booking eligibility. The existing roster overview and both
CSV reports remain unchanged.

This feature is presentation-only. No database, permissions,
API, stored records, enrollment/scheduling rules, migration,
backup/export format, deployment, other repository, MIT
licensing or fictional no-login demo behavior is modified.

## One-click resource type quick views (PR #137)

The **Resource directory type breakdown** now includes four
accessible, selected-state buttons: **View crews**, **View workers**,
**View equipment**, and **View all resource types**. These shortcuts
set the same **Filter resource type** dropdown already used by the
directory, so the directory-selected and shown-card type counts
and CSV downloads stay consistent with the visible resource cards.

The quick views preserve resource-name search, current/archived
resource tab, roster membership review date/status/name/title
search, enrollment selection for Crew/Worker/All, membership
card-only matching options, sorting and expand/collapse state.
Choosing **Equipment** resets **Filter employee enrollment**
to **All enrollment types**, because Equipment has no employee
enrollment and an enrolled-only or resource-only equipment
selection would otherwise show an apparently empty directory.
Afterward, **View all resource types** keeps enrollment at All;
an operator can manually reselect a different enrollment filter.
The shortcut for the currently selected resource type remains
marked as selected, and any type can be selected directly even
when the preceding type filter produced zero results.

The count labels above the buttons continue to reflect the
current resource filters, not counts for hypothetical alternative
filters. Consequently, choosing **View all resource types**
does not automatically clear resource-name search or an
existing Worker/Crew enrollment filter; the existing
**Clear resource filters** remains the full reset.

This is only a presentation shortcut. Each Crew/Worker/Equipment
number counts resource records, **not** people, booking capacity,
available staff, or equipment ready to schedule. No saved data,
roster/enrollment rules, permissions, CSV formats, API, database,
migrations, deployment, other repository, MIT licensing or
fictional no-login demonstration is changed.

## Preview results before switching resource types (PR #138)

Each of the four **View crews / View workers / View equipment /
View all resource types** shortcuts now displays a number in
parentheses: the count of directory resource **records that
would be selected if you clicked that button now**.

The preview uses the chosen current/archived resource tab and
the resource-name search, but deliberately evaluates the
*destination* resource type instead of the currently active
type. Worker and Crew previews respect the existing employee
enrollment filter (All, Enrolled, or Resource-only). The
Equipment preview always evaluates with **All enrollment
types**, matching the Equipment shortcut's existing rule that
employee enrollment cannot apply to equipment. **View all
resource types** keeps the current enrollment selection and
may therefore omit Equipment until the enrollment filter is
changed to All.

These are **directory-selected** previews, not predictions
of how many resource cards will remain visible after the
matching-only/without-matches-only membership filter. Those
existing filters and the separate shown-card breakdown remain
unchanged. The preview is recalculated when search,
enrollment or archive selection changes, including for
zero-result searches. The button's accessible name and
pressed state remain stable; the preview count is exposed
as supplementary accessible descriptive text.

Counts exclude foreign-organization resource and membership
records and do not display names, private search strings,
IDs, contacts, notes or employee information. They are counts
of historical resource records, never worker headcount,
staffing availability, free equipment or eligibility to book.

No database, API, resource/roster record, authorization,
enrollment, scheduling rule, CSV/JSON format, release,
deployment, other repository, MIT license or fictional
no-login demo behavior is changed.

## Preview shown cards after membership filters (PR #139)

The four **View crews / View workers / View equipment /
View all resource types** buttons now display two numbers:
**X directory, Y shown**. The first number is the same
prospective directory count from PR #138; the second predicts
the resource **cards that would remain visible** after clicking
that shortcut with the current roster membership filters.

Both numbers use the destination type filter, the current
resource-name search and the current/archived resource tab.
Worker/Crew/All retain the selected employee enrollment filter;
Equipment always resets enrollment to All, consistent with
the existing type shortcut. The **shown** number additionally
applies the current **Show only resources with matching
memberships** or **Show only resources without matching
memberships** toggle and its membership review day,
current/archived membership record status and
employee-name/membership-title search. When neither card-only
toggle is on, the two numbers are equal. When a toggle hides
cards, the shown count can be smaller (including zero) while
the directory count stays unchanged.

The previews evaluate all four prospective choices independently
of whichever type is currently selected. No action is needed to
refresh them: they update as filters change. The existing stable
button accessible names and selected states are preserved;
assistive-technology descriptions convey both counts. The
matching-only/no-match-only controls themselves remain the
actual source of truth for visible cards, and exports continue
to follow the authorized displayed selection.

Counts are of historical **resource records**, not unique
employees, free workers or booking eligibility. The helper
rechecks organization boundaries for resources, memberships
and linked employee names even with colliding IDs. No private
search text, employee names, contacts, notes or IDs are
shown in the preview, and no data is modified.

No membership records, resource enrollment, availability,
scheduling/permissions, API, database, CSV/JSON formats,
migrations, deployment, other repository, MIT license or
fictional no-login demo behavior changes.

## Restore cards hidden by an empty roster-only view (PR #140)

Sometimes the Resource Directory still contains valid Worker,
Crew, or Equipment records even though no resource cards are
visible. For example, **Show only resources with matching
memberships** may hide every card when no membership matches
the selected historic day, current/archived status or member
search. Conversely, **Show only resources without matching
memberships** may hide every card when each selected resource
has a matching record.

When directory-selected resources exist, **zero** cards are
shown, and either card-only filter is on, the empty state now
explains which card-only filter is hiding the selection and
shows **Show all selected resource cards (keep filters)**.
It clears **only** the two mutually exclusive card-only
toggles. The existing Resource Directory name/type/enrollment
filters, current/archived resource tab, membership review
day/status/search, member and resource-card sort, and
individual card collapse state remain intact. The existing
counts and authorized CSV eligibility then recompute using
the restored displayed selection.

This focused button does **not** appear when the directory
selection itself is empty (for example, an unmatched name
search or type filter). In that situation, use the existing
directory controls or **Clear resource filters**. The new
action is narrower than **Show all resource categories (keep
roster filters)**, which also resets type and enrollment, and
**Reset membership review (keep resource filters)**, which
resets the historic membership date/status/search/sort.

A missing historic membership match is not proof that any
employee, crew or equipment item is available or can be
booked. This action is view-only: it makes no saved-record
edits, does not change enrollment or permissions, and has
no effect on database/API/migrations, scheduling, CSV or JSON
formats, releases, deployments, other repositories, the MIT
license or the fictional no-login demonstration.

## Recover a resource directory narrowed by a name search (PR #141)

If the **Search resource directory** field contains a term and
the directory has **zero matching resource records**, LMS now
checks whether clearing *only* that search would restore any
authorized resources while **preserving the selected resource
type, retained enrollment filter and current/archived tab**.

When a narrower name search is the reason for the empty
directory, the empty state shows a read-only count of the
resources that would return, plus **Clear resource name search
(keep other filters)**. The button removes only the resource
name search. It leaves the active Worker/Crew/Equipment type,
employee enrollment, selected business-local roster day,
membership record status, employee-name/title search,
matching-only or without-matches-only roster cards, sorting
and per-card collapse state unchanged.

The suggestion is **not** shown for an empty search term,
a name query that already matches resources, an archive tab
with no records, or a type/enrollment filter that would stay
empty even after clearing the name search. In those cases,
use the type/enrollment controls or the existing broader
**Clear resource filters** action. When a membership-only
card filter still hides the recovered directory resources,
the separate **Show all selected resource cards (keep filters)**
action may then be useful.

This feature is a read-only recovery suggestion. Its counts
are computed only from resource and membership records for
the requested organization, including archived retained
enrollment where applicable. The suggestion does not expose
matched names, search terms, contacts, internal IDs or notes.
A retained membership match or lack of one is not proof of
staff availability or booking eligibility.

No saved record, organization permissions, enrollment rules,
scheduling, database/API/migration, CSV/JSON format,
release/deployment, other repository, MIT license or
fictional no-login demo behavior is changed.

## Recover an empty directory narrowed by employee enrollment (PR #142)

When **Filter employee enrollment** is set to **Enrolled workers/crews**
or **Resource-only workers/crews**, the directory may show zero
resources even though authorized resources satisfy the other
directory filters.

If and only if clearing **the enrollment filter alone** would
restore resource records, the empty directory now offers
**Show all enrollment types (keep other filters)**, alongside a
read-only count of records that would return. This targeted
action resets enrollment to **All enrollment types** while
preserving the name search, Crew/Worker/Equipment type filter,
current/archived tab, historic membership review date/status
and employee-name/title search, match-only/no-match-only
card selection, sorting and each card's collapsed state.

The suggestion is omitted for the default All enrollment
setting, any directory selection that already has records,
or a selected resource name/type/archive view that would
remain empty with All enrollment. Because the equipment
resource type cannot be employee-enrolled, selecting All
enrollment can also recover equipment-only views. Worker/
Crew resources with **any retained dated membership** are
considered enrolled for directory classification even when
the last membership was archived; clearing enrollment never
modifies that historical classification.

This is a separate recovery from **Clear resource name search
(keep other filters)** (PR #141) and **Show all selected resource
cards (keep filters)** (PR #140). If a roster-only matching
filter still hides recovered directory cards, the roster-card
recovery may be needed as a second, separate step.

Counts use resource and membership records scoped to the
current organization and do not expose names, raw search
terms, contact information, notes or IDs. They are counts
of historical resource **records**, not evidence of
available employees, free equipment or booking eligibility.

No saved records, enrollment history, permissions, schedule
rules, database/API/migrations, CSV/JSON format, releases,
deployment, other repository, MIT license or fictional
public no-login demo behavior changes.

## Recover an empty directory narrowed by resource type (PR #143)

When **Filter resource type** is set to Crew, Worker or
Equipment, the Resource Directory can appear empty even when
authorized resources match the current name search,
employee-enrollment filter and current/archived resource tab.

If changing **only resource type** to **All resource types**
would restore records, the empty state offers a read-only
count plus **Show all resource types (keep other filters)**.
Clicking this button changes only the type dropdown; it keeps
resource name search, employee enrollment, current/archived
tab, membership review day/status/name/title search,
matching-only/without-matches-only resource-card filters,
sorting and each card's expand/collapse selection.

The suggestion is **not** shown when All types is already
selected, the current directory has matching resources, the
name search still excludes everything, or the enrollment/
current-archived selection would exclude every resource even
after choosing All types. Importantly, choosing All types
here **preserves** enrolled-only or resource-only selection,
which can exclude Equipment. This differs from the existing
**View equipment** quick shortcut, which intentionally clears
enrollment because Equipment has no employee enrollment.

Type-only recovery complements **Clear resource name search
(keep other filters)**, **Show all enrollment types (keep other
filters)**, and **Show all selected resource cards (keep
filters)**. The complete **Clear resource filters** action
remains available for a deliberate wider reset.

The returned number counts authorized resource records, not
people, work availability, or bookable capacity. The helper
checks resource and retained membership organization boundaries
and never exposes names, private search text, identifiers,
contact information or notes. No saved records, enrollment
classification, scheduling, permissions, database/API,
migration, CSV/JSON format, deployment, other repository,
MIT license or fictional public no-login demo changes.

## Recover a directory hidden by multiple filters together (PR #144)

If the **resource name search**, **resource type**, and/or
**employee enrollment** filters interact to hide every resource,
a single-filter recovery might not be enough. LMS now checks
for this special combination of at least **two active
directory filters**, when zero directory resources are selected.

If the existing individual **Clear resource name search**,
**Show all enrollment types**, and **Show all resource types**
recoveries would *all* still leave the directory empty, but
clearing the three directory controls together would restore
authorized resource records, the empty state offers
**Reset directory selection (keep roster review)** with a
privacy-safe count of records that would return.

Unlike the existing **Clear resource filters**, this targeted
recovery resets *only* directory name search, resource type
and employee enrollment to their defaults. It preserves:

- Current or archived resource tab
- The membership review period, business-local day, current/
  archived membership record status, and member name/title search
- Matching-only and without-matches-only roster-card filters
- Resource-card and membership-row sort order, and each card's
  expanded or collapsed state

The existing single-filter recovery takes priority whenever
clearing just one control would suffice. No combined suggestion
appears if the directory is already nonempty, fewer than two
directory filters are active, or the chosen current/archived
tab itself contains no resource records. If a retained
membership-only card filter still hides the restored directory
selection, **Show all selected resource cards (keep filters)**
can be used separately without touching the roster day.

All recovery counts recheck the current organization for
resource and retained membership records. No names, raw
search terms, IDs, contacts or private membership details
are exposed, and these counts represent historical resource
**records**, not workers available to book or staffing
capacity. No saved records, permissions, enrollment history,
scheduling rules, APIs, database, migration, CSV/JSON formats,
release, deployment, other repository, MIT license or
fictional public no-login demo behavior changes.
