# Private logo association verification

Verification is in progress on the PR branch. No native restore, CI success or production acceptance is claimed until observed results below are filled in.

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

Pending final local and GitHub CI runs. Screenshots will be added after the responsive harness is executed and visually inspected.
