# Complete-bundle publisher attestations

The separate **`lms-branded-bundle-publisher-attestation` version 1** authenticates the exact original Branded Blueprint Bundle 1, its nested Blueprint ZIP, optional Logo Companion and original PNG bytes. It is a detached JSON file, never an extra ZIP entry or a modification to an older protocol.

**The real reviewed publisher registry remains empty.** This release establishes no real publisher identity and cannot verify a real publisher without separately authorized, independently reviewed key enrollment. Positive tests use explicitly isolated ephemeral keys; they do not enroll an official LMS publisher.

## Import and inspect in Studio

1. Open the fictional no-login BuildPlan Studio and choose **Import Branded Blueprint Bundle**.
2. Optionally choose **Complete-bundle publisher attestation**. A separate **Nested Blueprint attestation only** input retains the original protocol. Neither input accepts a public-key enrollment file.
3. Choose **Review branded bundle**. Fixed archive profiles, canonical metadata, exact outer/component/image digests, versions, supported configurations and dependencies are checked. A supplied invalid, unknown, retired or unsupported claim refuses the attempt; it never silently becomes unsigned.
4. Inspect **Verify complete branded bundle**, compatibility, features, dependencies, palette and fingerprints. Whole-bundle coverage and separately supplied nested-Blueprint coverage have distinct labels.
5. Deliberately accept the BuildPlan as **unsaved Studio choices**. Current editor/published revision checks remain required. This does not save, publish, stage or select a logo.
6. Independently choose **Sanitize and stage bundle logo**. Every image still goes through the original server decoder, limits, processing gate, session/role checks and quotas. A valid signature is not image safety; a correctly signed animated PNG is rejected by that pipeline.
7. Inspect light/dark sanitized samples and explicitly select the staged image for the current receiving temporary session. Engine configuration previews stay independently scoped with built-in identity and unchanged preview quotas.
8. Saving/publication and any future durable use remain separate approvals. [Host-only private transfer and destination mapping](private-logo-transfers.md), durable selection and current-configuration association retain their own current identity, owner/admin, instance, revision, quota and recovery checks.

Removing a failed claim and starting a new explicitly unsigned review is allowed under the existing legacy policy. Failed verification itself never performs that downgrade. No original drafts, operational records, published configurations, audit history or retained private associations change just by inspecting a signature.

## Read the verification states

| State | Meaning |
| --- | --- |
| Verified complete-bundle signature | The exact outer bundle and its original nested contents were signed by the private key matching a separately trusted **active** reviewed public key |
| Verified nested Blueprint only | The separately supplied old protocol authenticates only the exact Blueprint ZIP; its signature does not cover the companion, PNG or outer bundle |
| Unsigned / publisher unverified | Structural integrity/compatibility can pass without establishing publisher identity |
| Invalid or unsupported signature | Refuse this attempt with an explanation; no authenticated acceptance or unsigned fallback |
| Locally reviewed Gallery content | Independent content comparison/history, never a substitute for publisher verification or trusted ancestry |

A complete-bundle signature binds the **original** PNG. Destination sanitization may re-encode it into different bytes; the original signature must not be relabeled as authenticating a different sanitized output. Integrity is separate from successful decoding, image ownership, installation authority, business permission, production readiness and freshness.

## Exact detached protocol

Both payload and envelope use the existing `blueprintJson`: lexically sorted keys, compact canonical JSON, strict UTF-8 without BOM and exactly one final LF. The signed bytes are:

```text
lms-branded-bundle-publisher-signature-v1\n
<canonical payload JSON with exactly one final LF>
```

The displayed `\n` represents one actual LF. Ed25519 signs these complete bytes directly. There is no caller-selected algorithm, prehash, alternate serialization, executable instruction or subset signing. The prefix differs from Blueprint Attestation 1 and all recovery/checkpoint signature domains.

| Payload field | Exact contract |
| --- | --- |
| `format`, `version`, `algorithm` | `lms-branded-bundle-publisher-attestation`, `1`, `Ed25519` only |
| `keyId` | Existing reviewed publisher ID vocabulary; never an embedded verification/private key |
| `bundleSha256` | SHA-256 of **every exact outer ZIP byte**, including archive headers, order and canonical manifest/summary |
| `blueprintSha256` | Exact nested Blueprint ZIP bytes |
| `imageIncluded` | Explicit boolean, checked against actual validated component presence |
| `logoCompanionSha256`, `imageSha256` | Exact companion ZIP/original PNG digests, or **both null** when absent |
| `compatibility` | Exact `bundle:1` plus the existing validated bundle compatibility fields: Blueprint 1/2, BuildPlan 1/2, configuration 1/2, Engine API 1, template 1 and companion 1/null |

The envelope has exactly `{payload, signature}`; `signature` is 128 lowercase hexadecimal characters (64 Ed25519 bytes). Digests are 64 lowercase hexadecimal characters. The entire detached file must equal its canonical serialization and stay within **8 KiB**. Contradictory image/null/version claims, unknown/duplicate/unsafe keys, whitespace variants, BOM, invalid UTF-8, unsupported formats/algorithms/versions or extra properties refuse.

The original bounded bundle/Blueprint/companion readers remain authoritative **before cryptographic acceptance**. Exact component digests are independently compared to fully validated contents. Reordering or replacing ZIP/PNG bytes changes signed commitments; an earlier attestation fails. Extra paths, duplicates, traversal, compression/bomb profiles and unsupported configurations still refuse under the existing readers. Untrusted files are never extracted or executed. No configuration/package upgrade or downgrade occurs.

No credentials, private keys, operational records, session IDs, source/destination organization/asset IDs, installation mappings or remote resources are accepted in the attestation. No new fields enter BusinessConfig, BuildPlan, Blueprint ZIP, Blueprint Attestation 1, Logo Companion 1, Bundle 1 or Private Destination Map 1.

The frozen Bundle 1 README describes the unsigned bundle alone as publisher-unverified because it contains no signature. Those canonical bytes are intentionally unchanged. The separate verifier reports detached evidence independently; summary text is never a source of authentication status.

## Trust, enrollment and retirement

Both protocols reuse the same reviewed `src/templates/publishers.json`, registry validator, active/retired policy and fixed Web Crypto Ed25519 verifier. No uploaded key, author name, Gallery hint, checksum or signature possession establishes independent real-world identity. Studio never accepts a registry override. Pure verification/signing APIs support an explicit registry only for trusted host tooling and isolated tests; it is not a public enrollment feature.

The [existing independent enrollment and retirement procedure](blueprint-provenance.md#reviewed-public-key-custody-and-retirement) remains required. Real key enrollment is **outside this PR's authorization**. Retiring a key requires a reviewed source change retaining its ID/material and setting `retired`; both protocols then reject all its signatures, including older ones. Replacements need new independently reviewed IDs/keys, not silent substitutions. Public-key source/release delivery remains a trust assumption.

## Trusted offline signing

The signer runs only on a trusted offline Linux host after dependencies are installed. It has no database/account requirement, public signer, automatic upload, installation, publication or paid-service dependency.

```sh
npm run blueprint -- bundle-inspect /absolute/offline/lms-branded-blueprint-bundle.zip
# Verify an independently supplied claim:
npm run blueprint -- bundle-inspect /absolute/offline/lms-branded-blueprint-bundle.zip /absolute/offline/bundle.attestation.json
```

Inspection emits data-only metadata, exact commitments, versions and scope warnings, never PNG bytes or private mapping values. With the shipped **empty** registry, claimed publisher signatures and signing both refuse. After a separate authorized enrollment review, independently inspect the complete exact bundle and prepare this bounded request:

```json
{
  "bundlePath": "/absolute/offline/lms-branded-blueprint-bundle.zip",
  "privateKeyPath": "/absolute/offline-keys/publisher.pem",
  "outputPath": "/absolute/private-output/bundle.attestation.json",
  "keyId": "previously-reviewed-active-key-id",
  "expectedBundleSha256": "REPLACE_WITH_THE_EXACT_64_HEX_DIGEST_YOU_INDEPENDENTLY_REVIEWED",
  "confirmation": "SIGN REVIEWED FICTIONAL BRANDED BUNDLE"
}
```

This is intentionally invalid until its digest/key ID/paths are independently reviewed and replaced. Do not create an actual publisher identity merely to run the example.

```sh
npm run blueprint -- bundle-sign < /absolute/offline/sign-request.json
npm run blueprint -- bundle-inspect /absolute/offline/lms-branded-blueprint-bundle.zip /absolute/private-output/bundle.attestation.json
```

The existing private POSIX custody helpers require process-owned 0700 directories without symlinked paths, an absolute 0600 process-owned regular PKCS#8 Ed25519 key **outside the checkout**, and fresh output. Signing key reads now also refuse multiple hardlinks, using the same open file descriptor; other recovery-file readers retain their existing policy. The derived public key must exactly match the enrolled active entry. No algorithm/key material is taken from the bundle. Explicit confirmation and the independently reviewed outer digest must match.

The tool signs a snapshot, verifies the complete signature with the client-compatible verifier, creates/syncs a **new exclusive** 0600 file, re-reads its exact bytes, verifies again and syncs the parent directory before reporting success. Concurrent output creation has one winner. Failure after any write/sync returns failure and retains output for private inspection. Existing/partial output is never overwritten, completed, repaired or automatically deleted. Do not distribute an ambiguous file; independently inspect it and use a newly reviewed fresh output path if needed. Physical power-cut recovery and a publication ledger are not claimed.

Signing proves key possession over exact data; the signer is not an image-safety certificate or a replacement for independently reviewing fictional contents. Recipients always re-sanitize. Private PEM strings/KeyObjects exist in the trusted process; guaranteed memory erasure, hardware-backed/encrypted-key custody and compromised-host resistance remain future work. Never put keys in the repository, frontend, demo, database/backups, bundles or artifacts. Tests generate/destroy their own temporary keys and pass only public test trust to isolated browser harnesses.

## Failure model and remaining work

Identical old signed bytes can be inspected repeatedly without writes. They may verify while their key remains active, but there is **no separately accepted monotonic latest-version witness, trusted signing time, anti-replay publication counter or complete retirement-distribution guarantee**. An old application/registry can still mark a retired key active. Signer, trusted host, application/source or registry-delivery compromise can subvert authenticity; rollback of every trust anchor is not prevented.

Publisher-key enrollment, independent retirement/freshness distribution, production signing/distribution, accepted real-user transport and production security are separate reviews. This phase grants no durable destination authority, cross-organization copying, automatic publication/selection/association, migration execution or recovery activation. MIT licensing, ForgeOS attribution and the fictional demo remain intact.

[Verification evidence and screenshots](branded-bundle-provenance-verification.md) · [Original Blueprint signatures](blueprint-provenance.md) · [Bundle format](branded-blueprint-bundles.md)
