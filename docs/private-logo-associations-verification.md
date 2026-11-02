# Private logo association verification

Verified for trusted fictional PostgreSQL workspaces only. The implementation and regression results below do not establish real-user authentication, persistent public transport, production media custody or recovery activation acceptance.

## Reproduce

Use the existing [disposable PostgreSQL 16 lab](postgres-setup.md#run-the-network-tests); never point tests at a shared or production cluster. PostgreSQL tests require the explicit `LMS_TEST_ADMIN_URL` and do not silently skip. Only databases randomly created by test tooling are dropped during cleanup; the association library never deletes assets or databases.

```sh
npm ci
npm run check
npm run test:postgres
npm run test:e2e
```

The independent-process probe is test tooling using reviewed synthetic principals and images. It is never mounted as a web handler and is not evidence of real-user authentication acceptance.

## Coverage boundaries

- Strict contract/version/layout tests; no local IDs in portable configurations.
- Real SQL under the original application role/context: explicit selection/binding, replacement, receipts, audit privacy, fallback, historical review, publication and rollback, RLS/permissions and continued activation refusal.
- Native PostgreSQL: independent application processes, reconnect, concurrent binds, stale reviews, repeatable-read fencing, member revocation during native decode, failure rollback, retained references, blocked/retired/missing/damaged images, bounded history and reserved fallback.
- Native backup/restore: exact association/receipt/history/PNG preservation, private integrity comparison, unchanged source rows and continued quarantined runtime refusal.
- Existing regression suites retain legacy JSON/ZIP/companion byte compatibility, provenance, recovery, credential lineage/checkpoints, business modules, configuration planning and native readiness.
- Responsive browser presentation uses synthetic response fixtures and a browser-only image transport. Actual persistent HTTP/session acceptance is **not supplied**. The real public app must reject these unknown private-image requests.

## Observed results

The baseline protocol/native/browser evidence is commit [`6df3ae89ecf724fa5fb4a647cc184a4ce8b4d3c5`](https://github.com/larrinamsalva/LMS/commit/6df3ae89ecf724fa5fb4a647cc184a4ce8b4d3c5). [GitHub quality run 41377441581](https://github.com/larrinamsalva/LMS/actions/runs/41377441581) completed successfully in all three jobs. The final validation/retention hardening described below adds two foundation regressions and one native concurrency regression; inspect the PR checks for subsequent exact-head CI results.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Foundation | **252 tests / 41 files passed**, 53.32 seconds; TypeScript, 188 dependency license declarations and production build passed | [Foundation job](https://github.com/larrinamsalva/LMS/actions/runs/41377441581/job/125060661684) |
| Native PostgreSQL | **203 tests / 15 files passed**, 122.01 seconds; PostgreSQL / pg_dump 16.15 | [PostgreSQL job](https://github.com/larrinamsalva/LMS/actions/runs/41377441581/job/125060661453) |
| Association-native cases | **16 tests passed**, 6.886 seconds, including actual independent-process retrieval, both publication races, failed transaction rollback and native quarantined restore | Same PostgreSQL job; `tests/postgres/logo-associations.test.ts` |
| Browser | **75 passed**, 7.2 minutes, desktop/tablet/phone; new harness checked light/dark Axe WCAG 2 A/AA and 2.1 AA tags with no detected violations | [Browser job](https://github.com/larrinamsalva/LMS/actions/runs/41377441581/job/125060661799) |
| Local foundation | `npm run check` passed: 252 / 41, 121.62 seconds; typecheck, 188 licenses and build passed. Follow-up typecheck passed after final test/harness edits | Local execution, Node 24.22.1 |
| Local browser | Full run **75 expected / 75 total**, zero unexpected, flaky or skipped; focused initial new-harness run **3 passed** / 37.3 seconds | Local Playwright report and inspected screenshots |

Native PostgreSQL was executed in the disposable GitHub service, not invented from embedded SQL tests. The successful restore test closes all source hosts, uses the existing native utility and allowlisted empty restore destination, compares private HMAC inventory plus exact association/receipt/PNG checks, and confirms the source is unchanged. Both the ordinary adapter and guarded association SQL refuse the restored quarantined copy. A successful same-schema restore does not prove migration transformation safety or authorize recovery activation.

The native suite also verifies current owner/admin authority; no raw image-column SELECT or table DML; forced RLS and foreign-scope refusal; post-decode membership revocation; stale configuration/selection/repeatable-read rejection; exact versus conflicting retries; 128 retained associations with one reserved fallback; referenced-asset retirement refusal; blocked/retired/missing/damaged images; and preservation of records, configuration history, receipts and audit history. Missing asset lookups retain the original access-denied semantics rather than revealing existence.

SQL migrations 1–13, root MIT/upstream notices, portable configuration/package/attestation/companion contracts, public demo database/vault and installed HTTP routes remain unchanged. The production build exposes only the existing demo routes. Existing security/recovery/lineage/checkpoint, pricing, inventory, scheduling, workforce, branding, provenance, Studio/Gallery/history/planning/native-readiness suites are included above.

## Final atomic validation hardening

Final review added the existing complete `validateConfig` reader to the commit transaction, after the SQL operation acquires the organization/publication lock and before `Engine.asUser` commits. Review data alone does not prove a valid stored configuration. If the reader refuses, the whole transaction rolls back, including the association, cursor, receipt and audit event; no configuration is rewritten. SQL branding/storage checks remain defense in depth, not a duplicate complete module validator.

The added real-SQL host-adapter regression deliberately stores an unsupported module version in a separate synthetic embedded organization, supplies structurally valid review data directly, verifies the exact existing module-version validation error and confirms no association/receipt/cursor/audit persists. This exercises the rollback boundary rather than accepting any generic failure.

After this change, local `npm run check` passed **253 tests / 41 files**, **119.16 seconds**, TypeScript, **188 licenses** and the production build. The final foundation count increases to 254 with the additional empty-cursor retirement regression. A subsequent retention fence adds a native concurrency case, bringing the current native suite to 204 cases (17 association cases); browser remains 75 cases. Final-head CI must pass before review; [PR #27 checks](https://github.com/larrinamsalva/LMS/pull/27/checks) identify the subsequent exact commit/run, rather than treating the earlier baseline as proof of an untested revision.

The final retention fence initializes an organization cursor before a first binding and locks it before retirement. Its native regression starts an old repeatable-read snapshot, commits the first binding elsewhere, then attempts unselect/retire; retirement must raise serialization refusal and roll back the pending unselect/history/receipts. The association remains active and retained. Missing cursor evidence refuses instead of being auto-created. After these SQL changes, focused actual-SQL/host-adapter/contract tests passed **14 / 3 files** and TypeScript passed locally. Final exact-head PostgreSQL, foundation and browser outcomes are recorded in PR checks; the earlier baseline totals are not substituted for that final verification.

The compatibility regression additionally verifies that a live zero cursor cannot be deleted independently, a zero cursor can disappear only during the existing trusted-host empty parent-workspace retirement, and an organization with retained associations cannot be deleted. Native reference/asset/history foreign keys and the explicit nonzero-cursor guard stay restrictive; no image purging or storage cleanup method is added. After this compatibility correction, focused SQL/host-adapter/contract tests passed **15 / 3 files**, with TypeScript passing locally.

## Screenshots and inspection workflow

All images below contain **synthetic test-only pixels and response fixtures**. They demonstrate the existing shared branding renderer, readable themes, contained layouts and safe fallback. They do **not** show authenticated PostgreSQL HTTP delivery or grant publication authority. Native behavior is established independently by the PostgreSQL evidence above.

| Screenshot | What to inspect |
| --- | --- |
| [Desktop light](screenshots/private-logo-associations/desktop-light.png) | Current configuration and association revisions; explicit image association |
| [Desktop dark](screenshots/private-logo-associations/desktop-dark.png) | Reviewed contrast and readable controls |
| [Desktop stale configuration](screenshots/private-logo-associations/desktop-stale.png) | Built-in fallback after a changed configuration response |
| [Tablet dark](screenshots/private-logo-associations/tablet-dark.png) | Responsive contained image and wrapping controls |
| [Phone light](screenshots/private-logo-associations/phone-light.png) | Narrow identity layout and keyboard-accessible controls |
| [Phone dark](screenshots/private-logo-associations/phone-dark.png) | Readable compact dark identity |
| [Phone stale configuration](screenshots/private-logo-associations/phone-stale.png) | Built-in mark with explicit new-review instruction |

The browser harness also switches square/rectangle inspection via keyboard, shows explicit built-in responses, tests a broken-image fallback and verifies that the real app rejects the fixture asset request with 401. Its controls switch response fixtures; they do not mutate an organization. The native workflow separately stores/selects, reviews, explicitly binds, restarts, reads, replaces, reverts, reviews historical restoration and tests backup/restore.

The CI `fictional-logo-previews` artifact ([artifact 13112391230](https://github.com/larrinamsalva/LMS/actions/runs/41377441581/artifacts/13112391230), 3,757,365 bytes, 30-day retention) contains synthetic screenshots only; selected copies are retained in this repository.

## Remaining limits

- Host-only library and test-tooling integration; no durable public image endpoint or interactive persistent-transport acceptance. Hosts must resolve a current verified local principal on every operation and clear/fall back after failures.
- Database-local history/digests do not protect against a compromised superuser/host, independently authenticate a publisher or establish monotonic freshness.
- No physical image deletion, automatic cleanup or quota refunds. Historical references block retirement; exhausted labs require future reviewed retention work.
- No image-bearing portable branding protocol. Existing blueprint signatures do not authenticate these installation-local images or separate companions.
- Restored copies stay blocked; no activation, schema executor, production deployment or real-customer acceptance is added.
