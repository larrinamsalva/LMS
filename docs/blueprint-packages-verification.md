# Blueprint package verification

PR #16 adds portable data-only packaging and explicit compatibility review. No applied migration, runtime permission, HTTP command, dependency, account/recovery gate or business module contract is changed.

## Automated coverage

- Unit and import-security tests cover all five Gallery starters; exact payload hashes independently checked with Node SHA-256; deterministic Unicode/custom-field round trips; BuildPlan v1 compatibility; unknown/executable/record properties; missing dependencies; unsupported versions; misleading summary content; canonical/duplicate/unsafe JSON; invalid UTF-8; traversal/duplicate/unexpected paths; truncation, oversized content, forged sizes/offsets, encrypted/compressed/ZIP64/symlink/split/comment profiles; checksum/hash mismatch after repaired ZIP CRCs; concurrent input mutation and deterministic single-byte archive corruption.
- Compatibility tests simulate a newer **reviewed** catalog revision and compare without modifying either source; unknown, different-type, same-revision and unavailable newer hints are explained. No actual newer production catalog revision or authenticated provenance is claimed.
- Embedded PostgreSQL and native PostgreSQL BuildPlan cases ensure importing/downloading/comparing makes no database changes. Explicit saves use existing roles, RLS, exact retries and immutable draft/audit history. Populated schema changes refuse publication; compatible explicit publication/rollback retains records and history. Existing recovery, credential lineage, checkpoint publication, backup/restore, scheduling, workforce, pricing, inventory and Gallery cases remain enabled.
- A new browser scenario runs in desktop, tablet and phone projects. It customizes Gallery choices, saves a draft, downloads the package, reimports into a fresh cookie session, inspects/cancels review via keyboard, rejects corrupt/oversized files, verifies light/dark WCAG axe checks and no horizontal overflow, opens the actual Engine preview and compares its full configuration, accepts unsaved choices, deterministically re-downloads, and explicitly saves a separate draft while retaining existing records/history.

## Reproduce

```sh
npm ci
npm run check
npx playwright install --with-deps chromium
npm run test:e2e
# With a disposable fictional PostgreSQL test control, following docs/postgres-setup.md:
npm run test:postgres
```

Native tests require their real local PostgreSQL URL and native dump/restore tools; they never silently skip. The existing GitHub quality workflow runs the foundation, browser and PostgreSQL suites independently. The [PR #16 checks](https://github.com/larrinamsalva/LMS/pull/16/checks) and PR description record the actual final source commit, job results, counts and any environment limitations. That evidence distinguishes local embedded PostgreSQL from network PostgreSQL.

Local Node 24.22.1 verification passed:

| Check | Actual result |
| --- | --- |
| `npm run check` | 128 tests in 24 files; TypeScript, production build and 188 dependency license declarations passed |
| Full browser suite | 39 passed (3.5 minutes), all existing 36 cases plus the package flow on three viewports |
| Final shorter review layout | Focused package flow passed on desktop, tablet and phone: 3 passed (35.4 seconds) |
| Independent ZIP inspection | `unzip -t` verified all three files with no errors |

Local browser runs used a temporary Chromium 153.0.8010.0 executable through the existing `PLAYWRIGHT_CHROMIUM_EXECUTABLE` override. Desktop and phone review captures were visually inspected. GitHub CI uses its normal Playwright Chromium and reruns the full suite on the PR source. Native PostgreSQL is unavailable in this local environment; its actual network/dump/restore evidence is recorded in the linked PR and GitHub jobs, never inferred from embedded tests. Standard ZIP inspection is not a security approval.

## Remaining limits

Checksums establish integrity relative to an untrusted manifest, never author identity or a trusted update. The strict stored-ZIP/text profile intentionally rejects ordinary re-zipped/edited archives. No external security audit, exhaustive parser proof or complete screen-reader certification is claimed. Package-only details are retained in the ZIP/current editor, while existing BuildPlan v1 drafts/JSON retain configuration choices only. Demo previews/drafts expire under unchanged quotas.

The package cannot restore a database, change permissions, activate recovery or bypass final publication guards. Production identity, transport, recovery acceptance, verified publishers, automatic merge/migration and deployment remain separately gated. MIT and ForgeOS attribution are retained; ForgeOS is unmodified.
