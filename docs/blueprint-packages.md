# Blueprint packages and compatibility review

Blueprint packages keep a customized **configuration**, not an executable application or a database. Everything works locally without a cloud account. Start LMS using the [README](../README.md); use HTTPS or localhost for the browser's SHA-256 integrity checks. No additional dependency, database migration, endpoint or activation permission is introduced.

## Try a fictional cleaning blueprint

1. Choose **Build My Business System → Browse Business Templates**. Customize **Cleaning Crew & Scheduling**.
2. Change the business name, customer navigation label or a supported optional field. Review the enabled features and their dependencies.
3. Under **Keep and reuse your blueprint**, enter a blueprint name and a short, single-line description. Use fictional text; labels and descriptions must never contain secrets or private information.
4. Choose **Download Blueprint Package**. Keep `lms-blueprint.zip` outside this temporary demo. A normal ZIP viewer can inspect its three text files without running code.
5. Open a fresh Studio session and choose **Import Blueprint Package**. Nothing is uploaded: size, archive structure, UTF-8, hashes, versions, modules and dependencies are checked in your browser.
6. **Review Blueprint** shows the business type, included features/dependencies, differences from your current workspace and unsaved editor choices, migration/identity blockers and any Gallery comparison. **Cancel blueprint import** preserves your editor choices.
7. **Prepare blueprint preview** opens an empty fictional workspace through the actual shared Engine. Its configuration matches the imported BuildPlan. The existing three-preview session quota applies; unchanged successful previews are reused during the same mounted Studio visit.
8. Choose **Use as unsaved Studio choices** only when ready. This replaces the current editor choices and starts a new draft intent. It does not alter a saved draft, published configuration, customer, schedule, crew, estimate or stock movement.
9. Explicitly **Save BuildPlan draft** to retain configuration choices in this temporary workspace. Publication is separate: unchanged saved draft, current revision, explicit confirmation and final Engine/database checks are still required. Populated field-schema changes refuse; a different project identity requires a separate preview/workspace.

The same process works with Property Maintenance and the other reviewed starters. An invalid package shows an error and retains your current choices. Download again instead of repairing an untrusted archive by hand. Standard ZIP tools often add compression, attributes or timestamps outside this narrow format; recompressing a downloaded package is unsupported.

## What is retained

| Artifact | Retained content |
| --- | --- |
| Blueprint ZIP v1 | BuildPlan choices, blueprint name/description, optional Gallery ID/revision hint, compatibility information, payload hashes and setup summary |
| Existing BuildPlan v1 JSON and saved draft revisions | Configuration choices only; the envelope/schema is unchanged |
| Workspace configuration history | Existing explicit publication and rollback revisions; package import/download creates none |
| Business records and account data | Never read into or imported from a blueprint package |

Package-only metadata lives in the current editor and downloaded ZIP. It is not added to BuildPlan v1 draft storage or JSON exports. Reopening a plain saved draft/JSON starts fresh package details without a Gallery hint; reimport the ZIP to retain those details. Download before expiry/restart. Configuration labels, business names and free text are user supplied: the absence of record/account payload fields cannot prevent someone typing a secret into a label.

## Strict package v1 contract

`src/core/blueprint.ts` is the runtime schema, and `src/core/blueprint-archive.ts` implements the deliberately small ZIP profile. The complete archive is at most **98,304 bytes (96 KiB)**, including headers. It contains exactly these root paths, once each, with nonempty content:

| Path | Maximum bytes | Content |
| --- | ---: | --- |
| `manifest.json` | 8,192 | Strict package manifest |
| `buildplan.json` | 49,152 | Existing strict BuildPlan v1 |
| `README.txt` | 16,384 | Versioned deterministic setup/feature summary |

No directory, alternative spelling, absolute path, drive prefix, slash/backslash variant, parent traversal, NUL, extra file, symlink or duplicate path is allowed. No path is ever resolved or extracted to a filesystem.

The archive is single-disk ZIP, **STORE (method 0)** only, version-needed/version-made-by 20 (DOS host), flags zero, DOS time zero/date 33 (1980-01-01), no extras/comments/data descriptors, and zero internal/external attributes. ZIP64, encryption, compression, split archives and self-extracting prefixes are unsupported. Local records must be contiguous from byte zero, followed immediately by their central records in matching order and one 22-byte end record at EOF. All counts, offsets, names, sizes and CRC-32 values must agree. No overlap, gap, trailing bytes, alternate head or partial-file fallback is accepted. Declared and actual lengths are bounded before interpretation; no decompressor exists.

Text is strict UTF-8 without BOM. JSON is compact with recursively lexically sorted object keys, original array order and exactly one final LF, as implemented by `blueprintJson`. Duplicate/unsafe keys, extra properties, normalization discrepancies and unsupported schema values refuse. This canonical requirement is specific to package files; ordinary BuildPlan v1 JSON import keeps its existing whitespace-compatible behavior.

The strict manifest has exactly:

```ts
{
  format: "lms-blueprint-package",
  version: 1,
  blueprint: {
    name: string,         // trimmed single line, 1–80 characters
    description: string,  // trimmed single line, 1–600 characters
    gallery?: { id: string, revision: number } // allowlisted ID syntax; 1–999
  },
  compatibility: {
    buildPlan: 1, engineApi: 1, template: 1, configurationSchema: 1,
    modules: [{ id: string, version: "1.0.0", dependencies: string[] }]
  },
  files: [
    { path: "buildplan.json", bytes: number, sha256: string },
    { path: "README.txt", bytes: number, sha256: string }
  ]
}
```

`modules` must exactly match the validated plan's enabled modules, in plan order. Dependencies are the existing manifest and required-record-reference dependencies, sorted lexically; no automatic dependency repair occurs during import. Payload lengths count encoded bytes and SHA-256 digests are lowercase 64-character hex of the exact file bytes. ZIP CRC-32 additionally checks every file, including the manifest. Hashes do **not** authenticate the manifest, author or Gallery reference.

`README.txt` must equal the v1 `blueprintSummary` output for the validated plan and details. Its feature/entity labels come from saved configuration, not mutable Gallery copy. Developers must preserve this v1 protocol text/algorithm, or introduce an explicitly supported version before changing it. Module/core-field changes must follow existing registry/template version rules. Browser rendering treats all package text as text, never HTML, links to execute, SQL or scripts.

## Safe Gallery comparison

Gallery metadata remains separate from BuildPlan v1. Customizing a reviewed card supplies an ID/revision **hint** to the package; imports cannot establish trusted authorship from that claim. The current bundled catalog is independently validated before comparison. A newer bundled revision produces a readable comparison of the user's customized choices against the current starter: modules, business identity/name, time zone, terminology, navigation and fields. Same-revision choices can also be compared. A newer claimed revision unavailable in this LMS release, missing reference or different business type produces an explanation, never an automatic update.

This is a two-way configuration comparison. There is no historical template download, remote update request, verified provenance, three-way merge or automatic upgrade. It preserves saved choices instead of attempting to reconcile user edits. Keep the original ZIP, review a newer starter in Gallery separately, and deliberately customize or copy choices. Template/registry updates never rewrite saved plans or populated schemas.

## Boundaries and follow-ups

The package is entirely untrusted configuration until structural/compatibility validation succeeds, and still has no trusted publisher identity afterward. An attacker can create a different valid package and recompute all hashes. Neither checksums nor this comparison provide signatures, supply-chain approval or anti-rollback evidence. The credential-lineage/checkpoint-publication trust protocols are separate and unchanged.

Public previews remain isolated, no-login, fictional and temporary. Persistent adapters stay host-only, recovery activation remains blocked, and no package can restore a database or grant a role. No record, account, secret, environment file, dependency installer, generated application, public upload, hosting/deployment, branding, marketplace, AI, payment or messaging feature is added.

Follow-ups: reviewed template provenance/history and explicit migration UX; separate branding; tested executable app/self-host export only after its complete setup, security and recovery boundaries are reviewed. [Verification](blueprint-packages-verification.md) · [Roadmap](../ROADMAP.md).
