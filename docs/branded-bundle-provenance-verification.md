# Complete-bundle provenance verification

Scope: detached complete-bundle authentication and safe review. The real registry stays empty; positive results establish only explicitly isolated ephemeral test-key possession. No production publisher identity, signing/enrollment service or public persistent transfer is claimed.

## Reproduce

```sh
npm ci
npm run check
npm run test:postgres
npm run test:e2e
```

Use the existing disposable fictional PostgreSQL setup. Native suites never silently skip. Original SQL/checksums, portable formats, destination mapping, asset storage/association commands, demo session quotas and sanitizer remain unchanged.

## Verified implementation

Implementation commit `8f0a5c3479933d5be6b11b9fa4ab3eecdfc0f7e6` is tested in [GitHub CI run 41401032996](https://github.com/larrinamsalva/LMS/actions/runs/41401032996). All three jobs passed. The evidence/screenshot commit changes no implementation, test, protocol or registry source; final-head checks are linked from the PR.

| Check | Actual result |
| --- | --- |
| Local `npm run check` | **326 passed / 47 files**, 138.83 seconds; TypeScript, **188 dependency license declarations** and production build passed |
| GitHub foundation | **326 passed / 47 files**, 93.40 seconds; TypeScript, licenses and production build passed |
| Real PostgreSQL / native tools | **220 passed / 16 files**, 135.75 seconds; PostgreSQL/`pg_dump` **16.15** |
| Native private-transfer regression | **15 passed**, 6.382 seconds; signed-bundle inspection cannot override revoked authority or change existing private assets/publication |
| New protocol unit tests | **19 passed**, including actual Ed25519, component/image commitments, legacy versions, canonical/domain vector, tampering, retirement, unsupported modules and crypto failures |
| New signing/demonstration integration | **10 passed** (6 offline custody/output and 4 actual scoped demo/Engine tests), including stale draft/configuration publication refusal |
| Focused responsive browser | **6 passed / 2.5 minutes**, desktop/tablet/phone actual Studio and isolated positive Web Crypto harness |
| Full local browser regressions | **78 passed / 13.2 minutes**, zero unexpected/flaky/skipped results |
| Full GitHub browser regressions | **78 passed / 7.5 minutes**, all three viewports; keyboard and light/dark Axe checks |

[Foundation job](https://github.com/larrinamsalva/LMS/actions/runs/41401032996/job/125132689318) · [Native PostgreSQL job](https://github.com/larrinamsalva/LMS/actions/runs/41401032996/job/125132689615) · [Browser job](https://github.com/larrinamsalva/LMS/actions/runs/41401032996/job/125132689669).

The [fictional-logo-previews CI artifact](https://github.com/larrinamsalva/LMS/actions/runs/41401032996/artifacts/13121926025) contains synthetic screenshots only (30-day retention); no private key or production record is included.

The original Blueprint protocol/signing tests pass within the full suite. Successful real-publisher CLI signing is intentionally unavailable against the empty real registry; successful POSIX signing/file verification uses explicitly isolated ephemeral test trust. The actual CLI unsigned inspection and refusal paths are exercised without enrolling keys.

The new browser/core inspection changes no destination records. The native full suite verifies actual restarts, same-schema native backup/quarantined restore, continued activation refusal, existing private mapping/association history, credential recovery/lineage/checkpoints and all business regressions. It adds no migration and never connects production data. Protected legacy codec, Engine, migration, sanitizer, demo and storage files remain unchanged; only the shared existing Ed25519/key policy and signer custody implementations are factored for reuse.

## Screenshots

These five images were captured from the tested source and visually inspected. **Positive screenshots use an isolated ephemeral test key, never an enrolled real publisher or production app trust override.** Actual Studio screenshots accurately show its unchanged empty real registry and publisher-unverified state.

| Screenshot | Evidence |
| --- | --- |
| [Desktop complete coverage, light](screenshots/bundle-provenance/desktop-complete-test-key-light.png) | Actual browser Ed25519 verification with explicitly isolated public test trust; original component coverage and safety boundaries |
| [Tablet complete coverage, light](screenshots/bundle-provenance/tablet-complete-test-key-light.png) | Responsive labels, exact fingerprints and keyboard-opened details |
| [Phone complete coverage, dark](screenshots/bundle-provenance/phone-complete-test-key-dark.png) | High-contrast wrapped status and distinct original-versus-sanitized image scope |
| [Actual Studio unsigned, desktop](screenshots/bundle-provenance/desktop-studio-unsigned.png) | Whole/nested/unsigned distinctions in the real production-registry workflow |
| [Actual Studio unsigned, phone](screenshots/bundle-provenance/phone-studio-unsigned.png) | Narrow layout and honest empty-registry statement; no automatic image rendering or authority |

## Verification boundary

The Node/Web Crypto tests use actual Ed25519 operations, not a mocked signature success. Correctly signed hostile PNGs still fail the actual original server sanitizer. Demonstration tests use real scoped temporary Engine/vault routes; a signature alone stages/selects/publishes nothing. Native regression separately exercises an authenticated bundle against revoked PostgreSQL authority and confirms unchanged records/private assets/associations. Existing restart, quarantine restore, recovery/lineage/checkpoint and business suites remain required.

The positive browser harness intercepts a test-only page and receives only ephemeral public trust; it does not install a route, private key, app registry override or demo session. The real Studio workflow refuses that same unenrolled test publisher and can continue only through a new deliberately unsigned review. Browser screenshots establish scope/status, keyboard, responsive and light/dark presentation; they do not establish real publisher identity or production transport acceptance.

Partial-write/sync and lost-result tests are controlled fault injection, not physical power-cut or native network-failure certification. Old valid signatures are not freshness evidence. See the documented signer/application/registry compromise and retirement-distribution limitations.

[Operator workflow and exact protocol](branded-bundle-provenance.md)
