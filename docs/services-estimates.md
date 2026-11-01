# Services, rates and fictional estimate drafts

The optional `estimates` module extends the existing record engine, scoped references, generated forms, role checks, revisions, audit and operation receipts. The same catalog and estimate implementation powers cleaning and property-maintenance examples. Estimates remain **fictional internal drafts**. No invoice issuance, payment request, customer message, production business endpoint or recovery activation is implemented.

## Beginner workflow

Run the existing local setup (`npm ci`, `npm run dev`) and open the no-login fictional demo. Each temporary workspace includes services, local/outer-area rates and a linked internal draft. The demo still expires after two hours or process restart; durable storage is available through the existing separate host-only PostgreSQL adapter, never through a public business route.

1. Open **Services & Rates**. Add a pricing zone/service area with a business-defined name. Zones are explicit price areas, not automatically inferred from an address or an IANA time zone.
2. Add a service name, description, optional category, pricing method and unit. **Fixed** requires quantity 1; **Hourly**, **Per unit** and **Quantity** multiply the rate by the entered quantity. The latter three share arithmetic but retain their business labels/units. Quantities support up to three decimal places.
3. An optional **Extra** identifies one base Service. Add a separate rate for the extra; it can be selected only alongside its matching base service. Extras cannot be parents of other extras.
4. Add a saved **Service rate**: service, pricing zone, USD unit price, effective-from date and optional **exclusive** effective-until date. One non-archived rate may cover a service/area on a date. Close the previous period before adding a new one; adjacent ranges are allowed. Different areas can have different prices.
5. Open **Estimates → Add estimate draft**. Choose a customer, optional linked cleaning job/maintenance request and appointment, area and pricing date. Add line items and select saved services/extras. Applicable prices load automatically. No default-area fallback, geocoding or price guessing occurs.
6. Enter quantities, optional line/estimate notes and a single overall amount or percentage discount. Choose **None** for no tax, or explicitly enter a **Manual** exclusive tax rate and label. Review the displayed calculation and confirm **fictional internal draft only** before saving.
7. Use **Preview / print** to inspect the saved snapshot or a historical revision. The print view clearly states that it is not an invoice, payment request or customer communication. Browser printing is local; no PDF service or outbound integration is used.

Owners/admins alone can write catalog records or estimates. Staff/viewers can read same-workspace fictional records and previews. Profile work titles never grant these permissions. This is not a real employee/financial privacy model or public authentication/session acceptance.

## Exact money contract

This bounded first phase uses **USD with two minor-unit digits**. Prices, totals, discount amounts and tax amounts are canonical nonnegative **integer strings in cents**. For example, API `amount: "3500"` is displayed as `USD 35.00`; it is not a JSON floating-point number. Rates may be zero. The maximum unit price, line amount, subtotal and final total is `999999999999` cents. Unsupported/overflowing results fail rather than wrap or clamp.

The UI parses decimal strings without `Number`, floating-point multiplication or `toFixed` for money. Quantities are positive, at most 1,000,000, scaled to thousandths using integer arithmetic. Fixed services require exactly 1. A draft contains 1–10 uniquely identified lines, bounded by the existing 32 KiB source-record limit. Very long service descriptions/notes can require fewer lines.

Calculation order is explicit:

1. Each line: multiply rate cents by quantity thousandths, divide by 1000 and round **half up** to cents.
2. Subtotal: sum the already rounded line amounts.
3. Discount: a fixed cent amount, or subtotal × integer basis points / 10000 rounded half up. A discount cannot exceed subtotal; percentage discounts are 0–100% with two decimal places.
4. Net: subtotal minus discount.
5. Manual tax: net × integer basis points / 10000 rounded half up. Tax is exclusive and 0–100% with two decimal places; a manual label is required. None requires zero rate and an empty label.
6. Total: net plus rounded tax; all bounds are checked.

Example: `1001` cents × `0.5` hours rounds to `501`; 10% discount rounds to `50`; 8.25% manual tax on `451` rounds to `37`; total is `488` cents. Negative amounts, exponent notation, NaN/infinity, fractional cents, excess quantity precision and mixed/unrecognized currency are rejected.

TypeScript uses `BigInt`; PostgreSQL independently computes with exact `numeric`/integer operations and validates every stored snapshot/total. References: [ECMAScript BigInt](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-ecmascript-language-types-bigint-type), [PostgreSQL numeric types](https://www.postgresql.org/docs/16/datatype-numeric.html). No locale-sensitive PostgreSQL `money` type or binary floating-point monetary calculation is used. Manual tax is explicit fictional configuration, **not automated tax-law compliance**. Inclusive, compound, jurisdictional, line-specific and exempt-tax rules are deferred.

## Snapshot and revision rules

Each saved line retains its service/rate IDs and revisions, name, description, category, unit, method, extra relationship, area label, effective dates and unit cents. Customer/work/appointment display labels are captured when the draft is created. Later catalog/label changes do not rewrite those saved snapshots.

Existing lines can change quantity/line notes while retaining their original prices and descriptions, even after their catalog rate is archived or expires. Remove/add a line to explicitly select current catalog pricing. New line selections carry expected service and rate revisions; a price or description change before saving causes a conflict requiring reload/review, never a silently different price. New lines require an active service/rate in the selected area/date.

Customer/work/appointment/area/pricing-date identity stays fixed after creation; create another draft for a different context. Work must have a typed customer link and match the draft's customer; appointments must match customer and optional work. Quoted work retains its customer relationship even when its estimate is archived. Active estimate references block customer/work/appointment/area archive under the existing shared rules. Historical catalog snapshots allow rate/service archive without deleting the estimate; archive active child rates/extras before their parent service. Restoring an estimate rechecks its ordinary record relationships; restoring a rate also rechecks overlapping effective periods.

| Current status | Allowed behavior |
| --- | --- |
| New | Create as an unarchived Draft only |
| Draft | Edit content; explicitly save Reviewed draft or Void |
| Reviewed draft | Content locked; save Draft unchanged to reopen, or Void unchanged |
| Void | Terminal; retained read/preview/archive/restore history only |

All statuses are internal draft states, not customer acceptance, signature or authorization to issue an invoice. Each save/archive/restore appends a record revision, standard audit and a protected `estimate_versions` snapshot. Historical versions can be previewed; there is no destructive rollback or history overwrite.

## Transaction, permissions and retries

Migration `009_service_estimates.sql` adds trigger-maintained rate/line projections and retained estimate versions with organization-scoped foreign keys, forced RLS and read-only runtime grants. A GiST exclusion enforces active service/area date-range uniqueness. Source guards independently restrict writes to owners/admins, enforce relationships/status/price rules and reject forged totals/snapshots. Ordinary roles cannot change projections/history directly.

The existing organization lock and private record epoch order catalog changes, snapshot preparation, configuration publication and record mutation. The host-only `lms.prepare_estimate` checks owner/admin authorization and advances that epoch before selecting rates; the source trigger checks the resulting snapshot again in the same transaction. Frozen REPEATABLE READ writers fail instead of accepting stale catalog evidence.

Use the existing `Engine.saveRecord(..., existing?, operationId?)` and `archiveRecord` arguments. The new `estimate` field accepts selection input (rate IDs/revisions, quantities, discount/tax and explicit acknowledgement). Client-supplied derived fields are stripped; database snapshots and totals are authoritative. `lms.prepare_estimate` is an internal database interface, not a public HTTP endpoint.

Receipts bind the **original normalized selection**, not a later catalog price. Retry the identical intent with its same UUID after an uncertain response: the original saved result is returned even if catalog prices later changed. Altered requests, another actor, stale revisions and new stale selections refuse. Derived pricing is independently verified before source/audit/receipt/version/line metadata commit atomically. Failed transactions retain the prior draft and history. Callers without an operation UUID do not have a duplicate-submission guarantee. UI controls preserve a UUID for unchanged retries and require renewed fictional-draft confirmation for each opened edit.

Workspace snapshots and the version-1 JSON export add `estimateVersions`; JSON export is still not a validated import or full backup guarantee. Native PostgreSQL stores the records/projections/receipts durably across adapter restarts and native backup/restore. Every restored database remains activation-blocked under the existing credential/recovery/publication controls.

## Setup and remaining limits

For the public fictional demo no database account or new service is required. It loads shared business migrations 1, 7, 8 and 9 in its own temporary PGlite database, separate from identity and persistent business storage.

For an existing local fictional PostgreSQL database: back up, stop identity/business hosts and run the normal `npm run db:migrate -- --database lms_development` using the separate local migration administrator. Migration 9 takes the maintenance/table locks and applies transactionally. Applied migrations 1–8 stay unchanged; untracked preexisting pricing entities refuse upgrade for a reviewed transition. The Engine refuses pricing activation/writes before migration 9. Existing configuration/data are not silently rewritten; enable compatible new entity definitions explicitly or use a fresh fictional preset.

See [verification](services-estimates-verification.md), [database setup](../db/README.md) and [roadmap](../ROADMAP.md). Estimates do not schedule employees, change appointments, issue invoices, collect money or send messages. Advanced tier/minimum pricing, automatic service-area mapping, currencies/conversion, line-level discounts/tax, signed approval, invoice conversion, recurring services and richer printing/export are later phases. Inventory movements and BuildPlan Studio are the next business foundations. Production access and recovery activation remain separately gated.
