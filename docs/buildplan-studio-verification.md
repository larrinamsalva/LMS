# BuildPlan Studio verification

PR #14 implements the guided builder as configuration over the existing Engine. All three jobs on implementation commit `0b144e8` passed in [CI run 41269011536](https://github.com/larrinamsalva/LMS/actions/runs/41269011536); the final evidence was also recorded in PR #14.

- Local `npm run check`: **92 tests in 21 files passed**, including 11 new unit/embedded/demo cases, TypeScript, production build and **188 dependency license declarations**.
- All **33 local browser tests passed (2.6 minutes)** on Chromium **153.0.8010.0**, including the new builder workflows on desktop/tablet/phone, axe light/dark checks, real generated forms, import/export and retained publication/rollback. Three actual application screenshots were captured and visually inspected.
- Native PostgreSQL CI: **122 tests in 11 files passed**, including seven new BuildPlan cases and all 115 prior cases, on PostgreSQL **16.15** with actual **16.15 dump/restore**. Startup and raw draft writes remained activation-blocked after restoration. PostgreSQL is not installed locally.
- Standard GitHub Chromium CI: **33 browser tests passed**, together with all 92 foundation tests, type checking, build and license checks. These are the PR #14 implementation results; later gallery results are recorded separately.

## Coverage

Templates, dependency closure through the manifest and required references, strict schema/version/code/key/size refusal, safe optional fields, shared migration impact rules, append-only draft revisions, original retry receipts, role/organization isolation, explicit reviewed publication, stale versions, controlled rollback and preview quota/isolation/expiry are covered in unit and embedded SQL tests.

Native cases add competing save/raw writers, publication/edit and record-creation races, frozen repeatable-read drafts, quotas, source-row immutability versus host sandbox retirement, stopped migration 10→11, restart and real backup/restore retaining draft/configuration/audit history with recovery activation/raw writes blocked.

Browser cases exercise dependency-aware cleaning choices, terminology/navigation/custom fields, a real generated workspace writing a client through the shared form, validated export/reopen/import, unsafe-version rejection, property publication/migration warning/rollback/stale review, and a Custom Business writing a general work item. Desktop/tablet/phone and light/dark axe/overflow checks remain enabled together with every existing pricing, inventory, scheduling, workforce and HTTP regression case.

## Limits

Only reviewed template version 1/Engine API 1/BuildPlan version 1 combinations; four optional operational fields; five draft IDs × twenty revisions; three fresh temporary previews/session; existing demo quotas remain. No real-business routes or services, no migration execution, no data import/gallery/marketplace/AI generator/deployment. Import validates configuration; it is not a backup/restore protocol. Screenshots/emulation/axe do not certify every physical device or assistive technology. See [workflow and trust boundaries](buildplan-studio.md).
