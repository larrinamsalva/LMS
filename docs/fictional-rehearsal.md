# Fictional rehearsal and upgrade readiness

**Rehearse Business Changes** extends Studio's data-impact review with fixed, reviewed fixture checks in a separate temporary Engine workspace. It creates only fictional records. It neither transforms existing business data nor supplies migration, backup, publication or production approval.

| Experience | What actually happens | What it does not prove |
| --- | --- | --- |
| Configuration preview | Opens a fresh empty Engine workspace with the proposed configuration | Compatibility of populated records or a schema transformation |
| Fictional rehearsal | Allocates another independent workspace and exercises supported Engine operations with generated test records | That the original business has a verified backup, is authorized for migration or is production-ready |
| Real migration execution | Unavailable; requires a separately reviewed and authorized executor | No successful rehearsal or report enables this operation |

## Try it locally

Run `npm ci` and `npm run dev`, open http://127.0.0.1:3000 and choose **Build My Business System**.

1. Customize the existing property or cleaning business. Add an optional customer field, adjust labels/navigation or choose safe branding. Select supported modules through existing dependency controls. Optionally save a draft.
2. Choose **Review Data Impact → Rehearse Business Changes**. Read the current/proposed configuration versions, changes, dependencies, reference contracts, backup requirements and expected validation steps. Populated and archived field blockers remain visible.
3. Choose **Run Fictional Rehearsal**. Current owner/admin permission, captured source/proposal fingerprints and the selected saved draft revision are checked before allocation. Wrong identity, invalid versions and stale evidence refuse; nothing silently follows a newer draft.
4. Inspect each check's `passed`, `failed`, `not-applicable` or `not-run` status. Descriptions state the expected check, not proof that a failed/unrun check succeeded. A disabled module is not-applicable, not a passed test. No feature is silently enabled.
5. Inspect **Upgrade Readiness Checklist**. Configuration validity, fictional completion, existing-data compatibility, business backup/restore evidence, migration authorization and production acceptance are independent statuses. Even a completed rehearsal leaves business-specific backup evidence unverified, migration authorization ungranted and production security blocked. A populated-schema blocker never becomes compatible because fictional checks passed.
6. **Download Rehearsal Report** rechecks the captured source and retained generated-workspace state before exporting indented data-only JSON. It includes validated configuration, supported expected checks/outcomes, remaining blockers and follow-ups. It excludes source/generated operational rows, row/workspace IDs, credentials, raw errors and freshness metadata. Configuration labels are user-entered text: inspect before sharing. Reports cannot be imported as executable plans or publication tokens.
7. **Open generated fictional rehearsal workspace** to inspect the actual shared forms, branding and generated records. These records were constructed independently; none came from the original workspace. Generated jobs/bookings use **November 6, 2026**, with explicit UTC appointments; choose that date in Schedule. Make up additional test records if desired. Manual edits invalidate the retained observation; download first or explicitly start another case afterward.
8. **Return to Data Impact → Keep editing my plan** preserves the editor, original draft intent and business data. Publication remains the separate existing saved-current-draft/permission/confirmation path. No rehearsal button publishes anything.

Returning between Data Impact and Rehearsal retains the case while that Studio instance remains mounted and its captured review is unchanged. Reloading/leaving Studio loses client operation memory; temporary server cases/workspaces still expire with the existing session. Export before expiry/restart. This is not durable job orchestration or backup storage.

## Supported checks and limits

| Scenario | Generated operations and evidence | Limits |
| --- | --- | --- |
| Configuration | Exact Engine configuration comparison; disabled-module CRUD refusal | Labels/navigation/branding are configuration checks, not imported code or arbitrary themes |
| Optional fields | Fixed fictional values on enabled customers, work, units and custom notes | Only existing supported optional types; disabled entities are not populated |
| Relationships | Generated customer/work link, unavailable-target rejection and referenced-customer archive refusal with unchanged snapshot/audit | No source IDs or values copied; broader cross-organization cases remain in integration/native regressions |
| Scheduling | Explicit UTC booking, exact retry and rejected exclusive-resource overlap | Single unenrolled equipment resource; employee availability, recurrence and business-specific calendars are not exercised here |
| Inventory | Two cases × 12 = 24 units; one-unit usage leaves 23; retry applied once; overdraw and movement edit refused | Whole-unit stock only; no purchasing, payments, accounting or transforms |
| Estimates | Fictional USD 1000-cent draft, retained price after a 2000-cent catalog edit, identical retry once and stale-rate rejection | Exact existing Engine arithmetic; no invoice, payment, tax compliance or customer messaging |

Fixtures use reviewed constants, fixed dates and fresh UUIDs through existing Engine methods. No generated value is read from the source business. Unknown configuration versions, core contracts or dependency combinations fail existing validators. The runner first requires owner/admin access, exact configuration revision one, no existing records (including disabled entities), no drafts and an exact proposal match. It is an internal host/test helper, not an endpoint accepting a target organization. Production native execution is not exposed.

Previews and rehearsals share **three fresh sandboxes per temporary demo session**. In-flight cases reserve before asynchronous allocation. An operation UUID binds source, proposal, expected versions and draft. Concurrent identical requests share one promise; retries reuse the retained result without reseeding or adding audit/stock operations. Different input with the same UUID refuses. Failed cases retain their failure and consume a slot, preventing failed-request loops from bypassing capacity. **Recheck Retained Rehearsal** supports exact retry after interrupted responses and always revalidates authority/state. **Start New Fictional Rehearsal** explicitly uses a new UUID/slot; it never overwrites an earlier case.

Source state is checked before starting, after fixture work and again before returning/replaying a result. Completion also captures the generated workspace's state through the existing impact observer. Changed source/proposal/draft or edited generated records refuse current evidence; source refresh and new runs are explicit. These are point-in-time checks, not a lock or transaction spanning two businesses. Supported source writes still have their normal independent transaction guards. No report authorizes later writes.

Generated organizations are private to the host until checks finish. A failed run returns static statuses, retires only its newly minted organization and exposes no partial-workspace link or raw exception. Immutable generated stock history can retire only through the existing trusted organization-retirement cascade, never by editing/deleting individual ledger rows. Reserved IDs remain tracked for expiry cleanup if retirement is unavailable. Expiry removes only server-minted session organizations; a failed retirement leaves the expired session reserved for retry rather than abandoning cleanup tracking. All storage is the private in-memory demo, never the configured native database.

## What native backup/restore tests actually cover

Existing host-only `backupDatabase` creates an exclusive private `0600` custom `pg_dump` archive, refuses overwriting it and excludes session, verification, pending membership-review and recovery-case data. Restore accepts only a separate empty fictional test/restore database, checks local targets/maintenance locking, uses `pg_restore --single-transaction --exit-on-error --no-owner`, installs durable quarantine before restore, purges transient state and retains activation blockers. Applied migration SQL/checksums are immutable. There is no public archive upload/restore endpoint.

Actual repository tests compare restored fictional records, configurations, draft revisions, audit/history, branding, scoped permissions and protected module projections. They exercise restart durability, corrupt/failed archive refusal, nonempty-target protection, migration failure/checksum rules and refused normal attachment/writes after restore. See `tests/postgres/foundation.test.ts`, `tests/postgres/buildplan.test.ts` and the scheduling/workforce/pricing/inventory/recovery suites. [Host setup and cautions](postgres-setup.md) · [Backup implementation](../src/server/postgres/backup.ts).

Those tests are bounded regression evidence for the checked source/environment. They do **not** back up this browser's temporary business, validate this proposed schema transformation, prove an organization's actual backup is fresh/complete, provide key custody or independently monotonic credential history, test every power-loss failure, or authorize restored-database activation. This UI performs no native dump/restore at all. A green CI restore test never marks the business checklist as verified. Final PR verification links distinguish actual native test results from local PGlite or fictional fixture outcomes.

## Future authorized execution

Native isolated business-schema transformation remains deferred. A future executor needs supported old/new schemas and deterministic transforms, separately verified identity/session/recent-auth permission and explicit approval, private actual backups with successful restore comparison, rehearsal on authorized copies under appropriate privacy controls, transaction-time review fencing, concurrency exclusion, interruption/idempotency design, failure rollback, audited data/relationship invariants and complete recovery acceptance. It must preserve pricing snapshots, compensating stock histories, UTC bookings, staff allocations, ownership/memberships and all existing records/revisions. No force-unblock or destructive shortcut is supplied here.

MIT licensing, ForgeOS attribution, strict v1/v2 BuildPlan/package readers, local template history, original operation receipts and all recovery/credential/checkpoint/publication protections remain. [Verification and screenshots](fictional-rehearsal-verification.md) · [Impact planning](migration-planning.md) · [Security](../SECURITY.md) · [Roadmap](../ROADMAP.md).
