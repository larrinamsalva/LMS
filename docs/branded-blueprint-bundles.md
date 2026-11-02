# Portable branded blueprint bundles

A **branded bundle** carries a validated Blueprint Package and an optional Logo Companion together. It is a new, data-only outer envelope: `lms-branded-blueprint-bundle` version 1. The nested Blueprint ZIP 1/2 and Logo Companion 1 remain unchanged, including their exact bytes. BusinessConfig/BuildPlan 1/2 and detached publisher attestation 1 do not change.

This is portable configuration plus an optional image, **not published portable image branding**, a database backup, an installable application, migration permission or a durable asset transfer. The public demonstration remains fictional and temporary. No persistent-business route, image host, deployment or recovery activation is added.

## Download from Studio

1. Customize a valid BuildPlan in **Build My Business System**. Use fictional names, descriptions and labels; the schema has no operational-record or credential fields, but it cannot detect private text deliberately entered into a configuration label.
2. If desired, independently sanitize/stage a fictional image under **Brand Your Business**, inspect its light/dark samples and explicitly select it for the current session.
3. In **Portable branded blueprint bundle**, opt into **Include my selected temporary logo**, then choose **Download Branded Blueprint Bundle**. The default is configuration only. Staged/unselected or durable PostgreSQL assets are not exported by these controls.
4. The logo read uses the existing private selected-image download: current owner/admin authority, selected asset ID/revision, shared processing reservation, expiry and post-processing authorization checks. The device file contains a companion, **never that local ID or URL**. It is not proof that the user retained or backed up the downloaded file.
5. Existing **Download Blueprint Package**, JSON and **Save My Logo** workflows keep their original formats. Nothing is saved, selected or published by downloading a bundle.

The core `createBrandedBlueprintBundle(exactBlueprintZip, optionalExactCompanionZip)` also wraps already validated component bytes without regenerating them. This preserves a detached attestation's exact nested-Blueprint input. It is a data codec, not an authorization or image-safety API. Host code must obtain private image bytes through an independently authorized source; no durable adapter export/transfer workflow is enabled here. Studio export generates a fresh Blueprint from its current choices; it does not claim an old signature still covers newly generated or modified bytes.

## Import, inspect and approve independently

1. In a fresh fictional demo, choose **Import Branded Blueprint Bundle**, then **Review branded bundle**. Names/MIME types do not determine acceptance. Size, fixed files, canonical manifest, exact component hashes, nested formats, supported versions and module dependencies are validated before review.
2. Optionally provide a separate **Nested Blueprint attestation only** file. Existing attestation 1 verifies only the exact nested ZIP against the reviewed local public-key registry. An invalid, unknown, retired, incompatible or misleading claim refuses; it never silently falls back to verified/unsigned acceptance. Deliberately remove a claim to inspect a genuinely unsigned import.
3. Review business name/type, modules/dependencies, palette/default appearance, compatibility, impact warnings, contained logo layout and integrity. **Bundle and image publisher authenticity remain unverified**, even if the nested Blueprint signature verifies. No original image pixels are rendered: the initial samples use the built-in mark.
4. Choose **Accept bundle BuildPlan as unsaved choices**. Current editor/published-revision mismatches refuse. This never saves a draft, publishes a configuration, changes a record or creates a durable association. Existing saved drafts remain available.
5. Independently choose **Sanitize and stage bundle logo**. The unchanged companion bytes go through the existing private companion intake, server sanitizer and quotas. A digest-valid PNG can still be animated, malformed or unsafe; failure leaves the current image in place. No alternate browser decoder, raw-image object URL, remote image source or unreviewed storage shortcut exists.
6. Inspect the **server-sanitized** image against the imported light/dark palette in the shared branding component. The reviewed square/rectangle layout comes from the companion. Only the exact newly staged revision/source-image digest can be selected in this review; changed/expired/unrelated stages require refresh and deliberate staging again.
7. Explicitly **Select staged bundle logo for this session**. It is a receiving-organization-owned temporary image with a new server-generated ID. The source organization, records, published configuration, saved drafts and durable logo history remain unchanged. Layout and built-in fallback can subsequently be managed by the existing Custom Business Logo controls.
8. **Return to Studio choices**, then explicitly save if desired. Configuration publication still needs the existing saved revision, role, impact and confirmation checks. Populated-schema and project-identity blockers remain authoritative.

**Prepare bundle configuration preview** uses the actual Engine and existing three-preview quota/cache. It creates an independent empty fictional organization with the imported configuration and **built-in identity**. Private pixels are not implicitly copied into that organization. Sanitized image samples in the review use only the receiving current organization's authorized temporary asset; they are not claimed to be image-bearing publication or a durable preview transport.

Cancel before acceptance preserves prior editor choices. Closing after acceptance keeps the deliberately accepted unsaved choices. Closing a review releases its component-buffer references/best-effort copies; it does not silently remove a separately approved staged/selected server asset. The original 10-minute stage/two-hour session expiry, explicit removal and quota-preserving cleanup remain authoritative. Already delivered device/browser pixels cannot be recalled; buffer clearing is not guaranteed erasure.

## Exact bundle 1 protocol

The reviewed STORE-only ZIP codec is reused with two closed profiles:

| Path | Required | Maximum bytes |
| --- | --- | ---: |
| `manifest.json` | Always | 4,096 |
| `blueprint.zip` | Always, exact Blueprint Package 1 or 2 | 98,304 |
| `README.txt` | Always, exact generated summary | 8,192 |
| `logo-companion.zip` | Only when the manifest declares a logo, exact companion 1 | 266,240 |

Total archive maximum: **393,216 bytes (384 KiB)**. Exactly three entries without a logo or four with one. No compression/decompression, encryption, descriptors, ZIP64, split archives, extras/comments, preambles/trailing bytes, attributes/symlinks, unexpected/duplicate/traversal/nested/absolute/case-variant paths or external resources are accepted. Local and central headers, names, lengths, CRC-32, offsets and end record must agree. Readers operate only on bounded bytes; nothing is extracted to a filesystem. Each nested ZIP uses its unchanged strict profile; there is no recursive general-purpose archive loader.

The manifest is strict canonical `blueprintJson`: UTF-8 without BOM, recursively sorted object keys, compact JSON and one final LF. Unknown/duplicate keys, alternate encodings, unsupported versions and unsafe extra metadata refuse. It contains only:

```ts
{
  format: "lms-branded-blueprint-bundle", version: 1,
  compatibility: {
    engineApi: 1, template: 1,
    blueprintPackage: 1 | 2, buildPlan: 1 | 2,
    configurationSchema: 1 | 2, logoCompanion: 1 | null
  },
  blueprint: { path: "blueprint.zip", bytes: number, sha256: lowercaseHex64 },
  logo: null | {
    path: "logo-companion.zip", bytes: number, sha256: lowercaseHex64,
    display: "square" | "rectangle"
  },
  summary: { path: "README.txt", bytes: number, sha256: lowercaseHex64 }
}
```

All counts are positive bounded integers. SHA-256 binds the **exact complete nested ZIP bytes** and exact summary bytes. The companion's unchanged inner manifest separately binds exact PNG bytes, format and dimensions; the outer layout must match it. Compatibility must match the validated components exactly. A legacy unbranded plan can remain version 1 with an independent temporary logo companion; there is no implicit upgrade. The human-readable summary must exactly match `brandedBundleSummary` for those components, so an archive cannot substitute instructions claiming verified identity, production activation or executable setup. Changing this strict summary/protocol needs explicit versioned review.

No source/destination organization UUID, installation asset ID/revision, private URL, audit history, account/credential, record payload, arbitrary executable/SQL, public key, signature or transfer mapping is accepted in the outer manifest or as an extra file. Component configuration may contain reviewed entity definitions and fictional user-supplied text; it never imports operational rows. All existing configuration readers remain authoritative, even if every surrounding digest is recomputed or a nested ZIP has a valid signature.

## Integrity and publisher authenticity

Anyone can replace components and recompute every unsigned manifest/hash, producing a different internally consistent bundle. That does not establish publisher identity, image safety, trusted ancestry or freshness. The current real publisher registry remains empty; test keys are ephemeral and explicitly scoped to tests. A declared author, Gallery hint, matching image digest, valid CRC or verified nested Blueprint attestation never authenticates the complete bundle/image.

Future image-bearing signatures need a **separately reviewed, versioned attestation** with exact canonical encoding and domain separation, binding the complete outer bundle digest and all intended compatibility/image content. Do not extend attestation 1 silently. Independent publisher enrollment/key custody, retirement/replacement distribution and latest-version witnessing remain separate trust requirements. No signing secrets, trust enrollment or remote feed is added here. Even a future valid signature must not grant migration, publication, ownership, installation or activation authority.

## Private durable destination mapping — host-only

The separate [private destination-map workflow](private-logo-transfers.md) supports explicitly authorized fictional PostgreSQL transfers. It revalidates unchanged bundle/components, requires an existing recent local session and current owner/admin authority, re-sanitizes the PNG and atomically stores a new destination UUID with an immutable private receipt. Selection and current-configuration association remain separate explicit reviews. The public Studio path above remains temporary and isolated.

Bundle 1 still rejects mapping objects, installation-local IDs and extra files; no portable format or canonical README is rewritten. Private receipts are never publisher or recovery authority. Production transport, image-bearing signatures, portable image publication and destructive retention remain future phases.

[Actual verification and screenshots](branded-blueprint-bundles-verification.md) · [Blueprints](blueprint-packages.md) · [Companions](logo-companions.md) · [Private associations](private-logo-associations.md)
