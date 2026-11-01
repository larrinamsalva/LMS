# Native upgrade blueprints and private copy lifecycle

This Linux/WSL2 **host-only fictional lab** workflow plans a proposed configuration and tracks one quarantined native copy per private directory. It reuses [native readiness](native-upgrade-readiness.md), the existing Engine impact observer, strict v1/v2 BuildPlan readers and existing private-file/locking helpers. It contains no schema transformation, migration executor, public route, deployment or activation path.

## What the blueprint means

The private report shows validated current/proposed configurations, revision/schema versions, reviewed module dependencies, affected entities/fields, scoped relationships, protection requirements, publication versus future-transformation paths, verification checkpoints and missing prerequisites. Vocabulary is derived from actual configuration differences: optional-field addition, field-definition review, module visibility, terminology, navigation, branding, business identity, artifact version, time zone and entity contract. It is descriptive data, never executable instructions. Requests with SQL/scripts/operation commands or invalid schemas/dependencies are rejected.

Existing validators and impact categories are authoritative. Adding an optional field to an entity with active, archived or disabled records remains migration-blocked. A compatible empty-entity or presentation change still requires the separate existing explicit publication process. No blueprint action saves a draft, publishes configuration, changes records or applies the proposal to either database. A native copy retains the **current** published configuration; the proposed configuration remains design data.

Rollback Readiness distinguishes configuration rollback (append a revision without reversing records), a verified same-schema copy, and an unimplemented transformation/rollback. PR #21 removes its temporary archive after comparison: a successful lab copy is **not a retained rollback backup**, independently verified credential freshness or approval for later execution.

## Copy states

| Recorded state | Meaning | Allowed next action |
| --- | --- | --- |
| Newly prepared | Fresh authorized source/proposal observation; target identity pinned while empty | Explicitly confirmed native copy |
| Verified copied state | Actual PR #21 round-trip and all verification/cleanup checks passed | Internal quarantine checkpoint; interrupted tracking stays blocked |
| Quarantined for inspection | Copy checkpoint durably recorded; both normal runtime paths refuse activation | Read-only inspection |
| Inspection completed | Fresh source/proposal/copy comparisons and quarantine checks passed | Explicit logical retirement |
| Retired | Tracking closed; database still exists and remains quarantined | Recorded status only; physical disposition is future work |
| Blocked pending manual disposition | Failed, stale, incomplete or interrupted evidence | Keep quarantine; review privately. No resume, reset, repair or activation command |

Logical retirement never drops/deletes/overwrites a database or changes its blocker. Any future destructive lab disposition needs a separately reviewed design and explicit authorization.

## Setup and commands

Follow PR #21's [trusted lab setup](native-upgrade-readiness.md): approved maintenance superuser/database ownership, one literal loopback PostgreSQL 16 endpoint, matching encoding/collation, exact allowlisted test/restore names, source instance and **all** fictional organizations, stopped hosts and native tools. Fictional provenance must be independently established by trusted provisioning history. Names/flags/email spelling cannot classify real data. Unknown, remote, production, already-blocked source or occupied target remains unsupported.

Create a new private case directory outside git, separate from native work files and reports:

```sh
umask 077
mkdir -p "$HOME/lms-upgrades/case-01" "$HOME/lms-upgrades/work"
chmod 700 "$HOME/lms-upgrades" "$HOME/lms-upgrades/case-01" "$HOME/lms-upgrades/work"
```

Create a private `request.json` outside that case directory. Its strict fields are `actorId`, `organizationId`, `document` (an existing validated exported BuildPlan), optional `draft: {id, revision}` and optional `expected: {stateDigest, proposalDigest}` from an existing impact observation. Use only the trusted fictional source's established identities/organization and owner's/admin's membership. The actor is an existing trusted-host assertion, not proof of real-user authentication. Do not provide an operation list or executable text. Set mode `0600` on request and trust files.

Prepare is a new explicit live observation. A supplied prior `expected` observation or draft revision must match. Otherwise it binds the exact observed revisions before returning; later steps cannot follow newer drafts silently.

```sh
npm run db:upgrade-blueprint -- prepare \
  --trust "$HOME/lms-fictional-readiness/trust.json" \
  --work-directory "$HOME/lms-upgrades/work" \
  --store "$HOME/lms-upgrades/case-01" \
  --request "$HOME/lms-upgrades/request.json" \
  --report "$HOME/lms-upgrades/prepared-01.json"
```

The private report returns `rootDigest` and `headDigest`. Retain those exact receipts independently from the case directory; subsequent actions require both. Use the same source/target URLs in private `.env.postgres` and the same native trust/work paths. For each following command, include those three paths, `--root ROOT_DIGEST`, `--head LAST_ACKNOWLEDGED_HEAD` and a **new** `--report` path outside the store:

```sh
# Add the paths and root/head flags described above to each invocation.
npm run db:upgrade-blueprint -- copy --confirm "REHEARSE FICTIONAL NATIVE BACKUP"
npm run db:upgrade-blueprint -- inspect
npm run db:upgrade-blueprint -- retire --confirm "RETIRE FICTIONAL COPY TRACKING"
npm run db:upgrade-blueprint -- status
```

Commands without required flags refuse; these abbreviated lines show the action/confirmation, not complete invocations. Replace the head receipt after each acknowledged transition. `status` reads pinned private files only and explicitly claims no live readiness; it does not authorize inspection or attachment. `inspect` and `retire` require fresh native identity, source/proposal and full copied-state comparisons, current Engine owner/admin authorization and continued quarantine. They reject changed records, config/drafts/memberships, credentials, destination identity or copied control state. Revisions from a different organization cannot be adopted.

Reports are new `0600` files, synced and never overwritten. They include configurations and warnings, opaque root/head bindings and lifecycle descriptions; they exclude operational rows/values, actor/organization/database identifiers, per-table fingerprints, keys, passwords, raw errors and executable migration statements. Configuration labels are user-entered: inspect before sharing. No report is a BuildPlan import, backup, signed approval or public Studio readiness input.

## Tracking, interruption and trust limits

The private store contains `root.json`, `key.txt`, numbered immutable event files, the existing kernel `.lock`, and an intent marker while an action is incomplete. A new random commitment key makes native observations comparable across steps; it is not a credential-lineage/signing key and never enters reports. Root binds its key digest, exact native trust digest, source/destination identities, native observations and the existing impact fingerprints/proposal/draft. Report generation uses the live authorized Engine result, not imported claims.

Existing Linux private-directory checks and nonblocking `flock` serialize operations. New files use exclusive creation, file sync and directory sync. Each event binds its predecessor; the externally supplied root/head receipts must match the **entire** contiguous history. Unknown files, missing/partial/conflicting events, wrong pins, incomplete native verification or missing archive cleanup refuse. There is no older-head fallback. Earlier root/events are never rewritten. A complete failed native action records a blocked state with a new receipt; a crash/failed durable write can leave a pending marker or an unacknowledged newer event, causing refusal instead of silently replaying a copy. Do not delete markers or edit receipts to continue.

The same-schema copy runs PR #21's actual utility; uploaded/handwritten native reports cannot substitute for it. Inspection reuses the same maintenance, schema, identity, RLS, quarantine and runtime-lease guards on the existing copy. Source reads are fenced; no source DML/DDL, publication or business runtime attachment is issued. Native archives remain internal to PR #21's private work directory and are removed by its cleanup contract. Failed native cleanup blocks the lifecycle even if restoration had completed.

State is bounded to 32 events, current PR #21 row/byte limits and one case/target. A stale case requires a **new explicit case and fresh target**, never editing saved evidence. Keep every old case for inspection. Physical deletion, repair of damaged stores, unacknowledged-head acceptance, cross-cluster/major upgrades, retained backup/retention policy, deterministic transformations and rollback execution remain future work.

The host/account/server/tools, lab provenance and independently retained pins are trusted. Hash chains and private files are not signatures, real-person verification or a monotonic external witness. Rollback or compromise of the entire store/key/all receipts together is outside the guarantee. POSIX sync/locking does not certify physical power-loss behavior; SIGKILL/OS/disk failure can leave private artifacts. All credential lineage/latest-checkpoint, sole-owner/identity acceptance, production security and recovery activation gates remain unverified and unchanged. A copied database stays blocked indefinitely.

[Verification](native-upgrade-blueprints-verification.md) · [Impact planning](migration-planning.md) · [Fictional rehearsal](fictional-rehearsal.md) · [Security](../SECURITY.md).
