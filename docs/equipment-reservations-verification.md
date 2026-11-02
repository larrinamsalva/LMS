# Equipment reservation verification

The final head and complete GitHub CI evidence are recorded in [PR #33](https://github.com/larrinamsalva/LMS/pull/33). Success is reported only for observed completed runs; an embedded PostgreSQL run does not demonstrate native restoration.

The first implementation (`80f0da59ee6440e5301824736937d47f98f7b456`) passed local `npm run check`: **369 tests / 55 files**, typecheck, optimized build and **188 dependency license declarations**. [CI run 41509346201](https://github.com/larrinamsalva/LMS/actions/runs/41509346201) independently passed that foundation suite. Its 24 native equipment cases passed, including the separate Node process and same-schema quarantined backup/restore. The complete native suite initially refused a lock-order regression in the existing raw workforce time-off/calendar race (259 passed, 1 failed). Migration 018 now orders every record and configuration writer by organization before existing epoch guards. The strict workforce assertion was retained. The original immutable-identity/RLS error behavior is preserved; the corrected focused engine/reservation/HTTP suite passed **14 tests / 3 files** and the optimized build passed. Final readiness requires the complete final-head CI suite.

The expanded existing workforce journey uses the same bounded fictional sessions for both industries and desktop/tablet/phone. It explicitly enables the optional capability, reviews a physical mapping by keyboard, reserves through Schedule, checks a real overlap refusal, reports a problem, confirms the appointment is unchanged and checks period warnings. Axe WCAG A/AA checks and horizontal-overflow checks run in both themes. The initial browser selector omitted the sidebar record count; it was corrected without changing authorization or UI controls. The corrected focused journey passed **3/3** (desktop 33.4s, tablet 36.6s, phone 31.8s; 1.8m total), including cleaning/light and property/dark. The full 78-case browser regression must additionally pass at the final head; the PR pins that result.

Reproduction:

- `npm run check`
- `npm run test:postgres` with the existing disposable local `lms_test_*` PostgreSQL 16 setup; this suite never silently skips without its explicit test credentials.
- `npm run test:e2e` after `npm run build`; three independent bounded demo runtimes, unchanged production quotas.

New focused coverage includes v1/v2 package round trips, dependency rejection, exact revisions/receipts, overlap shapes and adjacency, safety/checkout/inspection refusal, cancellation/archive/restore, disabled enrollment, time-zone/DST handling, session expiry/origin protection, current role revocation, scoped references, raw write denial, injected transactional failures and immutable source/history preservation. The native backup compares mappings, active/cancelled reservation snapshots, customer/work links, custody, actual maintenance events, configuration revisions, audits and receipts after reconnection, a separate process and a separate quarantined restore. Both restored runtime connection and recovery activation remain refused. Migrations 001–017 are checked byte-identical to merged PR #32.

These checks do not certify real-user authentication/transport, future physical collection, multiple-resource scheduling, schema transformations or production recovery. See [workflow and remaining boundaries](equipment-reservations.md).

## Actual fictional workspace captures

| Viewport | Cleaning / light | Property / dark |
| --- | --- | --- |
| Desktop equipment | [Inspect](screenshots/equipment-reservations/desktop-fictional-reservation-equipment-cleaning.png) | [Inspect](screenshots/equipment-reservations/desktop-fictional-reservation-equipment-property.png) |
| Tablet equipment | [Inspect](screenshots/equipment-reservations/tablet-fictional-reservation-equipment-cleaning.png) | [Inspect](screenshots/equipment-reservations/tablet-fictional-reservation-equipment-property.png) |
| Phone equipment | [Inspect](screenshots/equipment-reservations/phone-fictional-reservation-equipment-cleaning.png) | [Inspect](screenshots/equipment-reservations/phone-fictional-reservation-equipment-property.png) |
| Desktop shared schedule | [Inspect](screenshots/equipment-reservations/desktop-fictional-reservation-schedule-cleaning.png) | [Inspect](screenshots/equipment-reservations/desktop-fictional-reservation-schedule-property.png) |

Phone captures use a viewport around the equipment calendar; desktop/tablet captures show the full page. These are actual Engine-backed screenshots, not mockups. All three viewports' schedule captures also remain in the CI fictional-screen artifact under its existing 30-day retention. No private keys, dumps or live business records are uploaded.
