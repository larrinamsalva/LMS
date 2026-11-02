# Branded bundle verification

This phase is fictional, data-only portability. It adds no persistent HTTP asset route, durable transfer/mapping, image-bearing publisher signature, migration executor or activation path.

## Reproduce

```sh
npm ci
npm run check
npm run test:postgres
npm run test:e2e
```

Use the existing [disposable PostgreSQL test setup](postgres-setup.md#run-the-network-tests). Native tests require explicit fictional test credentials and never silently skip. No production connection, real-customer record transfer or ForgeOS modification is authorized.

## Observed results so far

- Local protocol tests: **31 passed** (exact bytes/version compatibility, detached test-key signatures, hashes/layouts, malformed manifests, nested archives, module versions and bounds).
- Local protocol plus real demo-route/vault integration: **35 passed / 2 files**, including explicit re-sanitization, staging versus selection, changed IDs, cross-scope refusal, revocation/expiry, exact/conflicting retries, budget exhaustion and unchanged source/recipient Engine snapshots.
- Local full `npm run check`: **289 passed / 43 files**, 72.97 seconds, TypeScript, 188 dependency license declarations and production build passed before final presentation-copy changes.
- Local full two-session workflow: **3 passed / 1.2 minutes**, desktop 25.1 seconds, tablet 22.8 seconds, phone 21.6 seconds. This includes the original standalone package/companion assertions plus bundle export/import, no raw image preview, independent acceptance/staging/selection, real Engine preview isolation, unchanged records/drafts/configuration, keyboard and light/dark Axe checks.
- Full browser and native PostgreSQL regressions remain pending. A native restore result is not inferred from client/embedded tests.

The browser workflow extends the existing two-session blueprint round trip instead of raising the public 24-session/three-preview caps. It must keep the original standalone companion, signed/unsigned package, saved-draft, preview isolation and publication-blocker assertions. New screenshots use synthetic pixels only; no private customer image or signing key is committed.

## Required verification boundary

The bundle parser checks integrity and compatibility; it intentionally is not a decoder or authenticator. An animation-containing PNG can have correct component hashes and still be rejected by the existing server sanitizer during explicitly approved staging. Native logo associations and backups must remain unchanged when purely synthetic portable data is inspected. A separate proposed destination mapping is documentation only and is rejected by the runtime bundle schema.

[Operator workflow, exact protocol and remaining limitations](branded-blueprint-bundles.md)

## Initial synthetic workflow screenshots

These show actual public-demo interactions using fictional pixels and data. They do not show production storage, a durable transfer or a verified bundle publisher.

| Screenshot | Evidence |
| --- | --- |
| [Desktop integrity review](screenshots/branded-bundles/desktop-integrity-light.png) | Built-in samples until independent server sanitization |
| [Desktop selected image](screenshots/branded-bundles/desktop-selected-dark.png) | Explicit temporary selection after staging |
| [Tablet sanitized review](screenshots/branded-bundles/tablet-sanitized-dark.png) | Server-approved pixels, not automatically selected |
| [Phone integrity review](screenshots/branded-bundles/phone-integrity-light.png) | Narrow layout and separate approvals |
| [Phone selected image](screenshots/branded-bundles/phone-selected-dark.png) | Readable private temporary image and fallback controls |
