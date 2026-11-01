# Gallery verification

PR #15 adds a curated collection over the existing BuildPlan Studio. This file records observed checks; pending checks are not claimed passing.

- Local `npm run check`: **100 tests in 22 files passed**, TypeScript, production build and **188 license declarations**. The eight new cases cover collection validation, invalid/dependent/disabled claims, filtering, detached snapshots, draft storage/isolation and real previews/quotas.
- Final gallery layout: **three focused browser runs passed (28.1 seconds)** across desktop/tablet/phone, including axe light/dark, actual Engine preview record creation, unchanged-preview reuse, remix/draft/export/import/reopen and quota rejection.
- Full local responsive regression: **36 browser tests passed (2.9 minutes)**, including all 33 previous cases, with Chromium **153.0.8010.0**. The gallery layout is also checked with its focused desktop/tablet/phone scenario. Actual application screenshots are included in the workflow guide.
- Native PostgreSQL CI executes **124 enabled cases**, including two new gallery cases and all 122 previous cases; no native test is skipped. PostgreSQL is not installed locally. Final source-commit CI results and run links are recorded in the [PR #15 verification section](https://github.com/larrinamsalva/LMS/pull/15) and [Actions](https://github.com/larrinamsalva/LMS/actions). No migration or application dependency is added.

Native cases store all five blueprints as ordinary scoped drafts, retain configuration/records and existing stock, reject disabled-module writes, enforce role/organization boundaries, preserve saved snapshots against later metadata changes and refuse populated-schema publication. Existing recovery, lineage, checkpoint, inventory, pricing, scheduling, workforce and builder cases remain enabled.

Limits: bundled reviewed starters only; existing BuildPlan v1/Engine API 1/template v1 constraints and quotas; no community submissions, marketplace, external template loading, automatic updates, AI generation, deployment or production activation. Browser emulation/axe does not certify every physical device or assistive technology. See [workflow and trust boundaries](buildplan-gallery.md).
