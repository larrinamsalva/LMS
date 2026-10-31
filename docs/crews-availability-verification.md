# Crew and availability verification

PR #11 reuses the record/scheduling engine, configuration forms, role checks, transaction epoch, audit and exact-retry infrastructure. Verification is fictional and host-only; no production account, business endpoint, payment, outbound service or recovery activation is enabled.

Local and GitHub CI results will be recorded from actual completed checks before review readiness. Native PostgreSQL tests are required and never skipped. The new cases cover multi-person crews, individual identity/cross-crew conflicts, time-off and membership/profile races, stale snapshots, unauthorized/foreign writes, reschedule/restore and retained history, exact retries, additive migration and native backup/restore with activation blocked. All existing scheduling, identity, recovery, credential-lineage and checkpoint-publication suites remain enabled.

Known limits: one resource per appointment; finite work windows rather than weekly recurrence; stable whole-appointment crew membership; skills are descriptive; unenrolled PR #10 resources reserve no employee identity. Browser device emulation and automated accessibility checks do not certify every real device or assistive technology. See the [full contract and trust boundary](crews-availability.md).
