# Fictional invoice drafts

Invoice drafting is an **optional reviewed module**, disabled in existing starters, Gallery snapshots, saved BuildPlans and businesses. It creates no issued invoice, receipt, payment request, customer message or accounting entry. Every invoice screen and printable preview says **FICTIONAL DRAFT — NOT ISSUED**. USD/manual-tax demonstrations are not legal or tax compliance certification.

## Try the fictional workflow

1. Run `npm ci`, `npm run dev` and open the local no-login demo. Existing setup and isolation limits still apply.
2. In BuildPlan Studio, choose features and explicitly select **Invoice Drafts**. Its reviewed dependency is **Services & estimates**, which requires Customers. Save a draft and use the existing impact review and explicit publication confirmation to enable it. A real Engine preview can also test an independent fictional configuration; preview/session quotas are unchanged.
3. In **Services & Rates**, maintain dated prices for named service areas. Create an estimate with a customer and optional work/appointment, review its exact amounts, then save its status as **Reviewed draft**.
4. Choose **Create Invoice Draft from Estimate**, inspect the saved services, quantities, customer and total, check the acknowledgement, and confirm. Open the result in **Invoice Drafts**.
5. Search by title, saved customer or work; filter Draft/Void. Open/print the current draft or any financial revision. Printing retains the unissued label and hides application controls.
6. Choose **Correct draft** to amend quantities, line notes, internal notes, discount or explicit manual tax. Supply a reason and confirm. Previous values remain unchanged. **Void draft** similarly requires a reason/confirmation and is terminal.

Fixed services require quantity 1. Hourly, per-unit and quantity modes allow the existing three-decimal positive quantity range. This bounded first phase retains line identities/order, service/rate descriptions and prices; it does not add/remove/reprice invoice lines, rename drafts or change their customer/work/source. Start a separately reviewed estimate for different work. An estimate may produce **one invoice draft across all its revisions**, including after that draft is voided. No automatic replacement or financial adjustment runs.

## Engine and database contract

`Engine.writeInvoiceDraft(principal, organizationId, command, operationId)` reuses the existing adapter, trusted host principal, roles and transaction. Commands are strict `convert`, `correct` or `void` data with an exact configuration revision and literal fictional acknowledgement. Conversion additionally pins current estimate ID/revision. Corrections/void pin current invoice ID/revision and require an 8–500 character reason. Never accept a client-supplied principal for persistent operation.

Migration **016_invoice_drafts** adds no existing-organization configuration and changes none of migrations 001–015. With all runtime hosts stopped, apply it explicitly using the documented `npm run db:migrate` maintenance workflow. Existing backup, migration checksum and native-readiness inventory checks include the new tables. Fictional public demo initialization loads the additive module into its independent temporary PGlite database; it never reads persistent database credentials.

The existing `lms.records` row stores the current draft, its fixed unissued notice and typed links; `lms.invoice_origins` permanently binds the exact `lms.estimate_versions` source and permits one draft per estimate; `lms.invoice_versions` appends full snapshots, configuration revision, actor, operation and time. The shared `record_operations` table stores exact receipts. Existing record/audit triggers still retain financial before/after snapshots. New history/source tables force RLS, use organization-scoped foreign keys and permit members to read only their organization's history; owners/admins alone mutate through the reviewed command. Neither application roles nor ordinary record save/archive actions can edit/delete financial history.

The command locks the organization before checking current membership, fences the shared record epoch, verifies the current configuration and source, and atomically writes the draft, links, origin, version, audit and receipt. Raw-write guards independently derive permitted data; arbitrary totals, source links and unsupported transitions refuse. A failed transaction commits none of those effects. Ownership commands use the same organization lock. Concurrent raw writes may conservatively receive a serialization/deadlock refusal and require fresh review.

Exact committed retries by the same currently authorized actor return the original receipt, including after subsequent corrections. Changed request/actor/operation reuse refuses. A new operation against an already converted estimate refuses. An ambiguous response should be retried with the **same exact request and operation ID**, never a newly generated conversion ID. The UI retains its operation ID while the validated request remains unchanged.

## Exact pricing and record protection

Conversion copies the entire already validated estimate pricing snapshot, including customer/work display snapshots, dated area, catalog versions, extras and totals. It never consults today's rates. Corrections call the existing estimate selection/calculation implementation with retained snapshots. TypeScript uses BigInt; PostgreSQL uses exact numeric/integer arithmetic. Both preserve the existing half-up per-line rounding, discount next, and exclusive manually configured tax on net. Values remain bounded to 999,999,999,999 USD minor units. No foreign exchange or automated tax policy is added.

Scoped links prevent foreign or missing customers/work/sources. New conversion requires active related records; existing links and histories cannot be destructively archived away. Linked work retains its customer. Disabling the module hides the workspace area while retaining records, origins, revisions, receipts and audits; authorized exports/native backups still include them. Re-enabling uses ordinary configuration publication. Populated entity schema changes, configuration rollback, saved-plan revision controls and migration blockers are unchanged.

The optional reviewed `invoice-drafts` 1.0.0 manifest and entity extension fit existing BusinessConfig/BuildPlan 1/2 readers: it is only added when explicitly selected. No historical starter or portable envelope is rewritten, upgraded or downgraded. Older installations lacking the module correctly refuse its capability. Existing Blueprint ZIP 1/2, image companions, bundles and detached signatures remain unchanged; existing unsigned/signed fixtures continue through their original validators. New package checksums/signatures necessarily describe the actual chosen configuration.

## Recovery and remaining gates

Native PostgreSQL tests exercise same-schema `pg_dump`/`pg_restore` into a separate disposable quarantined fictional database, comparing origins, every correction, records, links, configuration revisions, receipts and audits. Source state must remain unchanged. Restored RLS remains scoped and the normal runtime adapter must refuse activation. This is not production recovery, a schema transformation, independently anchored financial nonrepudiation or protection against a compromised administrator/rollback of every backup.

Persistent operations remain trusted **host-only fictional PostgreSQL** calls. The only HTTP command added is inside the existing cookie/origin/organization-scoped temporary public demo. No persistent-business route, real-user transport acceptance, live issuance, payment, tax certification, messaging or recovery activation is supplied. Host principals still require independently verified authentication before any future persistent transport. Permissions and explicit acknowledgement are intent controls, not a legal signature or independent financial approval. Production financial acceptance, retention/privacy policy, invoice identifiers/issuance, line restructuring, credit/correction accounting and external integrations need separate design and authorization.

[Actual verification](invoice-drafts-verification.md) · [PostgreSQL setup](postgres-setup.md) · [Original pricing rules](services-estimates.md)
