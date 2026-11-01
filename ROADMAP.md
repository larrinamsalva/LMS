# Public roadmap

LMS is a staged open-source project. Checkboxes describe delivered code, not a hosted service or production certification. Each development phase is reviewed in a separate pull request.

- [x] Independent MIT repository, upstream extraction and dependency/license assessment
- [x] TypeScript configuration/record engine and explicit module manifests
- [x] PostgreSQL organization isolation, role boundaries and append-only audit
- [x] Configuration revisions, non-destructive module disabling and rollback
- [x] Shared fictional property and cleaning workspaces with generated forms
- [x] Accessible themes, responsive layouts, export and automated local checks
- [x] Experimental host-only identity/password adapter and revocable database sessions for provisioned fictional accounts
- [x] Experimental host-only owner membership reviews/confirmation, atomic handover, audits and fictional workspace bootstrap
- [x] Experimental host-only verified password changes, atomic session/approval revocation, credential audits and recent-authentication controls
- [x] Controlled fictional offline recovery: prior trust, two independent signed approvals, atomic reset and audit
- [x] Experimental independent credential-lineage metadata, two-witness checkpoints and offline consistency assessment (activation stays blocked)
- [x] Bounded custodian-only checkpoint publication: independent approvals, synced immutable receipts, interruption detection and exact unexpired resume
- [ ] Independently monotonic high-water witness, fork reconciliation, expired/corrupt-intent repair and rotation
- [ ] Identity-specific recovery acceptance, supported instance transitions, key/role recovery and guarded activation
- [ ] MFA and real-user lifecycle
- [ ] Membership UI and public session/transport acceptance
- [x] Experimental host-only PostgreSQL adapter, local Compose setup, transactional migrations and dedicated network/concurrency tests
- [x] Native fictional backup/restore rehearsal with retained policies/history
- [ ] Production hosting, verified authentication/session security and complete recovery acceptance
- [ ] Complete production backup/restore and validated atomic import
- [x] Shared customer/work references and exclusive-resource scheduling with zones/DST, retained history and responsive agenda
- [x] Fictional employee profiles, dated crew/worker membership, finite work windows/time off and cross-resource employee conflict protection
- [ ] Richer crew permissions, skill certification, recurring work-hour templates, split rosters and multiple-resource appointments
- [x] Shared service/extra catalog, dated area rates and exact-money fictional estimate drafts with pricing snapshots/history/print preview
- [ ] Advanced pricing, currencies and tax models; richer job evidence, property occupancy and maintenance workflows
- [x] Shared whole-unit stock ledger, product/location catalog, exact case conversion, compensating corrections and keyboard-scanner selection
- [ ] Fractional stock, camera scanning, lots/expiry, inventory permissions, equipment and reviewed purchasing
- [ ] Reviewed invoice-draft conversion, exact-money correction history and later production financial acceptance
- [ ] Private documents, reports and scoped attachments
- [ ] Deterministic configurable workflow rules, enabled only after explicit review
- [x] BuildPlan Studio: guided reviewed templates/features, terminology/navigation, optional fields, real Engine previews, temporary draft revisions and validated JSON import/export
- [x] Curated BuildPlan Gallery: five reviewed starters, search/type/feature filters, real previews and unsaved Studio remixes
- [x] Portable data-only blueprint packages, strict integrity/compatibility review and informational Gallery comparisons; unchanged BuildPlan v1 JSON
- [x] Business Branding Studio: versioned safe marks/monograms, tagline, reviewed light/dark palettes, Engine previews and portable v2 configuration with legacy v1 compatibility
- [ ] Secure custom image branding, verified template provenance/history, explicit schema migration UX and executable application packaging
- [ ] Community template submissions, moderation and later marketplace acceptance
- [ ] Tested application export/deployment, verified end-to-end before success claims
- [ ] Optional transparent AI, messaging and payment adapters; manual core remains usable

[Staged plan and acceptance gates](docs/implementation-plan.md). No work on this roadmap authorizes production connections, outbound messages, live invoices, payments or changes to ForgeOS.


## Next reviewable phases

| Track | Next deliverable | Acceptance boundary |
| --- | --- | --- |
| Security/recovery | Independent monotonic witness/receipt custody; signed repair and key/role recovery; later identity-specific acceptance | No activation until the complete recovery, session and permission boundary is demonstrated |
| Business modules | Richer inventory/equipment and separately reviewed pricing/crew extensions; later advanced pricing, richer crew eligibility and reviewed invoice drafts | Shared engine/manifests, organization isolation, concurrency and mobile/accessibility checks; no live finance/messages |
| BuildPlan Studio | Reviewed template provenance/history, deliberate update/migration UX and separately reviewed image-logo storage; later community gallery/AI | Manual use works without AI; fictional preview, reusable configuration, rollback and data ownership; no silent merges |
| Packaging | Tested executable application/self-host packaging beyond the delivered data-only blueprint ZIP | Verify setup/restore and any actual deployment before claiming success; production use stays separately gated |

The business-module and BuildPlan Studio tracks can advance with fictional data while production security work remains blocked. Publication is not permission to activate a restored database or delay every useful demo improvement. See [publication scope/evidence](docs/checkpoint-publication.md) and [the staged plan](docs/implementation-plan.md).


After PR #17: verified template provenance/history and explicit migration review, then separately reviewed image-logo storage, executable app export and business-module extensions. Portable configuration packages preserve customized choices and safe branding without an automatic upgrade path. The guided builder produces validated configuration and real Engine previews using shared customer/work/crew/pricing relationships. Recurrence, external calendars, messaging/payments and AI optimization stay deferred. Security/recovery acceptance remains a separate gate; useful fictional workflows do not activate production services.
