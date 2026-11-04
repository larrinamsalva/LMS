# Coordinated scheduling verification and mobile form repair

[PR #34](https://github.com/larrinamsalva/LMS/pull/34) records the exact final submitted commit, complete foundation/native PostgreSQL/browser counts, and links to its passing GitHub Actions jobs. Earlier failures are not represented as successful runs.

## Reproduced mobile failure

At `bbef23c95cbb2d490f222c0cd291705c295e9ef9`, [run 41540034382](https://github.com/larrinamsalva/LMS/actions/runs/41540034382) passed **382 foundation tests / 57 files** and **268 native PostgreSQL tests / 18 files**; browser checks finished **77 passed, 1 failed**. The phone workforce journey could not click **Save record**: the resource review/form subtree intercepted the pointer. Its normal click and 15-second timeout were retained.

The same product commit was reproduced locally with read-only geometry/trace diagnostics. The ordinary phone workflow first exposed an obstructed confirmation tap; a separate diagnostic used normal keyboard confirmation to reach Save, retaining Save's normal pointer click, and reproduced its interception. Diagnostic hooks/keyboard substitution were discarded before the committed regression test. No `force`, evaluated click, skip or increased timeout is part of the repair.

Measured on a 390 × 664 emulated phone: the review section was **320 px** wide, but its implicit grid track was **510 px**, forced by the long confirmation label's inherited `white-space: nowrap`. The document expanded to **545 px** while `documentElement.clientWidth` remained **390 px**. The visual viewport panned during focus/scroll. Section/footer positions were static, with a **25 px** normal-flow gap; a new overlay or z-index layer was not the cause. Trace pointer interception and viewport measurements support correcting intrinsic overflow/panning, rather than raising the footer above other content.

The stricter regression also exposed tablet field-grid overflow: long resource options forced a 570 px two-column field grid inside a 491 px form, expanding an 810 px document to 838 px. Appointment-only field children now have a zero minimum width; the same tablet workflow measures 810 / 810 px after the repair.

The application fix adds scoped classes to the existing appointment fields and review section. Its grid can shrink to the form column; text and confirmation labels wrap; children stay contained; the checkbox has a fixed, unpadded size inside a usable label target. The footer retains normal document flow and its existing spacing. Theme variables, confirmation requirements, allocation logic, roles, receipts, SQL and recovery controls are unchanged.

| Local phone measurement | Before | After, both themes |
| --- | --- | --- |
| Document / actual layout viewport | 545 / 390 px | 390 / 390 px |
| Review container / grid track | 320 / 510 px | 320 / 320 px |
| Confirmation whitespace | nowrap | normal |
| Review-to-footer gap | 25 px | 25 px |
| Save pointer actionability | intercepted | normal trial and real clicks pass |

[Layout-only evidence](evidence/mobile-appointment-layout.json) contains no credentials, cookies, operational records or customer values. Local diagnosis uses test-only Chromium 153; final GitHub CI runs the repository's pinned Playwright browser. Raw traces are not committed because they can contain temporary session/network details.

## Regression and completed focused run

The existing shared Save helper now checks actual layout-viewport width (mobile overflow can enlarge `innerWidth`), child containment, footer separation, a normal Playwright trial click and the real center hit target, followed by the unchanged normal click. It attaches geometry and phone screenshots. All workflow actions after the helper remain byte-identical to the reported failing commit: the original checkbox interaction, coordinated allocations, conflicts, rescheduling, archive/restoration and both industries remain tested.

The final repaired journey passed **3/3**: desktop **32.8 s**, tablet **39.1 s**, phone **33.9 s** (**110.2 s** including setup), with no skipped/flaky cases. Each viewport covers cleaning/light and property/dark. A clean local `npm run check` passed **382 tests / 57 files**, typechecking, **188 dependency license declarations** and the production build. Complete final-head GitHub foundation, native PostgreSQL and browser results are recorded in the PR after their completed logs are inspected. Existing Axe WCAG A/AA, keyboard mapping interactions, responsive checks and all security/business regression suites are retained.

Commands: `npm run check`; `npm run test:postgres` in the existing disposable local PostgreSQL 16 GitHub CI setup; `npm run test:e2e`; focused `playwright test tests/e2e/workforce.spec.ts --project=phone` and the desktop/tablet projects. No session quotas, timeouts or database assertions are relaxed.

## Actual mobile evidence

- [Before: overflow and unreachable interaction](screenshots/mobile-appointment-repair/before-light.png)
- [After: cleaning / light](screenshots/mobile-appointment-repair/after-light.png)
- [After: property / dark](screenshots/mobile-appointment-repair/after-dark.png)

These are unedited Engine-backed fictional-workspace captures. See [the scheduling contract](coordinated-scheduling.md) for the one-primary/one-equipment bound, host-only persistent transport, separate custody and continued restore activation blocking.
