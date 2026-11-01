# Plan business changes and review data impact

**Review Data Impact** explains a proposed BuildPlan against the current published configuration and authorized record metadata. It does not run migrations, publish configuration, save drafts, copy records or authorize a later operation. The existing strict validators, shared `configurationImpact` rule and PostgreSQL publication guards remain authoritative.

## Beginner workflow

Run `npm ci` and `npm run dev`, then open http://127.0.0.1:3000 → **Build My Business System**. Use fictional information only.

1. Open **Customize**, change a business label or add an optional customer field. You can also select a reviewed Gallery starter or use the existing template-update review. Save a draft if you want to retain the choices before planning; this is optional and separate.
2. Choose **Review Data Impact**. The report compares your current editor choices with the published configuration, not merely with the starter's previous edition. It identifies compatible presentation/module changes, migration-review requirements and blocked industry/project changes.
3. Read the affected entity cards. Active and archived counts include records in disabled modules. The planner reads record identity/revision/archive metadata to check freshness, but no customer names, contact values, job notes or other operational values. Record IDs are never returned in the review.
4. Inspect each proposed replacement, affected entity, reason and next step. Field definitions show type, requiredness, options and reference target where relevant. Core types/required fields/reference targets are locked by the existing BuildPlan validator; unsupported imports refuse before a report is created. Supported optional-field changes are still blocked on populated entities, including archived records. An additive field has no exemption.
5. **Preview Changes Without Applying** checks freshness again and opens the actual shared Engine workspace in a separate tab. It starts empty, with no copied business records or saved plans, under the existing three-preview session quota. You can try fictional records there. An empty preview is not proof that existing records can be migrated.
6. **Export Migration Planning Report** rechecks authorization/freshness and downloads readable, indented data-only JSON. It contains current/proposed validated configurations, classifications, reasons, warnings and next steps. It omits record counts, row values/IDs, actors, organization IDs, operational histories and freshness fingerprints. Configuration names/labels are user-entered text: inspect them before sharing. No SQL, credential field, migration command or executable content is generated. The report cannot be imported as a BuildPlan or used as publication authorization.
7. **Keep editing my plan** returns to the unchanged editor and original draft intent. Compatible choices still need the existing separate save, current configuration review, owner/admin permission and explicit publication confirmation. Migration-review or identity blockers cannot be overridden here. Revise the proposal or retain the current schema.

For a concrete demonstration, add **Planning access notes** to Customers in the seeded property business. Its existing fictional customer makes the field change require migration review. Preview it in a fresh empty workspace, export the report, and return without applying anything. Alternatively, disable **Inventory & stock**: the report explains that source records, stock balances/movements and history remain retained and the module is hidden, not deleted. Disabling a scheduling/workforce module does not cancel bookings or remove staff reservations.

## Categories use the existing rules

| Category | Meaning and next step |
| --- | --- |
| Compatible under existing rules | The strict readers and shared impact rule accept this observed proposal. Labels, navigation, safe branding, valid module selections and supported field changes on observed empty entities can qualify. This is not automatic safety, migration approval or a promise of later publication. Save/review/confirm through existing controls; database checks run again. |
| Requires additional migration review | `configurationImpact` identifies a schema change on an entity containing any records, including archived/disabled records. Keep its schema or revise the proposal. A future, separately authorized migration implementation is required. |
| Blocked or unsupported | Industry/project identity changes cannot replace this workspace. Invalid schemas, mismatched v1/v2 pairings, changed core contracts, unavailable module versions/dependencies and missing installed storage support refuse validation. Unsupported plans receive an explanation, not an executable plan or preview. |

Current JSONB storage does not make business-schema changes harmless. Requiredness, types, references, estimate snapshots, stock history and scheduling constraints remain protected. Config rollback appends a retained revision and does not reverse records; a rollback that would change a now-populated field schema still refuses. The report shows reference contracts and explains retention, without exporting linked records or their identifiers.

Branding stays in configuration and changes no operational data. Legacy unbranded BuildPlan/configuration/package v1 and branded v2 remain unchanged, as do local template-history pins and the distinction between saved comparison baselines and unverified package hints. This phase introduces only a separate planning-report format, not a new BuildPlan/package schema.

## Authorized observation and freshness

`Engine.reviewBuildPlanImpact` uses the existing transaction-local principal/role helpers and forced RLS. Owner/admin authorization is required both before the observation and in its SQL statement. There is no direct metadata endpoint for persistent businesses. The existing isolated demo route adds one strict, same-origin `review-impact` command returning only the report. It does not return a workspace export or accept a caller-supplied identity.

One parameterized SQL statement captures the latest scoped configuration, current caller role, source-record entity/ID/revision/archive flags, and saved draft ID/revision/base-version tuples in a coherent PostgreSQL statement snapshot. Source values, audit contents and protected projection histories are not selected. SHA-256 over canonical metadata, organization and actor produces a transient state fingerprint; another digest binds the validated proposal. The raw tuples never leave the Engine. Existing immutable/revision guards and source/projection transactions make those versions representative of supported writes. No private epoch grants, tables, migration or runtime privileges are added. Publication's existing storage-version checks are shared with the planner.

Planning requires **READ COMMITTED** observations. Retained repeatable-read/serializable snapshots refuse freshness claims rather than reusing old state. Reports are point-in-time observations, not database locks or leases. Changes committed after an observation can make it stale immediately; the report never authorizes a subsequent write. Existing publication transactions independently recheck current roles, configuration/draft revisions and populated-schema constraints.

The UI rechecks every 15 seconds while visible, when the window regains focus, and before preview/export. It also offers **Verify Review Is Current**. A changed configuration, any scoped source-record revision/archive state, saved draft revision or caller role invalidates the fingerprint. Even an edit that preserves record counts is detected. Another organization's changes do not invalidate it. All scoped draft changes conservatively invalidate reviews, including another draft in the same organization. Failed writes and exact retries that change no state do not invalidate them.

Stale or unverifiable reviews disable preview/export. **Refresh Data Impact** explicitly captures a new observation without changing proposed choices. If a bound saved draft has a newer revision, refresh refuses: return and reopen the latest saved revision rather than silently following it. Reloading/navigation retains existing saved drafts but loses unsaved browser state under the existing Studio rules; save/export your BuildPlan before leaving. A report does not renew Studio's saved publication revision automatically.

## Trust and privacy limits

Fingerprints are freshness comparisons, not signed receipts, independently monotonic witnesses, administrator-compromise protection or durable migration approvals. A trusted administrator could alter underlying history; restoring an older database can roll back state. Every existing native restore/recovery activation blocker remains in place. No report can unblock a restored database or create a public persistent-business route.

Owners/admins may already read operational records through existing authorized interfaces, but the planner deliberately does not select those values. On-screen counts and warnings reveal authorized population metadata; exported warnings may reveal that an entity is populated, while numeric counts and operational payloads are omitted. Previously downloaded files cannot be revoked. No private/customer information should be placed in configuration labels. Reports are not signed, imported, executed or treated as trusted evidence by LMS.

## Requirements for a future executor

A separate phase must specify supported old/new schemas and deterministic transformations, scoped identity/session/recent-auth controls, explicit owner approval, stable review fencing at execution time, backups with verified restore, rehearsal on independent fictional copies, relationship/invariant checks, concurrent-write exclusion, interruption/idempotency behavior, secret-free audits and failure rollback. It must preserve pricing snapshots, immutable compensating stock history, employee allocations and UTC scheduling semantics. Unsupported transforms must refuse. Recovery activation and production acceptance remain separate gates; this planning report supplies neither.

The next bounded step, [Rehearse Business Changes](fictional-rehearsal.md), uses generated fixtures in an independent temporary Engine workspace. It adds explicit check outcomes and readiness statuses, not native transformation of existing records, verified business backups or execution authority.

[Actual verification and screenshots](migration-planning-verification.md) · [Studio](buildplan-studio.md) · [Template history](template-history.md) · [Security](../SECURITY.md) · [Roadmap](../ROADMAP.md).
