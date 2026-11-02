# Durable private logo verification

This PR is host-only library/test tooling. No persistent public upload or native-storage UI is installed. The presentation fixture uses synthetic data and mocked browser transport; native PostgreSQL independently verifies actual storage and restoration.

## Coverage and commands

- Original sanitizer, exact PNG metadata/digest/profile, shared process-wide capacity, input/output/pixel/animation/security regressions.
- Actual SQL migration, forced RLS, narrow byte access, immutable identity/receipts/history, actor/instance guards, missing/stale commands, repeat/replacement/cleanup transitions and continued activation refusal.
- Real PostgreSQL: separate Node processes/reconnection, current roles/revocation, unknown/foreign IDs, exact retries, concurrent replacements/creates, quota exhaustion with retained bytes and cleanup headroom, corrupt content, unchanged business snapshots and compatible portable exports.
- Existing native backup coordinator: completed fictional restore, byte/history/ACL comparison and restored-runtime/asset-operation refusal. No failed/partial restore is reported as success.
- All previous credential/recovery/lineage/checkpoint, scheduling/workforce/pricing/inventory, branding/Studio/Gallery/template/package/migration/copy regressions remain required.
- Browser: existing public demo remains temporary and isolated; an additional no-session test-only renderer checks readable themes, responsive layouts, keyboard controls and missing-image fallback.

```sh
npm ci
npm run check
npm run test:postgres
npm run test:e2e
```

Network tests require the documented disposable fictional cluster and never silently skip. CI uses PostgreSQL and native clients 16.15. The unchanged screenshot artifact accepts only synthetic `custom-logo-*.png` files.

## Actual results

Verification is in progress. Local `npm run check` passed: 242 tests in 39 files, type checks, 188 dependency license declarations and production build. Initial focused SQL/vault checks also passed 16 tests. The focused visual fixture passed all 3 viewport cases (29.0 seconds), including Axe and fallback checks. Full real PostgreSQL and browser regression evidence will be recorded before review. No native restore or real-user/session acceptance is claimed before it is actually verified.

## Limits

Only the trusted-host Principal boundary is supported. Per-request identity/session resolution remains the existing host adapter's responsibility; cached/browser-asserted principals are not accepted identity evidence. New tests demonstrate revoked business memberships; existing credential/session revocation regressions remain required. SQL storage checks do not replace native sanitization or protect against a malicious host/superuser. Self-stored SHA-256 is not independent authenticity, latest-version proof or encrypted custody. Bytes are retained in every lifecycle state; physical cleanup and portable published branding are intentionally unsupported.

[Workflow, exact contract and trust model](durable-private-logos.md)


## Presentation fixture screenshots

These synthetic examples use the shared branding components and a browser-test transport. They do not show a publicly accessible durable database UI. Native persistence/restoration is a separate test boundary.

![Desktop private inspection fixture](screenshots/durable-logo-inspection-desktop.png)

![Phone dark private inspection fixture](screenshots/durable-logo-inspection-phone-dark.png)
