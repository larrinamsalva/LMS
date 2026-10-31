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
- [ ] Audited lost-access recovery implementation (offline procedure designed), MFA and real-user lifecycle
- [ ] Membership UI and public session/transport acceptance
- [x] Experimental host-only PostgreSQL adapter, local Compose setup, transactional migrations and dedicated network/concurrency tests
- [x] Native fictional backup/restore rehearsal with retained policies/history
- [ ] Production hosting, verified authentication/session security and complete recovery acceptance
- [ ] Complete production backup/restore and validated atomic import
- [ ] Customer relationships, staff/crew assignments and scheduling with conflict protection
- [ ] Property occupancy and maintenance workflows; cleaning rates, quotes and job evidence
- [ ] Stock movement ledger, equipment and purchasing
- [ ] Estimate/invoice drafts with exact money, authorization, confirmation and correction history
- [ ] Private documents, reports and scoped attachments
- [ ] Deterministic configurable workflow rules, enabled only after explicit review
- [ ] Guided builder: industry/workflow questionnaire, field/nav editor and branding upload
- [ ] Tested application export/deployment, verified end-to-end before success claims
- [ ] Optional transparent AI, messaging and payment adapters; manual core remains usable

[Staged plan and acceptance gates](docs/implementation-plan.md). No work on this roadmap authorizes production connections, outbound messages, live invoices, payments or changes to ForgeOS.
