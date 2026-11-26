# LMS — Road to PR #250

**One engine. Any business. Your data. Your control.**

This milestone celebrates the Living Management System's development journey and records a review of the foundation through merged PR #249. PR #250 is a documentation milestone, not a new release, production certification, or a claim that all 250 numbered pull requests were merged. The milestone is complete only after this pull request passes its own checks and is merged.

## What we have built

| Area | Delivered foundation | Boundary |
| --- | --- | --- |
| Shared engine | TypeScript configuration, generated React forms, reviewed manifests, revisions, archive/restore and rollback | No arbitrary executable configuration or automatic schema migration |
| Business workspaces | Fictional property management and cleaning workflows with customer/work links | Not complete production industry applications |
| Schedule and operations | Conflict-aware scheduling, retained booking zones, crews/availability, daily and seven-day activity review, proposed recurring visit planning | A proposed visit is not a booking; no external calendar or automatic recurrence execution |
| Services and finance | Dated area rates, exact-cent estimate drafts and optional unissued invoice drafts with retained history | No live issuance, collection, accounting, or tax certification |
| Inventory and equipment | Whole-unit stock ledger, case conversion, scanner selection, equipment inspection, custody and opt-in coordinated reservations | No automatic purchasing or unrestricted resource model |
| BuildPlan Studio | Reviewed starter gallery, generated previews, draft revisions, data-only blueprint packages, branding and template review | No executable export or automatic deployment; no real publisher authenticity claimed |
| Data and safety | Organization isolation, role checks, append-only audit, scoped exports, fictional impact review and rehearsal | Populated schema transformations and restored activation remain blocked |
| Host-only labs | PostgreSQL, identity, account lifecycle, controlled offline recovery, credential lineage/checkpoints and private asset workflows | Not mounted public production identity or business routes |
| User experience | Responsive fictional demo, light/dark themes, no mandatory account, source-install workflows | Temporary demo records and drafts are not real-business storage |

Primary references: [README](../README.md), [architecture](architecture.md), [roadmap](../ROADMAP.md), [first-release guide](first-release.md), [security policy](../SECURITY.md), [verification](verification.md).

## Recent milestone steps

- [#194](https://github.com/larrinamsalva/LMS/pull/194) and [#200](https://github.com/larrinamsalva/LMS/pull/200): seven-day Operations review and saved-count chart differences.
- [#235](https://github.com/larrinamsalva/LMS/pull/235) and [#240](https://github.com/larrinamsalva/LMS/pull/240): preview and download selected saved-date review CSV.
- [#241](https://github.com/larrinamsalva/LMS/pull/241), [#242](https://github.com/larrinamsalva/LMS/pull/242), [#243](https://github.com/larrinamsalva/LMS/pull/243): printable review, aggregate counts and status charts.
- [#244](https://github.com/larrinamsalva/LMS/pull/244)–[#249](https://github.com/larrinamsalva/LMS/pull/249): optional print-only title/notes, report layouts, orientation, paper sizes, appearance and one-click reset.

The printable review uses authorized date-level saved counts, not private raw appointment records. It retains NOT BOOKED warnings. Counts across dates are overlaps, not unique appointments; zero saved appointments is not confirmed availability. Print preferences are temporary. Actual printer output and ink savings are not certified.

## Verified starting point

PR [#249](https://github.com/larrinamsalva/LMS/pull/249) was merged at 2026-11-26 07:06:59 UTC (November 25 Pacific time). Its final head was `b2f112ab4a6f710371837a35c3919cad1d05dc92`. The [quality workflow run 605](https://github.com/larrinamsalva/LMS/actions/runs/45771371126) reported success for foundation, postgres, browser, release install Ubuntu and release install Windows. These results apply to that head only.

## Milestone readiness checklist

- [x] Confirm the prior PR is merged and its five final-head jobs passed.
- [x] Record delivered features and distinguish fictional/host-only capabilities from production readiness.
- [ ] Review this milestone document and its links.
- [ ] Verify this PR's final-head foundation, postgres, browser, Ubuntu install and Windows install checks.
- [ ] Maintainer explicitly merges PR #250 after the checks pass.

## Suggested manual acceptance walkthrough (not yet performed for this PR)

Use only made-up records in the local demo. Follow the [first-release guide](first-release.md) and [Windows installation guide](install-windows.md).

1. Open both fictional business configurations and check light/dark themes and phone layout.
2. Create fictional customer/work records and review Schedule and Daily Operations; verify that a conflicting booking is refused.
3. Review a proposed repeating visit, preview the saved-date counts, choose rows and copy/download the count CSV. Confirm the report remains NOT BOOKED.
4. Open a print report using the optional title/notes, layouts, paper sizes, orientations and appearances. Reset print settings and verify row selection is unchanged. Inspect physical or PDF output separately; do not assume the printer honors requested settings.
5. Review a fictional estimate/invoice draft, stock movement and equipment custody workflow, with retained history and no live transactions.
6. Open a BuildPlan preview, export a configuration and review the documented limitations. Do not import real customer data.

For automated local verification use the commands documented in the README: `npm run check`, `npx playwright install --with-deps chromium`, and `npm run test:e2e`. Native PostgreSQL verification requires its separate setup and test contract. This documentation-only PR has not been tested locally.

## Suggested next development priorities

1. **Consolidate and review usability:** walk through both business demos, collect mobile/accessibility and workflow feedback, and prioritize reproducible defects.
2. **Strengthen security and recovery:** independently witnessed freshness, recovery acceptance, identity/session/transport review and validated restoration. No real-data activation until separate gates are met.
3. **Advance business workflows:** richer cleaning/property operations, inventory and crew eligibility, and reviewable workflow rules in small tested changes.
4. **Review packaging and portability:** reproducible installation, bounded demo resources, explicit backup/import acceptance and eventually separately verified executable packaging.

These priorities are proposals, not promises of completed capabilities. The [public roadmap](../ROADMAP.md) remains authoritative for scope and acceptance boundaries.

## Acknowledgment

Thank you to the project maintainer, collaborators and everyone who contributes through ideas, testing, feedback, code review and repeated repair-and-verification cycles. This milestone is about making useful, understandable software while protecting business owners' control of their data.

**Celebrate the milestone, keep the quality gates, and keep building.**
