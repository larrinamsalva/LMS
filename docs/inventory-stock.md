# Shared inventory and stock ledger

This experimental module uses the same Engine, record relationships, roles, revisions, audit triggers and operation receipts in both fictional industries. No purchasing, vendor payment, accounting, automatic order, invoice or customer message runs. The website remains a separate temporary no-login demonstration; durable storage remains host-only.

## Try the fictional workflow

1. Follow the root README (`npm ci`, `npm run dev`), start the demo, and select **Inventory & stock**. Property begins with water fittings in Maintenance store/Park workshop; cleaning begins with cloths in Supply shelf/Crew kit.
2. **Add product**: name, category, SKU, optional barcode, individual unit label, units per case, minimum stock per location and notes. Owners/admins can edit/archive/restore products and storage locations. SKU is case-insensitive; barcode is exact. Each nonblank identity is unique in the organization, including archived products.
3. **Record stock movement**: choose product, action, whole quantity, Units/Cases, storage location, movement date, reason and optionally a cleaning job or maintenance request. A transfer requires a different destination in the same organization. Review the conversion and confirmation checkbox, then **Post stock movement**.
4. Review available quantities, per-location low-stock warnings and immutable history. Search products by name, category, SKU or barcode; filter stock/history by location. In this phase, all members can read all locations in their own organization; there are no employee-specific location permissions. Foreign organization/location/record-type references refuse in PostgreSQL.
5. To correct a mistake, an owner/admin posts a new compensating movement with an explicit reason and optional **Corrects movement** link. History is never edited, deleted or archived. Use reverse transfers when correcting a transfer; both legs remain atomic. Compensation is explicit, not an automatic reversal or a promise of a single correction per original movement.

### Scanner entry

USB/Bluetooth scanners in keyboard mode may type a code into **Scan or enter barcode / SKU**, then Enter. Match is exact barcode or case-insensitive SKU; blank, unknown, archived or ambiguous matches refuse selection. **Scanning only selects a product.** It never changes stock. Repeated scans do not post movements. Review the preselected product and quantity before confirming a post. There is no debounce policy that could silently discard a legitimate later receipt.

The generated form retains one operation UUID for an unchanged submission, including a lost-response retry. The Engine checks the original receipt before inspecting current packaging. Identical retries return the original record; altered inputs using that UUID refuse. A second deliberate confirmed post gets a new UUID. Hardware devices themselves are not certified by browser emulation. Camera permission/scanning and offline synchronization are follow-ups; the page requests no camera permission.

## Exact quantity and action contract

All stored quantity inputs and exported balances are canonical nonnegative **integer strings** (`"0"`, `"12"`), never floating-point quantities. Movement quantities are positive. Individual units are indivisible in this first phase: fractional liquids/weights, conversion between different unit types, lots/expiry, reservations and valuation are deferred.

`base units = entered whole quantity × saved units per case` for Cases; for Units, `base units = entered whole quantity`. Example: 3 cases × 12 cloths = **36 cloths**; usage of 5 leaves **31**. There is no rounding. Each entered quantity, converted movement and per-product/location balance is bounded by **999,999,999,999**; case size is **1–1,000,000**, default 1 for legacy or blank catalog metadata. Minimum defaults to 0; warnings mean available is **strictly less** than that minimum at each location. Archived locations remain visible with their balances. No quantities are fabricated during migration.

| Action | Source location | Destination | Authorization |
| --- | --- | --- | --- |
| Receiving | Increase | None | Owner/admin/staff |
| Usage | Decrease | None | Owner/admin/staff |
| Return | Increase (physical return into stock) | None | Owner/admin/staff |
| Transfer | Decrease | Equal increase | Owner/admin/staff |
| Adjustment increase/decrease | Explicit increase/decrease | None | Owner/admin |
| Any movement with a correction link | As selected | As selected | Owner/admin |

No action may make stock negative or exceed the limit. A failed destination increase rolls back the source debit, new record, receipt, projections and audit. A return to a supplier is recorded as Usage with a clear reason in this bounded phase. Returns are not capped against a particular past issue; no purchasing/returns accounting is implied.

The catalog's expected product revision is part of each posting request. Changed packaging/name/metadata makes a new stale post refuse; reload and review. Saved history retains the original product name, SKU/barcode, unit, case size, source revision, location names, work title, entered/base quantity, action, reason, authorized actor UUID/display name and operation UUID. Product unit identity cannot change after any movement; create another product for a different base unit. Case size may change for future posts.

Movement date is a declared business date (2020–2100), separate from the immutable database recording timestamp. Balances follow **committed posts**, not a backdated reconstructed chronology. A backdated Usage cannot spend stock that is currently unavailable. Time-zone/DST scheduling behavior remains unchanged.

Archived products/locations retain stock and all history. They cannot participate in new movements until restored. Historic stock links do not prohibit catalog archival or erase prior customer/job links. Other active relationships keep their existing archive protections. Restoration never reapplies old movements. Staff cannot manage catalog metadata; viewer cannot post; descriptive employee roles grant no access.

## PostgreSQL and upgrade

Migration **010_inventory_ledger.sql** adds forced-RLS `lms.stock_balances` and `lms.stock_movements`, scoped composite foreign keys and indexes. Runtime gets SELECT only on projections. The existing organization mutation epoch serializes catalog changes, archive operations, posts and raw SQL writers; its actual row version also rejects stale REPEATABLE READ writers. This intentionally serializes one organization's writes for correctness at foundation scale; finer-grained locks require a reviewed phase.

Source `stock-movements` records refuse every UPDATE/DELETE/archive. The existing source-record audit and original-input receipt commit in the same transaction as the two projections. A movement requires an operation ID even from raw runtime SQL. Duplicate raw operation IDs fail and roll back any tentative balances. Private definer helpers have an empty search path and no PUBLIC/runtime execution. Direct projection or receipt DML stays denied.

The additive migration replaces the existing relationship guard with one narrow archive exception: incoming **immutable stock movements** count as historical links. All other guard logic is retained. Applied migrations 1–9 remain unchanged. It preserves legacy items/configurations and creates zero opening balances. Existing description-only configurations still work; adding fields to populated entities requires a separately reviewed configuration/schema migration. This PR does not silently rewrite their fields or fabricate opening counts. The expanded presets apply to new fictional workspaces.

Beginner local durable setup remains [the Compose/PostgreSQL guide](postgres-setup.md). For an already initialized fictional database:

```sh
# Use the existing local .env.postgres and exact fictional database name.
npm run db:backup -- --database lms_development --file /absolute/path/inventory-before.dump
# Stop all LMS runtime/auth hosts and keep the backup outside the data directory.
npm run db:migrate -- --database lms_development
```

Use the guide's full backup/restore commands and confirmation prompts. Do not change applied SQL or force adoption. Hosts must stop: exclusive maintenance and table locks refuse concurrent runtime leases. All pending schema and migration ledger entries commit together. Untracked stock entities/duplicate identities refuse enrollment; rehearse and review rather than deleting history. There is no destructive down migration. Stock-ledger module activation/writes refuse on databases missing migration 10.

The public demo loads business migrations 1,7,8,9,10 in an isolated in-memory PGlite database. It does not load identity/recovery schemas, read persistent backend credentials or enable persistent HTTP business routes. The existing 24-session/250-record/two-hour caps remain; movements count toward 250 and are never silently truncated. Workspace exports include stock balances/movements; JSON is an export, not an accepted restore/import protocol.

Native PostgreSQL backup/restore includes the ledger, balances, receipts and audits. **Every supported restore remains activation-blocked**, including a successful inventory inspection. No inventory path repairs or bypasses recovery/credential protections. Database superusers/host administrators remain a trust boundary: an append-only runtime ledger does not protect against a compromised administrator rewriting backups/tables. The credential lineage external anchors have their existing separate scope; they do not sign operational stock history.

See [verification](inventory-stock-verification.md), [API](api.md), [security](../SECURITY.md) and [roadmap](../ROADMAP.md). PostgreSQL's [integer types](https://www.postgresql.org/docs/16/datatype-numeric.html) and [transaction isolation](https://www.postgresql.org/docs/16/transaction-iso.html) document the underlying exact arithmetic and conflict behavior; the LMS contract above is the bounded application policy.
