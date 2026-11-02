# Portable logo companions

**Save My Logo** preserves an owner's sanitized fictional logo on their device. LMS custody remains private, temporary and organization/session-scoped. This is a separate data asset, not published branding, a BuildPlan extension, a publisher attestation or permission to install/migrate/activate anything.

## Try the complete workflow

1. Open **Build My Business System → Customize → Brand Your Business → Custom Business Logo**. Stage a synthetic PNG/JPEG/WebP and inspect its sanitized light/dark samples. Explicitly select it for the session. Merely staged images cannot be exported.
2. Under **Save My Logo**, choose **Download sanitized PNG** for the reviewed image only, or **Download logo companion** to preserve its contained square/rectangle layout and integrity manifest. Both use the current selected asset/revision and current owner/admin authority. The filename is fixed; the original device filename is never retained.
3. Save the download on your own device. A browser download notification does not prove the owner retained or backed up that file. Expiry/removal/restart still clears LMS custody; LMS cannot recover your device file.
4. Start a fresh isolated demo session, for example a separate browser profile. Choose **Import logo companion**, then **Review logo companion**. Inspection checks the bounded ZIP profile, canonical manifest, PNG header, dimensions, byte count and SHA-256. No image is rendered, staged or selected at this point.
5. Read **Image integrity verified** alongside **Publisher authenticity not established**. A checksum detects changed bytes relative to the manifest; anyone can replace both and create a new valid unsigned companion. A blueprint's detached signature does not authenticate this independent asset, even if filenames/digests seem related.
6. Choose **Sanitize and stage companion**. The server repeats archive validation, actual image/container validation and native decode/re-encoding under existing upload/processing/storage quotas. A digest-valid image can still fail safety checks. Review the server-sanitized light/dark samples and choose square or rectangle.
7. Explicitly **Use staged logo for this session** (or **Replace session logo with staged image**). It becomes a **temporary private logo selected**, never published branding. **Use built-in logo for this session** removes that overlay. These actions require exact current asset/revision checks.

Replacement, removal, export and import never modify business records, BuildPlan choices/drafts, configuration revisions, Engine audit history, migration reports or existing signed packages. Separate Engine preview organizations keep built-in identity and receive no implicit asset copy. Owners can deliberately transfer their downloaded bytes into another authorized temporary organization; old IDs, sessions and rights do not transfer.

## Companion protocol v1

The only accepted archive has exactly two root files, `manifest.json` and `logo.png`. It uses the existing bounded **STORE-only ZIP codec** with a separate profile: no filesystem extraction, compression/decompression, encryption, data descriptors, ZIP64, split archives, comments, extras, symlinks, attributes, preambles or trailing bytes. Local/central names, sizes, CRC-32, offsets and exact end record must agree. Both files must occur exactly once; absolute/nested/traversal/NUL/case-variant paths, duplicate and extra files refuse. The writer uses manifest then image; the reader accepts either consistent contiguous order. Maximum total: **266,240 bytes (260 KiB)**; manifest: 2,048 bytes; PNG: 262,144 bytes.

Strict manifest (illustrative digest/byte count must match the actual PNG):

```json
{
  "format": "lms-logo-companion",
  "version": 1,
  "display": "rectangle",
  "image": {
    "path": "logo.png",
    "format": "png",
    "width": 128,
    "height": 64,
    "bytes": 123,
    "sha256": "64 lowercase hexadecimal characters"
  }
}
```

Exact encoding is the existing `blueprintJson` canonical JSON: UTF-8 without BOM, lexically sorted object keys recursively, compact JSON and one final LF. Unknown keys, duplicate keys, alternate encodings, invalid JSON/UTF-8, unsupported format/version/display and invalid bounds refuse. Dimensions are integers 1–512, byte count is positive, digest is SHA-256 of the **exact PNG bytes**, and actual PNG signature/IHDR dimensions must match. No publisher/author/blueprint hint, organization/session/asset ID, external URL, credentials, row values, custom text, executable content or signing material is permitted in the manifest.

This is **integrity inspection, not a decoder or signature**. Native server sanitization remains authoritative. Static PNG/JPEG/WebP are still supported for ordinary image upload, but the companion permits PNG only. Browser extensions/MIME declarations do not determine either format. A saved PNG can also be imported through the ordinary image picker; it does not carry the saved layout.

## Private transport and limits

- `POST /api/demo/logo/download` accepts strict JSON `{organizationId, assetId, revision, format: "png" | "companion"}` (at most 4 KiB, no query parameters). It resolves the existing demo cookie/Engine owner/admin role, checks the exact **selected** asset/revision and reserves the shared processing slot and collection lock. Authority, expiry and revision are rechecked before returning bytes. No GET download, public static URL, filename/path input or persistent-business adapter is added.
- Binary responses are sanitized PNG or the strict companion ZIP, fixed attachment filename, `private, no-store`, `nosniff`, same-origin CORP and `Vary: Cookie`. CSP and the disabled public Next image optimizer remain unchanged. Browser download object URLs are short-lived anchors only; untrusted original images are never rendered through them.
- `POST /api/demo/logo?...&kind=companion` uses the existing bounded raw-body, origin/cookie/role checks and vault reservation. Import consumes one of the **same 12 upload attempts**, even for invalid archive/hash/decode content. It shares the **two processing slots**, one staged/one selected asset, 2 MiB/session and 32 MiB/global custody bounds, 64 ordinary receipts and reserved cleanup slots. The raw request limit stays 1 MiB; the companion parser enforces the smaller 260 KiB limit inside the reservation. No multipart/archive extraction or separate asset quota exists.
- Identical successful operation-ID/payload retries return current state without applying again. Changed payload/kind, pending or failed retries refuse. A deliberate new import with a fresh operation ID is allowed and consumes another attempt; this portable unsigned format is intentionally reusable, not a one-use token or anti-replay identity proof.
- Exports are read-only, consume no upload attempt/receipt and do not increment revisions. They share processing/collection concurrency controls. An exact repeated read is allowed; this phase does not introduce a separate distributed request-rate limiter. Stale revisions, concurrent writes, expired staged cleanup during export, revoked roles or session expiry refuse. Previously authorized viewers can save already displayed pixels; owner/admin export controls are not DRM.

The private metadata can record that a staged asset passed companion integrity checking and the original PNG digest. That transient marker is not publisher proof, a saved configuration field or an audit export. Re-encoding may produce different bytes with a different reviewed codec version; a later export hashes the actual currently sanitized bytes, not an obsolete input digest. No image content/native diagnostic is logged. Retained buffers are cleared best effort on failure/replacement/removal/expiry; this is not guaranteed erasure of every JavaScript/native/browser copy.

## Failure and remaining work

Changing a chosen file invalidates its previous review. Unsupported/tampered/oversized archives produce an understandable error and no stage/select operation. Failed server processing retains existing selected/staged assets; refresh after stale/private-state errors before an explicit retry. Import authority is evaluated in the receiving session; the file itself is never authorization. Staged custody expires after 10 minutes; selected custody expires with the two-hour demo or server restart. Cleanup keeps quotas/receipts intact and removes only exact scoped assets. No private image enters a database backup, migration report or configuration rollback.

**Unchanged protocols:** BusinessConfig/BuildPlan JSON 1/2, Blueprint ZIP 1/2 (the exact three files), and detached publisher attestation 1 retain their existing bytes/rules. No image bytes, companion digest or local reference is silently embedded in them. No signature/enrollment trust is added. There is no independent latest-version witness or freshness guarantee.

Follow-ups require separate review: durable private real-business custody and retention, production identity/rate-limit/codec isolation acceptance, an explicitly versioned portable branding/configuration/package protocol, and a precise signed image-bearing distribution payload/verification boundary after real publisher enrollment. An independent companion must never be presented as signed merely because it accompanies an authenticated blueprint. Recovery activation, PostgreSQL RLS, historical migration checksums and ForgeOS are unchanged.

[Verification evidence](logo-companions-verification.md) · [Original sanitizer/custody](private-logos.md) · [Publisher boundary](blueprint-provenance.md)
