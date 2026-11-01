# Detached blueprint publisher verification

Blueprint ZIPs remain configuration, never applications or database backups. Publisher verification is a separate, optional **offline** check. It adds no account, upload endpoint, remote key lookup, installer, migration, publication or activation permission. The three-file [ZIP v1/v2 contracts](blueprint-packages.md) and their exact bytes are unchanged.

**No real publisher key is enrolled in this release.** The reviewed registry is deliberately empty. The positive signature examples in automated tests use newly generated, ephemeral fictional keys and explicit test trust. They do not authenticate LMS maintainers or establish an official publisher. Real enrollment requires the separate authorization and review below.

## Import and inspect in Studio

1. Open **Build My Business System** without signing in. Choose **Import Blueprint Package** under **Keep and reuse your blueprint**.
2. Optionally choose its separate **Detached publisher attestation** JSON file. Nothing is uploaded. ZIPs are bounded to 96 KiB; attestations to 8 KiB.
3. Choose **Verify Blueprint**. Invalid claimed authentication refuses the import; no preview or acceptance button appears. Read the specific error for unknown/retired keys, unsupported algorithm/version, mismatched bytes, invalid signature or unsupported Gallery edition. Package/schema/module failures also refuse, even with a valid signature.
4. A successful **Review Blueprint** shows the blueprint name, business type, included modules/dependencies, integrity, publisher and signature status, format compatibility, template edition claims and differences from the workspace. Expand the fingerprint details to inspect the exact ZIP digest and, for authenticated results, the public-key digest.
5. An unsigned legacy package displays **Unverified publisher · unsigned package**. Matching locally reviewed configuration content is reported independently; a claimed author name or Gallery hint never verifies a publisher or establishes ancestry.
6. **Prepare blueprint preview** uses the existing isolated, fictional Engine workspace and existing preview quota. It does not import operational records.
7. **Use as unsaved Studio choices** is deliberate and separate. Saving, current draft/configuration revisions, permissions, impact review and publication confirmation still apply. Populated-schema and recovery activation blockers remain authoritative. Cancel preserves the original choices.

If an attestation is wrong, obtain the correct file from its publisher. Explicitly clearing a claim and retrying permits only an **unsigned/unverified** import; it cannot preserve or manufacture a verified result. Verification results are ephemeral to that import review, not stored in BuildPlan drafts, JSON exports or ZIP metadata. After editing or re-exporting, an old attestation verifies only if every package byte is identical.

## Attestation v1 contract

Runtime definitions: `src/core/blueprint-provenance.ts`. A detached file has exactly `payload` and `signature`. The payload has exactly:

```ts
{
  format: "lms-blueprint-publisher-attestation",
  version: 1,
  algorithm: "Ed25519",
  keyId: string,               // [a-z][a-z0-9-]{0,63}
  packageSha256: string,        // lowercase 64-hex SHA-256 of the COMPLETE ZIP
  compatibility: {
    package: 1, buildPlan: 1, configurationSchema: 1,
    engineApi: 1, template: 1
  },
  gallery: null                // or { id: string, revision: integer 1..999 }
}
```

For branded packages, compatibility is exactly `package: 2, buildPlan: 2, configurationSchema: 2, branding: 1, engineApi: 1, template: 1`. Pairings must match the already validated package. These are supported exact versions, not a range or a promise of future compatibility. An optional Gallery claim must match the ZIP hint and a supported, source-pinned local history edition of the same business type. It still does not prove that a customized plan descends from that starter. Omitting the claim (`null`) is allowed; any ZIP hint then remains unauthenticated as an edition assertion.

`signature` is exactly 128 lowercase hexadecimal characters: the 64-byte Ed25519 signature. Public keys are 32 raw bytes represented by 64 lowercase hex characters in the registry. No private key, public key supplied by an importer, certificate, customer record, token, password, hash of a password or operational row is accepted in the attestation schema.

The signed message is exactly:

```text
UTF8("lms-blueprint-publisher-signature-v1\n" + blueprintJson(payload))
```

`blueprintJson` recursively sorts object keys lexically, retains array order, emits compact JSON and appends **one LF**. Thus the domain line has its own LF and the payload has one final LF. Ed25519 signs this complete byte sequence directly (`crypto.sign(null, message, key)`), not a caller-selected hash or a reserialized subset. No Ed25519ph, RSA, HMAC, algorithm negotiation or alternate canonicalization is supported.

The entire detached file must itself equal `blueprintJson({payload, signature})`: UTF-8 without BOM, exact canonical encoding and final LF. Duplicate/unsafe keys, unknown properties, extra whitespace, malformed UTF-8, empty or oversized files refuse. Exact canonical comparison rejects ambiguous duplicate keys rather than accepting whichever value JSON parsing retained. ZIP, attestation and trust entries are snapshotted before asynchronous verification. Only the reviewed public registry is used by Studio; the explicit registry argument in the pure verifier supports isolated test tooling, not a browser enrollment feature.

The implementation uses native Node Ed25519 for offline signing and Web Crypto Ed25519 verification in supported browsers on HTTPS/localhost. Unsupported crypto fails closed. References: [W3C Ed25519 operations](https://www.w3.org/TR/webcrypto-2/#ed25519), [Node crypto signing](https://nodejs.org/api/crypto.html#cryptosignalgorithm-data-key-callback), [RFC 8032](https://www.rfc-editor.org/rfc/rfc8032).

## Reviewed public-key custody and retirement

Trust anchor: the code-reviewed `src/templates/publishers.json` shipped with the application. It is independently chosen by the application's operator, not taken from the package, ZIP digest, author text, Gallery hint or network. Its strict v1 envelope is `format: "lms-blueprint-publisher-registry", version: 1, keys: []`. Entries have exactly `id`, bounded plain-text `name`, `algorithm: "Ed25519"`, raw-hex `publicKey`, and `status: "active" | "retired"`. Duplicate IDs or duplicate key material refuse the registry. The application contains verification keys only.

To enroll a real publisher in a future reviewed change:

1. Establish the publisher's identity and signing authority using previously trusted, independent evidence. A new email address, claimed organization or uploaded key is insufficient. This PR does not establish that real-world process or authorize a real identity.
2. Generate a distinct Ed25519 signing key on a trusted **offline signing machine**, outside the checkout, demo server, CI, database and database backups. Do not reuse credential-lineage/operator keys. Keep the key in restricted offline custody; independently preserve its public fingerprint and the enrollment authorization. Hardware-backed custody and encrypted-key/passphrase entry are follow-ups; this tool accepts a private unencrypted PKCS#8 PEM in a process-owned 0600 file on a supported POSIX host, so host compromise exposes it.
3. Independently compare the 32-byte public key and its SHA-256 fingerprint over a previously trusted channel. Review a normal source PR adding only its public registry entry, identity evidence references (no private evidence), purpose and custody/retirement owners. Build/distribute the reviewed registry through the same trusted application release path. A file upload cannot enroll a key.
4. Confirm the enrollment and sign/verify a fictional acceptance package before claiming publisher authenticity. Tests here do not satisfy this requirement for a real maintainer.

Retire a key through a separately reviewed source PR changing that **same ID and public key** to `retired`. Keep its historical public entry; do not silently replace key bytes or reuse IDs. This phase rejects **all** attestations by retired keys, including old signatures: there is no trusted timestamp that could prove a signature predates compromise. Replacement keys require new IDs and fresh independent enrollment. Audit the source change and release its registry update; do not edit deployed trust ad hoc. Historical key immutability across source releases is a review/distribution responsibility, not a cryptographic guarantee made by this file.

## Host-only signing and verification

Requires the normal Node setup; no database, account, server, paid service or network is required once dependencies are installed. Work on fictional configuration only. Independently inspect the exact package, modules, labels and compatibility before approving a signature. Free text could contain a secret typed by its author; schema validation cannot detect every such disclosure.

```sh
npm run blueprint -- inspect /absolute/offline/lms-blueprint.zip
# When a genuine detached file is available:
npm run blueprint -- inspect /absolute/offline/lms-blueprint.zip /absolute/offline/publisher.attestation.json
```

Inspection prints data-only metadata, versions, warnings and exact digests. Signing requires an **already enrolled active** key. With this release's empty registry, signing refuses. After separately reviewed enrollment, prepare a bounded JSON request on the offline machine:

```json
{
  "packagePath": "/absolute/offline/lms-blueprint.zip",
  "privateKeyPath": "/absolute/offline-keys/publisher.pem",
  "outputPath": "/absolute/private-output/publisher.attestation.json",
  "keyId": "separately-reviewed-publisher-key-id",
  "expectedPackageSha256": "REPLACE_WITH_THE_64_HEX_DIGEST_YOU_INDEPENDENTLY_REVIEWED",
  "confirmation": "SIGN REVIEWED FICTIONAL BLUEPRINT"
}
```

The example is intentionally invalid until its digest/key ID/paths are reviewed and replaced. Both output and key directories must already exist, be owned by the process user, be mode 0700 and have no symlinked path on Linux. Keep the request private; it contains file locations, never inline private keys. The private key must be an absolute 0600 process-owned regular file outside this repository. Symlinked keys and existing output files refuse. The derived public key must exactly match the enrolled active entry. The signer rechecks the package, digest, complete attestation and signature before creating a new 0600 file and syncing it and its directory.

```sh
npm run blueprint -- sign < /absolute/offline/sign-request.json
npm run blueprint -- inspect /absolute/offline/lms-blueprint.zip /absolute/private-output/publisher.attestation.json
```

Distribute the **unchanged** ZIP with its detached file, never the PEM/request/private custody directory. An interruption or write/sync failure returns failure; do not distribute partial output or infer success from a filename. Existing output is never repaired or overwritten. Inspect it independently, retain evidence and choose a fresh output path for a newly reviewed retry. This protocol is not a publication ledger or crash-recovery transaction; it grants no latest-version guarantee. There is no public signer or trust-enrollment HTTP route.

## Failure model and remaining limits

| Observation | Meaning and behavior |
| --- | --- |
| Valid ZIP, no claim | Configuration is supported; publisher unverified; explicit review may continue |
| Recognized active key + valid signature + exact bytes/versions | Possession of that signing key established for these exact bytes; review may continue |
| Locally pinned template plan digest matches | Exact configuration content match to a locally reviewed edition; independent of publisher verification |
| Invalid, unknown, retired, unsupported or misleading claim | Refuse this attempt; no authenticated fallback or import acceptance |
| Old valid signed package | May verify under an active key; authenticity is **not freshness** |
| Compromised signer or application/registry delivery | Attacker may sign or change trust; this phase does not protect against that administrator/source compromise |

There is no independently monotonic witness, remote revocation service, trusted signing time, latest-edition receipt, anti-replay counter or protection against rollback of **all** application/registry trust anchors. Reusing identical signed bytes for inspection is intentionally allowed and creates no database write. A retired key remains accepted by an older application whose registry still marks it active; operators must distribute reviewed retirement releases through their independent trust process. Publisher signatures are separate from credential history/checkpoint publication and cannot unblock restored databases. No production safety, code-review endorsement, secure deployment, real-user authorization, migration execution or installation is implied.

[Actual test evidence and screenshots](blueprint-provenance-verification.md) · [Security boundary](../SECURITY.md) · [Roadmap](../ROADMAP.md)
