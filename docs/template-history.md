# Template history and safe update review

BuildPlan Studio compares your choices with locally reviewed starter editions. It never subscribes a business to a template, automatically merges replacements, migrates records or publishes an update. The no-login demonstration remains fictional, private to its temporary browser session and subject to its existing limits.

## Try the complete workflow

Run `npm ci` and `npm run dev`, then open http://127.0.0.1:3000. Choose **Explore the working demo**, select **Cleaning Company**, and open **BuildPlan Studio → Browse Business Templates**.

1. Customize **Basic Cleaning Business**. Change its name, customer terms, navigation label and optional branding. The Gallery still opens reviewed edition 1; it does not silently change an existing starter to edition 2.
2. Optionally choose **Save reviewed starting point**. This explicit operation saves the unchanged bundled starter as draft revision one while retaining your edited choices on screen. Then choose **Review & try → Save BuildPlan draft** to append your choices as revision two. This consumes two of the existing twenty revision slots, not an additional plan slot. Nothing is published. Saving customized choices as the first revision instead is supported, but does not establish an exact historical baseline.
3. Choose **Check for Template Updates**. An exact saved baseline shows its edition and whether a newer local edition exists. **Keep My Version** returns to the editor without writing anything. **Review New Version** opens the comparison.
4. Inspect old starter, your choices and new starter side by side where a saved baseline is verified. Every replacement begins unchecked. Optional suggestions mean no three-way conflict was detected; conflicts and retained customizations require your judgment. Without a verified baseline, the screen explicitly provides an informational two-way comparison.
5. Select **Shared scheduling** only. Your business name, terminology, fields, other enabled modules and branding remain unchanged. Dependencies must be retained or selected explicitly; incompatible combinations refuse. Selecting the new customer **Arrival instructions** field in an already populated workspace explains the migration blocker and prevents using that selection. Deselect it to continue.
6. **Preview selected choices** provisions the actual shared Engine workspace, using the existing three-preview session quota. Open its separate tab to try generated forms. Previewing applies nothing to the original business. The full reviewed starter can also be previewed independently, including choices requiring a future migration in the current business.
7. Confirm the selected replacements and choose **Use Reviewed Changes**. They become unsaved Studio choices attached to the current draft history. Saving appends a revision. Publication requires a separate current saved review, owner/admin permission and explicit confirmation. Existing identity, populated-schema and stale-revision checks still run in the database transaction.

For a format-transition example, import an unbranded Property Maintenance v1 package and check its available edition 2. Selecting its branding requires a separate acknowledgement of the BuildPlan/package 1 → 2 change. An imported Gallery hint, even an invented revision, remains unverified. Import and review alone change no saved draft or business record.

## Bundled editions and compatibility

| Starter | Retained editions | New reviewed choices |
| --- | --- | --- |
| Basic Cleaning Business | 1 and 2, BuildPlan/configuration 1 | Resource-only scheduling, Client/Clients labels and optional arrival notes |
| Property Maintenance | 1: BuildPlan/configuration 1; 2: BuildPlan/configuration 2, branding 1 | Fictional estimates and reviewed Forest/home branding |
| Cleaning Crew & Scheduling | 1, BuildPlan/configuration 1 | No newer edition in this phase |
| RV Park / Property Management | 1, BuildPlan/configuration 1 | No newer edition in this phase |
| General Service Business | 1, BuildPlan/configuration 1 | No newer edition in this phase |

All editions declare Engine API 1, template contract 1 and exact enabled module versions, currently `1.0.0`. A Gallery edition number is independent of the BuildPlan envelope, configuration schema, package version and a user's saved draft revision. Existing unbranded v1 and branded v2 JSON/ZIP readers remain unchanged. A retained brand is never downgraded merely because a newer starter is unbranded. Selecting a replacement that changes the paired artifact/schema version requires explicit approval.

The comparison covers module additions/removals, business name/time zone, terminology, navigation labels/order, supported optional fields and complete branding. Whole branding is selected together to preserve reviewed contrast combinations. Core field/entity contracts cannot be changed. Optional field changes are still subject to the four-field limit and populated-record migration checks. Removing modules changes visibility, retaining all data/history. The review identifies disabled modules with data. Changing the industry/project identity is refused as an update; publication into a different workspace identity remains blocked.

## Local snapshot format and trust boundary

`src/templates/history/` contains immutable, data-only JSON snapshots. `src/core/template-history.ts` pins each `template-id:edition` content digest separately in reviewed code. The strict snapshot format is:

```text
format: lms-reviewed-template
version: 1
reader: exact BuildPlan, configuration, engine API, template and module versions
entry: strict Gallery metadata plus a strictly validated BuildPlan
changes: bounded human-readable edition notes
planSha256: SHA-256 of canonical validated BuildPlan JSON
sha256: SHA-256 of canonical snapshot content excluding this sha256 property
```

Canonical JSON is the existing `blueprintJson` representation: recursively sorted object keys, retained array order and one trailing newline, encoded as UTF-8 including that newline in the hash input. Validation rejects normalized/malformed data, unknown properties, mismatched declared readers, invalid plans/dependencies, altered hashes, duplicate/missing/unpinned entries, unsupported sequences and changed industry/project identity. The full pinned registry must validate before any update can be reviewed; failure never falls back to an older edition. Callers receive detached snapshots. A failed verification remains failed for that application instance.

The supported compatibility readers are the existing strict BuildPlan 1/configuration 1 and BuildPlan 2/configuration 2/branding 1 paths. These are not generic future-version readers. Unsupported versions refuse, rather than being coerced into the current schema. Adding a new schema requires a reviewed reader and regression evidence first.

A saved baseline requires an exact reviewed plan digest in immutable draft revision one, a complete contiguous scoped revision chain through the current saved revision, and matching template/project identity. The existing owner/admin snapshot, forced RLS, append-only history and audit paths supply that evidence. A package's self-claimed Gallery ID, edition or hashes cannot establish it. A byte-identical imported starter deliberately saved as revision one may establish the same **content comparison baseline**; this does not authenticate its author, distribution channel or provenance. Missing history or a customized first save stays informational; there is no retroactive rewrite or invented ancestor.

Pinned hashes protect against accidental changes and unreviewed supplied history relative to the trusted application source. They are not publisher signatures, a monotonic latest-version witness, protection against compromised application code/database superusers, or the credential-lineage trust anchor. No imported history registry, remote feed, public submission or executable plugin is accepted. Portable packages keep their existing optional unverified Gallery hint and do not gain trusted ancestry metadata. Exported plans retain compatible configuration choices, not the private saved revision chain; after import, history verification must be established again.

## Authoring another reviewed edition

Never edit or repurpose an existing historical file or digest. Add the next contiguous edition with an unchanged template/project identity, valid reader declarations, explicit supported workflow metadata and honest limitations. Generate its canonical plan/content digests, add its separate code pin and static import, and run all history, import, Engine, PostgreSQL and browser checks. The retained edition-1 entries must continue to match their original Gallery starters. This PR deliberately keeps Gallery defaults pinned to those starters; changing defaults needs separate explicit review.

No new SQL migration, permission, endpoint or operation receipt format is introduced. Review/use are pure client-side configuration operations; explicit baseline/draft saves reuse `Engine.saveBuildPlan`, its immutable audit, retry and concurrency rules. Publication/rollback reuse their existing transaction paths. The public demo quota and all host-only credential, recovery, lineage and checkpoint activation blockers remain unchanged.

## Limits and next steps

This phase supports selective configuration replacement, not automatic merging or arbitrary schema upgrades. There is no durable portable ancestry receipt, signed template publisher, remote latest-version assurance, field migration executor, custom entity/core-contract update, or automatic refresh of deployed applications. Updating one choice does not mark an entire starter edition as adopted: subsequent checks still compare from the retained exact baseline, showing any choices you deliberately kept. Saved drafts remain bounded and temporary in the public demo; export before expiry/restart.

Studio's separate [Review Data Impact](migration-planning.md) explains a proposal against published configuration and current authorized population metadata. It can preview and export a planning report but supplies no schema-migration executor or publication bypass.

[Verification and screenshots](template-history-verification.md) · [Studio](buildplan-studio.md) · [Packages](blueprint-packages.md) · [Security](../SECURITY.md) · [Roadmap](../ROADMAP.md).
