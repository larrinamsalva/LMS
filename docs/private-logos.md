# Private custom logo previews

Custom Business Logo adds a **temporary image overlay**, not a new portable branding format. It uses the existing fictional no-login demo session, organization membership and shared Engine workspace. BusinessConfig, branding, BuildPlan/ZIP v1/v2 and detached attestation v1 are unchanged. No image reference or bytes enter those formats, saved drafts, publication, rollback, migration reports or business record exports.

## Try a fictional logo

1. Start the local application using the README. Open **Build My Business System → Customize → Brand Your Business**. Use a synthetic fictional logo, never a real customer's image, personal photo, document or production business asset.
2. Under **Custom Business Logo**, select a PNG, JPEG or WebP from your device. Selection alone does not upload it. **Sanitize and stage logo** sends the bytes to this application's private demo service for validation and re-encoding. Filenames/MIME declarations are not trusted or retained.
3. Review the sanitized image in the shared light/dark identity samples. Choose **Square** or **Rectangle**; both contain the whole image rather than cropping it. The workspace identity remains unchanged while an image is merely staged.
4. Explicitly **Use staged logo for this session**. The current organization's header, sidebar and dashboard identity now show the sanitized image with a temporary/not-published label. No configuration revision or business record changes.
5. Choose another file and stage it. The selected image stays in the workspace until **Replace session logo with staged image**. **Remove staged image** discards only that draft asset. **Use built-in logo for this session** removes the selected overlay and shows the existing reviewed mark/monogram. Exact image IDs and current private revisions protect these actions.
6. **Refresh private logos** after a stale operation or failure. Another tab's changes are never overwritten using an old revision. Identical successful operation retries do not apply twice; conflicting or failed attempts require a fresh reviewed action.

The samples use the same `BusinessIdentity`/`BusinessLogo` components as the real Engine-powered workspace. A separately prepared Engine preview is a **new organization** and deliberately receives no private image. It keeps its portable built-in identity; source image IDs cannot be read through its organization. There is no automatic cross-organization asset copying. The later [separate logo companion](logo-companions.md) supports deliberate download/re-sanitized import under the receiving session's authority.

Saving/exporting/publishing a BuildPlan still saves **built-in marks and text only**. Uploading or selecting an image does not dirty or rewrite that plan. Export/import and publisher signatures retain their exact existing bytes; a valid publisher signature cannot install or authorize a logo. Standalone image sharing uses a [strict unsigned companion v1](logo-companions.md); portable branding publication still needs a separately reviewed, explicitly versioned configuration/package protocol. No automatic version upgrade or downgrade occurs here.

## Reviewed intake limits

| Boundary | Limit/behavior |
| --- | --- |
| Raw upload | Nonempty, at most 1,048,576 streamed bytes (1 MiB); raw binary, no multipart files or filesystem extraction |
| Reviewed inputs | Static PNG, JPEG and WebP recognized by actual signatures and bounded container checks, then confirmed by native decode |
| Dimensions/pixels | At most 4096 per side and 1,048,576 declared/decoded input pixels; Sharp input limits remain enabled |
| Frames | Single frame only; APNG chunks, WebP animation flags/chunks, MPO and concatenated JPEGs refuse |
| Metadata bounds | JPEG metadata at most 64 KiB; bounded WebP metadata; compressed PNG text/profile chunks (`zTXt`, `iTXt`, `iCCP`) are unsupported and refused before decoding |
| Output | Re-encoded sRGB static PNG, at most 512×512 and 262,144 bytes; EXIF/XMP/ICC/IPTC/comments are not retained |
| Processing | At most two simultaneous jobs in the demo runtime; native processing timeout 3 seconds, strict warnings/truncation handling, no relaxed pixel/unlimited options |
| Custody | At most one selected and one staged image per organization; 2 MiB per session and 32 MiB globally, with conservative in-flight reservations |
| Attempts/history | 12 upload attempts and 64 ordinary operations per organization/session, including failed decode attempts; two reserved exact removal receipts keep cleanup possible at the limit |

Export metadata-free PNG if a compressed PNG profile/text chunk is refused, or use a supported JPEG/WebP. Some otherwise valid files outside this narrow profile are intentionally unsupported. Input filenames, browser MIME labels and extension changes cannot make HTML, SVG, GIF, TIFF, a URL or arbitrary bytes into a supported raster. No arbitrary URL reaches Sharp, a filesystem path resolver, an image optimizer or a remote fetch.

`sharp` **0.35.5** was already locked with Next.js and is now a direct pinned runtime dependency, not an optional capability. Native libvips **8.18.7** was observed locally. Its cross-request operation cache is disabled for private-pixel custody; pipelines are destroyed and retained intake buffers cleared after processing. Sharp is Apache-2.0; optional binary dependency licenses, including libvips LGPL components, remain in the regenerated [188-entry inventory](dependencies.json). Preserve installed dependency notices/licenses when redistributing. This is a reviewed bounded codec boundary, not an operating-system sandbox or a claim against unknown native decoder vulnerabilities. Production hosting would need a separate codec/update, isolation, rate-limit and resource-acceptance review.

Primary implementation guidance: [Sharp security](https://sharp.pixelplumbing.com/security/), [constructor/input limits](https://sharp.pixelplumbing.com/api-constructor/), [default metadata removal](https://sharp.pixelplumbing.com/api-output/). No image generation service, public object store, external fonts or paid hosting is used.

## Private service and permissions

`/api/demo/logo` is tied exclusively to the existing in-memory PGlite demo runtime, never to a configured persistent PostgreSQL database. Every read/mutation first resolves the existing random HttpOnly, SameSite=Strict demo cookie, checks organization inclusion and asks the real Engine for its current membership/role. Owner/admin authority is required to stage/select/layout/remove, and is checked again after processing. Authorized members can read selected identity images; only owners/admins can see staged images. A URL/UUID alone is not authority. There is no public static asset path or public persistent-business upload route.

POST/PATCH reuse existing same-origin checks. The shared bounded request reader measures actual streamed bytes even if Content-Length is forged or absent; JSON command fields/UUIDs/revisions are strict allowlists. Cross-site fetches refuse. Binary responses are always sanitized `image/png`, `nosniff`, `private, no-store` and `Cross-Origin-Resource-Policy: same-origin`, varying on Cookie. The renderer constructs only the fixed same-origin route from validated UUIDs, never an imported URL. It uses raw authenticated image requests. Next's optimizer is explicitly disabled (`images.unoptimized`); its endpoint returns 404 even with an authorized cookie, preventing an alternative public proxy/cache path. CSP is unchanged; no `blob:`, remote image host or script permission is added.

Private vault revision/receipt metadata is not part of Engine audit/configuration exports. Original filenames, image metadata, input bytes, native decoder errors and image contents are never logged. Configuration comparison, migration/rehearsal reports and ordinary database backups cannot see this separate asset vault. Sanitization cannot identify sensitive text deliberately embedded in visible pixels; use fictional content only.

## Lifecycle, expiry and failure

| State | Meaning / next action |
| --- | --- |
| Device selection | Browser holds the chosen local File until explicit staging; no raw-image preview or server storage yet |
| Sanitizing | Bounded private processing reservation; current selected/staged assets remain unchanged on decode/auth/quota failure |
| Staged | Sanitized bytes visible to owners/admins in that organization, expiring after 10 minutes or session expiry |
| Selected | Explicitly chosen overlay visible to authorized members of that organization until replacement, removal, session expiry or process restart |
| Replaced/removed/expired | Retained vault buffers are cleared and references removed; asset IDs are never reused or restored by a retry |

Reads/actions check expiry immediately; a 60-second unref'd sweep also releases expired in-memory custody while idle. Session cleanup drops only that session's assets. The browser refreshes at known stage/session deadlines; an expired session clears its overlay. Stale revisions, a busy processor, wrong IDs, changed operation payloads and unknown ownership refuse without touching another image. Failed operations cannot silently become successful retries. Quotas do not reset on deletion or a second browser tab.

There is no asset delete-by-path, filesystem cleanup, external storage bucket, restored image attachment, public migration executor or database deletion operation. Removal identifies the exact current organization/session asset and revision. Buffer clearing is best effort for retained server buffers, not guaranteed erasure of every native/JavaScript memory copy or already authorized browser pixels. Host memory/debuggers/crash dumps and previously viewed/downloaded images require separate production custody controls. A missing, expired, denied, broken or unavailable image renders the reviewed built-in mark and readable business name; image failure never replaces business records/configuration.

The existing demo expires after two hours or restart and is unsuitable for persistent or multi-instance real-business storage. No production account, recovery activation, schema transformation, migration checksum, RLS policy, public authentication endpoint or ForgeOS file is changed.

[Verification commands, scope and screenshots](private-logos-verification.md) · [Portable branding contract](business-branding.md) · [Security](../SECURITY.md)
