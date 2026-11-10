# Install the fictional LMS demo

LMS runs locally with two sample businesses and no login. Use made-up names, work, amounts and images. The demo stores records, draft plans, images and changes in memory. Sessions expire after two hours. Stopping or restarting the server erases all demo workspaces. A saved draft is still temporary.

## Install and start

Use Node.js 24 with npm and Git. Allow roughly 1 GB of free memory for the demo, with additional room for build and browser tests. The lockfile pins the dependencies. Installation needs network access for npm. The running demo needs no account, API key or database service.

For Windows setup using File Explorer and PowerShell, see the [Windows installation guide](install-windows.md). For source ZIP checks and publication gates, see the [release candidate notes](release-candidate.md).

From a terminal:

```sh
git clone https://github.com/larrinamsalva/LMS.git
cd LMS
npm ci
npm run build
npm run demo
```

Open **http://127.0.0.1:3000** in a browser on the same computer. Keep the terminal open. Use **Ctrl+C** to stop. Run `npm run demo -- --port 3200` and open **http://127.0.0.1:3200** if port 3000 is occupied. Use the displayed numeric address because writes check the exact origin. The launcher accepts only a port and binds to IPv4 loopback.

Use `npm run dev` for source development. The existing `npm start` also remains available for development and the regular browser tests. The release install uses a Git checkout and npm. Docker was unavailable for launch verification during this phase, so a demo image is deferred. The existing Compose setup is for the separate host-only PostgreSQL lab.

## First visit

1. Choose **Explore the working demo**. Use **Business workspace** to switch between **Property Manager** and **Cleaning Company**. Each has its own fictional records.
2. Open **Customers** and add a made-up name. Open **Cleaning jobs** or **Maintenance requests** and link a new record to that customer. In **Schedule**, add an appointment with the matching customer, work, resource and times. A seeded crew or worker may have restricted hours. Use **Crews & availability** to check them or add a new resource for a resource-only booking.
3. In **Inventory & stock**, use the seeded SKU or select a product, then review and post a fictional movement. In **Estimates**, link an estimate to the customer and work, select the local pricing zone, load a service rate and confirm the amounts.
4. To try optional **Equipment & Tools** or **Invoice Drafts** in a sample workspace, open **BuildPlan Studio** from that workspace, keep its current project, select the features, save the draft and explicitly confirm publication in **Review & try**. Register equipment at an existing stock location. An initial inspection and explicit release are required before checkout. Convert a reviewed estimate through **Create Invoice Draft from Estimate** and verify the **FICTIONAL DRAFT — NOT ISSUED** label.
5. To design a new workspace, open **Build My Business System** or **BuildPlan Studio** and choose a business starter. Choose features in **Features** and edit the business name and branding in **Customize**. Under **Review & try**, prepare an interactive preview and open it in a new tab. Starter previews use their own workspace and begin without sample records.
6. In **Review & try**, use **Export BuildPlan JSON** for configuration. The Blueprint tools can also export a supported ZIP. Reopen a compatible configuration through Studio import and review. Keep the file locally. Configuration exports do not restore business records, sessions or saved history.

## Readiness matrix

| State | Scope | Evidence or boundary |
| --- | --- | --- |
| Working and tested | No-login cleaning/property workspaces, linked customer and work records, daily scheduling, stock ledger, estimates, BuildPlan review/preview/export, light/dark themes | Installed-release workflows plus the regular browser, Foundation and PostgreSQL suites |
| Working with restrictions | Optional equipment, one crew/worker plus one mapped equipment reservation, and invoice drafts | Enable required modules through publication. Inspection, resource, availability, stock and draft confirmation rules still apply. Invoices remain unissued. |
| Working with restrictions | Gallery, scoped previews, configuration history, temporary private logos and data-only portable formats | Bounded sessions, strict version validation and explicit review. Publisher trust enrollment remains empty. |
| Experimental, host-only | Durable PostgreSQL, fictional identity and membership operations, native backup/restore, credential recovery and upgrade rehearsal | Separate local lab. Restored runtime activation remains blocked. |
| Unimplemented | Recurring scheduling, live payment, financial issuance, outbound delivery, executable BuildPlan deployment and real-data migration | See the [roadmap](../ROADMAP.md). |
| Blocked for production | Real-business operation and public deployment | Requires verified user identity and lifecycle, accepted public HTTP/session security, recovery/restore acceptance, operational privacy and retention controls, and separate financial and migration reviews. See [SECURITY](../SECURITY.md). |

## Check the install

```sh
npm run check
npm run test:install
npx playwright install chromium
npm run test:release
npm run test:e2e
```

Run the browser suites one at a time to limit local memory use. The install smoke launches the built demo, verifies the API and browser session contract, stops the process and starts a fresh one. A deterministic integration test separately expires a session without waiting two hours. The release browser suite uses the launcher for both business workflows on desktop, tablet and phone. For native database tests, use the disposable credentials and PostgreSQL tools in the [native test setup](postgres-setup.md) or run the GitHub quality workflow. The release job runs the install and browser checks from an extracted source candidate on Windows and Linux. The review PR records completed counts, job links and screenshots.

## Screenshots from the installed demo

- [Cleaning appointment with its linked customer and work, desktop light mode](screenshots/first-release/cleaning-schedule-desktop.png)
- [Unissued property invoice draft with its saved estimate revision, phone dark mode](screenshots/first-release/property-invoice-phone-dark.png)

Both captures are from completed workflows using the production build and the local launcher.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| Missing build or incomplete install | Run `npm ci` and `npm run build` again in the checkout. |
| Launcher refuses environment files | Use a clean checkout for the demo. Keep local database or hosting settings in their own workspace. |
| Port already in use | Stop the other local server or choose another port using `--port`. |
| Changes are refused as coming from another page | Open the exact `http://127.0.0.1:PORT` URL printed by the launcher. |
| Expired session or empty records after restart | Start a fresh demo. Import a previously exported configuration if you want to reuse it. |
| Demo capacity reached | Export needed configurations and restart the local server. Protected expired histories can hold one of the 24 runtime slots until restart. |
| Optional feature absent | Check **Features** in the current workspace's BuildPlan and review required dependencies before publishing. |

## Daily Operations (PR #39)

The fictional workspace's **Daily operations** section is a read-only overview
derived from records in the current organization. Choose a business-local date
to review non-cancelled appointments overlapping that day (including overnight
appointments), unfinished cleaning jobs or tasks due on the date, and work
that was already overdue. When Equipment & Tools is enabled, the overview also
shows physical condition problems and inspections due by the selected date.
The links take you to the existing Schedule, work and Equipment screens.

The overview does **not** assign staff, create reminders, guarantee resource
availability, check out equipment or send messages. Undated tasks are omitted
from due-date counts rather than assigned invented deadlines. Retired and
archived tools are not included in repair warnings. Dates follow the business
time zone even on daylight-saving days shorter or longer than 24 hours.
All information remains fictional, session-scoped and temporary.

### Open the matching calendar date (PR #40)

Choose a date in **Daily operations**, then click **Open Schedule for YYYY-MM-DD**
to open that exact business-local day in the existing Schedule screen. You can
still move to previous/next day or choose another date in Schedule. This is an
in-memory navigation aid only: it never reschedules appointments, changes their
time zones, creates records or publishes configuration. Opening Schedule through
the normal sidebar uses its usual default date. Switching organizations clears
the earlier date handoff, keeping each business independent. If the Scheduling
module is disabled, Daily Operations explains that the calendar is unavailable
rather than exposing an unavailable feature.

### Find an exact work record (PR #41)

When Daily Operations shows an unfinished task or cleaning job, choose
**Find this work** to focus its exact record in the normal work list. The
focus uses the saved record ID, not a title search, so two similarly named
jobs are not confused. Select **Show all** to clear the focus and return
to the complete list. Editing search, switching the archived filter, navigating
to another section or switching business also clears this focus.

Finding work is a read-only navigation action, including for viewers. It does
not open the editor, change deadlines/status, create a notification, publish
a configuration, or bypass the normal record access permissions. Only records
from the current authorized organization are considered.

### Find the exact equipment needing inspection (PR #42)

When Equipment & Tools is enabled, each Daily Operations condition or inspection
warning now offers **Find this equipment**. It opens the existing Equipment &
Tools list focused on that exact saved asset ID, not a search for its name.
Use **Show all equipment** to return to the full list. Searching, adjusting
equipment filters, changing views or switching businesses clears the focus.

The focus is read-only and uses the current authorized workspace's records.
It does not check out or release equipment, sign off an inspection, edit a
machine, open maintenance automatically or send a reminder. Any such action
still requires the existing role permissions and explicit separate review.

### Find the exact appointment on a calendar day (PR #43)

In **Daily operations → Appointments**, choose **Find this appointment**
beside a scheduled or completed appointment to open that specific saved
appointment on the matching business-local Schedule date. The focused
calendar shows only its exact record ID, not a title search. Select **Show
all appointments** to restore the day's other bookings. Changing dates,
toggling the archived filter, using sidebar navigation or switching businesses
also clears the focus.

This is temporary read-only navigation. It never reschedules an appointment,
edits resource allocations, approves equipment checkout or sends notices.
Cancelled and archived appointments are not offered from Daily Operations,
and the existing role permissions still govern all separate edit actions.

### Review all daily items without losing your place (PR #44)

Daily Operations initially shows up to **four** appointments, work items and
equipment warnings in each section, while the summary cards display the full
counts. If a section contains more, its **Show N more** control reveals the
next four (or any smaller remainder), and **Show fewer** restores the first
four. Each section expands independently; the total is always visible. The
list resets to four when you choose another operations date or switch business.

This is a local, read-only display preference. Expanding a section never
loads another business's records, writes to the database, changes due dates,
books an appointment, modifies equipment or creates a notification. Each row
retains its existing precise navigation link.

### Move between business days (PR #45)

**Previous day**, **Next day** and **Today** let you navigate Daily Operations
without repeatedly opening the date picker. These controls work in the
business's selected time zone rather than the device time zone, using calendar
arithmetic across daylight-saving changes and leap days. **Today** always
recalculates the business-local date when pressed. Previous and Next become
unavailable at the existing 2020–2100 date-picker bounds. You can still enter
a date directly, and any date change restores each list to its first four
items. No dates are written back to appointments, jobs or equipment records.

### Download a local daily plan (PR #46)

The **Download daily plan CSV** button exports the **selected business-local
date** from the authorized fictional workspace into a file suitable for
opening in spreadsheet apps. It includes all matching non-cancelled
appointments, all unfinished due/overdue jobs and tasks, and relevant equipment
condition/inspection warnings if Equipment & Tools is enabled. The export
includes every matching item, even when the on-screen lists show only four,
and labels all rows with the business time zone. It omits customers' contact
details, private notes, payroll, invoices and payments.

The file is generated **locally in the browser**; no background job, external
service, API endpoint, new demo session or data write is involved. All values
are CSV-quoted and spreadsheet-formula prefixes are escaped to prevent a
record title from being evaluated as a formula. As with any download, keep
the resulting file in a suitable location. A draft, report or export is **not**
an invoice, legal notice, confirmation of booking availability or equipment
checkout authorization. No actual business data is included in the public
fictional demo.

### Seven-day upcoming work outlook (PR #47)

Daily Operations shows **Coming up · next 7 days** for unfinished jobs and
tasks dated **after** the selected operations date, through the seventh
following **business-local calendar day** (inclusive). It excludes work due
today, overdue items, completed/cancelled jobs, archived records, undated
tasks and records from any other business. The list orders work by due
date and then name, supports **Show more / Show fewer**, and offers the same
**Find this work** link to the exact current-business record.

This is planning visibility only, not an automatic booking, staff allocation,
reminder or guarantee of availability. Changing the operations date updates
the upcoming window and resets expansion. The **Download daily plan CSV**
continues to export only the selected day's appointments, current/overdue
work and equipment warnings: future upcoming work does **not** silently
appear in that daily export. All preview data remains fictional in the public
no-login demonstration.

### Seven-day upcoming appointment outlook (PR #48)

The same seven-day window also displays **Coming up · appointments** for
non-cancelled, non-archived appointments whose **start time** falls on business
calendar days 1 through 7 after the selected operations date, inclusive.
Results are ordered by actual appointment start time, and the time and date
are shown in the business's configured time zone. If Scheduling is enabled,
**Find this appointment** opens that exact saved booking on its actual start
date in Schedule. Pagination follows the same independent Show more / Show
fewer behavior.

An overnight appointment that starts on the selected day stays in the
selected-day appointment section; it is not duplicated in the future-start
outlook. Archived/cancelled bookings and other organizations' records are
excluded. The Daily Plan CSV remains intentionally scoped to the selected
day, not the coming week. Viewing this outlook makes no booking or
reservation changes and does not predict availability.

### Download seven-day outlook CSV (PR #49)

**Download seven-day outlook CSV** saves a separate, read-only spreadsheet file
for the **seven business-local calendar dates after** the selected Daily
Operations date (days +1 through +7, inclusive). It includes every upcoming
non-cancelled appointment and unfinished dated job/task from the current
authorized business, even items currently hidden behind **Show more**. Rows
are sorted by business-local date/time; jobs/tasks with no appointment time
appear before timed bookings on the same day. The filename specifies the
selected date and last included date.

The original **Download daily plan CSV** remains a distinct download for the
selected date, overdue work and relevant equipment alerts. Neither download
changes bookings, assignments, records or availability. Both files are built
locally in the browser, contain no contact details, financial amounts or
notes, and use the existing spreadsheet-safe CSV escaping. The public demo
contains fictional records only; treat downloaded files as sensitive if used
with a real workspace.

### Find unfinished work without a due date (PR #50)

**Needs scheduling** is a separate Daily Operations section for unfinished
tasks or jobs in the current authorized business that have **no saved due
date**. It does not infer or assign a deadline and will not place those items
in today's overdue/due list or in the seven-day forecast. The section provides
a total count, expandable **Show more / Show fewer** list and **Find this
work** links to the exact task/job record, where a permitted user can review
the details and separately decide whether to add a due date.

Completed/cancelled, archived and cross-business records are excluded. This
undated queue is a planning observation, not a booking or a due-date
recommendation, and is not silently included in either the existing
selected-day CSV or seven-day outlook CSV. The display is read-only, is
responsive on phones/tablets, and uses the fictional data already present
in the public demo.

### Download the Needs Scheduling review list (PR #51)

The **Download needs scheduling CSV** button inside **Needs scheduling**
produces a separate local spreadsheet file containing **all** undated,
unfinished work from the current authorized business, even when the list is
collapsed to four visible items. The review-date column identifies when the
list was downloaded; it is **not a due date**. Every due-date cell is blank,
because no deadline is known or assigned. The file contains work type,
title, current status and business time zone, but does not include customer
contact information, notes or financial records.

The download is disabled when no work needs scheduling, and never saves
changes, schedules appointments or sends notifications. The original daily
and seven-day CSV files remain unchanged and exclude undated work. Values
reuse the existing CSV quoting and spreadsheet-formula protections. In the
no-login public demo, all records are fictional.

### Upcoming equipment inspections (PR #52)

When **Equipment & Tools** is enabled, Daily Operations displays
**Equipment inspections coming up** and the **Inspections next 7 days** count
for serviceable assets with a saved `next inspection` date on the following
seven **business-local calendar days**. It includes the seventh day and
excludes today, overdue dates, retired/non-serviceable equipment, archived
assets and other businesses' equipment. Today's overdue inspections and
problem conditions remain in **Equipment to review** rather than being
duplicated into this future-only list.

Results are ordered by inspection date and then asset name; **Show more /
Show fewer** handles longer lists. **Find this equipment** opens the exact
asset using the existing business-validated read-only handoff. Merely viewing
the section never records a service, changes equipment condition, authorizes
checkout, schedules maintenance, or sends reminders. It is a planning preview,
not a confirmation that an asset is safe or available to use. The daily,
seven-day and undated CSV downloads are unchanged.

### Download the upcoming equipment inspection list (PR #53)

Within **Equipment inspections coming up**, choose **Download upcoming
inspections CSV** to save the entire list of current-business, serviceable
assets with a recorded next-inspection date in the following **seven
business-local calendar days**. It includes items beyond the first four
visible on screen, along with the saved business equipment ID, next-inspection
date, recorded condition, business time zone and the selected review window.
It omits contacts, serial numbers, private notes and equipment purchase costs.

This download is separate from the daily, seven-day work and undated-work
CSVs. It is created locally in the browser using the existing formula-safe
spreadsheet escaping; no API request, equipment checkout, service command or
record write is performed. If there are no upcoming inspections, the exported
file contains only column headings. The report is a read-only planning
snapshot and **does not certify that equipment is safe for use**, or
automatically schedule or confirm an inspection.

### Seven-day workload by date (PR #54)

**Next seven days · workload by date** displays seven business-local calendar
days after the selected Daily Operations date, including days with zero saved
items. Each date shows the number of **non-cancelled appointments starting on
that date** and **unfinished jobs/tasks with that due date**. An overnight
appointment counts only on its saved start day; it is not counted again on
each day it overlaps. The counts respect the current business's access and
exclude archived/foreign records, completed/cancelled work, undated work and
overdue tasks. Leap days and daylight-saving changes use calendar-day logic.

Select a date to open that day's existing Daily Operations view, preserving
the original appointment and work record links. Date navigation resets
expanded lists normally. This is an overview of **saved record dates**, not
employee availability, job duration, equipment readiness, confirmed resource
capacity, staff assignment, or a new appointment booking. Nothing is changed
or stored by opening a date, and all existing CSV exports remain distinct.

### Equipment inspections in the seven-day workload (PR #55)

When **Equipment & Tools** is enabled, each date in **Next seven days ·
workload by date** now shows a third count: upcoming equipment inspections
with a **saved next-inspection date** on that business-local day. This uses
the same authorized, read-only inspection outlook as the existing detailed
equipment panel and CSV. Serviceable assets only; today's and overdue
inspections, retired or non-serviceable assets, archived records and other
businesses' assets do not appear in these future counts.

When the Equipment & Tools module is disabled, the inspection count stays
hidden so other workspace types keep the simpler two-count overview.
Selecting a date still navigates to existing Daily Operations; it does not
change an asset's condition, record a service, create a maintenance task,
or determine whether equipment is safe/available for use.

### Seven-day workload summary totals (PR #56)

Above the seven individual date cards, **Seven-day workload totals** adds
read-only counts for saved upcoming appointment starts, unfinished work due
within the next seven business-local calendar days, and the number of days
with at least one recorded item. Workspaces with **Equipment & Tools**
enabled also display upcoming inspection totals and count an
inspection-only day as a day with saved activity. Workspaces without the
module do not include inspections in either measure.

The totals are derived from the same seven authorized per-day cards, so
the reporting window, organization boundaries, exclusions for cancelled
or finished/archived work, and business-local time-zone behavior stay
identical. An appointment appears once on its start date, and undated or
overdue work is not silently counted as future activity. These are
**counts of saved records**, not scheduled hours, free capacity, safe
equipment status or proof that staff can accept more bookings. No edits,
automatic bookings, new exports or notifications are created.

### Download seven-day workload summary CSV (PR #57)

**Download seven-day workload CSV** in the seven-day workload section saves
a separate read-only report of **seven individual business-local dates**
followed by a **TOTAL (7 days)** row. Each date includes saved appointment
starts, unfinished work due and whether any recorded activity exists;
workspaces with **Equipment & Tools** enabled also include saved upcoming
inspection counts. The final row reports the same totals and count of
activity days as the displayed summary cards.

This report contains **counts only**: it excludes record titles, names,
customer contacts, private notes, financial amounts and other businesses'
data. If Equipment & Tools is disabled, inspection columns are omitted and
inspection-only dates do not count as active. All values derive from the
existing authorized seven-day workload; no bookings or records are changed.
The file is created locally using existing spreadsheet-safe CSV quoting
and includes the reviewed date range and business time zone. The daily plan,
upcoming work, equipment inspections and Needs Scheduling exports remain
independent, and these counts must not be interpreted as staff availability
or confirmed capacity.

### Filter the seven-day cards to dates with saved activity (PR #58)

**Show active days only** filters the seven Daily Operations workload cards to
dates with at least one saved upcoming appointment start or unfinished work
due, plus an upcoming inspection when Equipment & Tools is enabled.
**Show all seven days** restores the default display, including empty days.
A live count explains how many dates are currently visible, with an explicit
empty state if there is no upcoming saved activity.

This is a **display-only, reversible filter**. The seven-day summary totals
and all CSV exports still cover the **full seven-day period**, even when
empty-day cards are temporarily hidden. It never infers employee capacity,
excludes a valid active day from calculations, changes bookings, or writes
records. In workspaces without Equipment & Tools, inspection-only dates do
not qualify as active.

### Jump to the day with the most saved activity (PR #59)

**Most recorded activity** highlights the future date with the greatest
number of saved items in the seven-day workload: appointments starting
that day, unfinished work due, and (only when Equipment & Tools is
enabled) upcoming inspections. Every recorded item counts as one,
regardless of duration or difficulty. When multiple dates tie, the
**earliest date** is shown, with the number of tied dates. The **Review
DATE** shortcut opens that day's existing Daily Operations view.

This is a **record-count shortcut, not a claim about a business's
staffing capacity, actual workload hours, priority or equipment safety**.
It uses the *full authorized seven-day window* even if **Show active
days only** is selected. An empty week displays a message instead of a
button. The shortcut makes no record changes and does not alter existing
weekly totals, CSV downloads, schedules or date filtering.


### Sort the seven-day workload cards by saved activity (PR #60)

The **Sort by most recorded items** button temporarily orders the seven
future business-local dates from the largest to the smallest count of
saved appointments, unfinished work and (only for Equipment & Tools
workspaces) upcoming equipment inspections. Ties use the **earliest date**
first, consistent with **Most recorded activity**. **Sort by calendar
date** restores the chronological order used by default.

Sorting combines with **Show active days only** without changing which
dates qualify as active. It only changes the order of the visible cards:
the full-window totals, selected Operations date, record navigation,
read-only summary, and all CSV files stay unchanged and chronological.
A recorded-item count is **not a measure of job duration, staff workload,
equipment safety, availability or business capacity**.


### Filter workload dates by recorded activity type (PR #61)

**Activity to show** allows a business owner to focus the seven-day date
cards on saved **appointment start dates** or **unfinished work due dates**.
When Equipment & Tools is enabled, **Equipment inspection dates** is also
available, using only serviceable equipment's saved future inspection
dates. The selection narrows visible dates, not their per-day counts,
permissions, work status or the business's underlying schedule.

Selecting a specific type automatically turns on the visible-date filter.
**Show all seven days** clears the type selection and displays the full
calendar again. **All recorded activity** uses the existing active-days
toggle. Type filtering combines with sorting by recorded items and has a
specific empty state when no dates match.

The full seven-day totals, busiest-recorded-day shortcut and all CSV
exports remain based on the complete authorized week, independent of
on-screen filtering. Record counts cannot establish job hours, resource
availability or equipment safety. No business records are modified.



### Focused activity counts for workload date filters (PR #62)

When a business owner selects appointment dates, unfinished work due dates,
or enabled equipment inspection dates, Daily Operations now shows the number
of saved matching items and the number of matching business-local calendar
days within the same seven-day window. A zero-match category explicitly
shows zero rather than suggesting that there are no records of other types.
The focused count is a read-only presentation of the authorized workspace's
existing date snapshot, not work hours, staff capacity or a readiness signal.

The full-week totals, busiest day, source date cards, other controls and every
CSV export continue to reflect the complete seven-day snapshot. Switching
to a business without Equipment & Tools safely falls back to the all-activity
view if an inspection filter had been selected in the prior workspace. No
database, permission, schedule, financial, session or release changes.


### Category-aware workload date ordering (PR #63)

With "Activity to show" set to appointment starts, unfinished work due
dates or equipment inspection dates, sorting by "most" ranks the visible
days using only the chosen category's saved-record counts. Dates with
equal selected counts remain ordered from earliest to latest. The sort
control and order status name the selected category. The default
"All recorded activity" sorting and "Sort by calendar date" retain their
prior behavior. Counts come only from the authorized business-local
seven-day snapshot. Full-week totals, the busiest overall day and every
CSV export remain unaffected. Disabled equipment modules contribute no
inspection counts. No mutations, capacity inference or release changes.


### Selected activity peak-day shortcut (PR #64)

When a specific seven-day workload category is selected, Daily Operations
offers a separate **Most recorded [selected activity]** date and a review
shortcut, using only that category's saved records. Ties select the earliest
business-local date and report the count of tied days. A category with no
saved matching records has no peak shortcut. This differs deliberately
from the existing **Most recorded activity** shortcut, which always uses
the complete authorized seven-day snapshot. Both are read-only saved-record
counts, not duration, staffing, safety or availability assessments.
The existing date, export, sorting, full-week totals and financial behavior
remain unchanged. All examples in the public no-login demo are fictional.


### Selected-category counts on individual workload date cards (PR #65)

When an activity-type filter is selected, each visible seven-day workload
date card puts its saved matching activity count first under a clear
**Selected:** label. The appointment, unfinished-work, and enabled equipment
inspection counts remain visible below it, as before. The visual callout
reuses the same deterministic current-business count as category totals
and ranking, with no new server query. Screen-reader date-card labels still
announce those underlying category counts without redundantly repeating
the visual callout. When All recorded activity is selected or the filter
is reset, the extra callout disappears.

This is a read-only visual aid, not a sign of staffing capacity, job
duration, booking availability or equipment clearance. Dates, source
records, exports, week totals, permissions, sessions and other systems
are unchanged; fictional no-login demos and MIT license remain intact.


### Reset the seven-day workload view (PR #66)

Daily Operations offers **Reset workload view** to clear both the selected
activity type and active-days-only filter and restore the original seven
business-local dates in chronological order with one action. This is
distinct from **Show all seven days**, which intentionally does not
change sorting. The reset button is disabled when all controls are at
their initial values. It works for empty category filters and after
switching businesses with different enabled modules. Reset does not
change the selected operations date, any saved records, dashboard
totals, the overall or focused peak logic, CSV data, or permissions.
The no-login public demonstration still uses only fictional data.


### Business-local weekdays on seven-day workload cards (PR #67)

Each Daily Operations seven-day workload date card now shows its full
**weekday name** alongside the ISO calendar date, including on small screens.
The name is calculated from the business-local plain date rather than from
the browser's machine time zone, so DST transitions and leap dates do not
shift the label. Screen readers retain the existing date-card action label
and receive the weekday as a separate description. Weekday labels remain
visible while filtering, sorting or resetting the workload view.

This is calendar context only: Saturday or Sunday does not imply staff
availability, operating hours, equipment readiness or booking rules.
Workload counts, saved records, selected date, exports, permissions,
modules, account controls and the fictional no-login demo are unchanged.
