# Recurring visit planner — date-only preview (PR #201)

## Purpose
Make the Schedule page useful for recurring cleaning visits and
property-maintenance plans without introducing unsafe automatic bookings.

**This phase is a date-only preview**, not a recurring appointment system.
No start/end times, crew/resource allocation, customer record selection,
conflict reservation, invoice, API call, database write, background job,
reminder or notification is created.

## What users can do
1. Open **Schedule** in either the fictional Cleaning Company or Property
   Manager workspace. Choose a **Schedule date** as the first visit.
2. Expand **Preview repeating visit dates (no bookings)**.
3. Pick **Every week**, **Every two weeks**, or **Every four weeks (not
   monthly)** and select 2, 4, 6, 8 or 12 preview occurrences.
4. Inspect the full date-only list. A four-week interval means *28
   calendar days*, not the same day in the next month.
5. To actually book any visit, use the existing **Add appointment**
   form individually, with its required customer/work, exact start/end
   instants, authorized resources, DST handling, database exclusions
   and final conflict checks.

The planner shares the current Schedule **date and business time zone**
context. It does not attempt to infer times or timezone offsets.
It is collapsed by default, works by keyboard and touch, and uses the
same light/dark contrast tokens and responsive controls as the agenda.

## Technical boundary
- Pure `previewRecurringVisitDates(startDate, everyWeeks, occurrences)`
  uses strict ISO **calendar dates**, not UTC milliseconds.
- Allows **only** weeks 1, 2 or 4 and 2–12 generated dates. Rejects
  malformed/nonexistent dates and plans outside **2020-01-01** through
  **2100-12-31**, consistent with existing appointment date policy.
- Generates all occurrences or refuses the entire preview; there is
  no partial plan whose final dates silently go out of range.
- Leap days, year-end and DST boundary crossings are valid because the
  arithmetic adds plain calendar days, not hours or instants.
- Preview output contains no personal, customer or resource data. The
  input is never persisted or serialized into a Blueprint.
- This does not claim availability. Existing single-appointment forms
  remain the sole booking and conflict-confirmation path.

## Verification and next phases
- Unit regression covers 720 fictional start dates under all allowed
  rules and counts, gaps/repeated clock dates, leap days, year-end,
  invalid calendar input, limits and supported booking range.
- Extend the **existing fictional no-login scheduling Playwright session**
  for both businesses: expand planner, verify dates and rule changes,
  ensure appointment records are unchanged, and run accessibility/mobile
  checks on the expanded controls.
- **Later separately reviewed PRs** may provide time and resource
  selection, existing-appointment conflict preview, exceptions/skips,
  explicit per-occurrence confirmation and transactional creation. None
  is authorized by this phase.

## Merge gate
PR #201 remains **draft and unmerged** until all five final-head GitHub
checks pass: Foundation, PostgreSQL, Browser, Release install Ubuntu and
Release install Windows. Fix failures on this same branch, rerun and
**never auto-merge**. No production behavior, database/API/migration,
MIT license, demo login, exports, deployments or other repositories
(including ForgeOS) are changed.
