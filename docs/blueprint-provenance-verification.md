# Blueprint provenance verification evidence

PR #23 introduces detached attestation v1; ZIP v1/v2 and BuildPlan v1/v2 remain unchanged. This document will record the final measured local and GitHub results before review.

## Tested boundaries

- Real Ed25519 signing and verification with **newly generated ephemeral test keys**, explicitly supplied as test-only trust. No real publisher identity/key has been established or signed a release.
- Unchanged v1 fixture and branded v2 exact ZIP round trips; canonical payload/file bytes, independent Node signer and browser Web Crypto verifier.
- Altered valid ZIPs, forged signatures, unknown/retired keys, unsupported algorithm/version, incompatible signed claims, unsafe signed modules/dependencies, malformed/duplicate/extra/unsafe JSON, Unicode/BOM/size limits and input/trust snapshot races.
- Host signing helper: private owned files/directories, correct public/private pairing, exact independently reviewed digest, explicit confirmation, no overwrite, interrupted partial output refusal and secret-free detached output. Actual CLI unsigned inspection and default-registry signing refusal. Successful CLI signing under a real enrolled key is **not** claimed.
- Shared Engine integration and native PostgreSQL forced-RLS tests: verification changes no records, audits or configuration; staff/viewer/other organization cannot save/publish; populated customer schema still blocks; stale saved revisions refuse; histories and the other organization remain intact.
- Actual Studio browser import: unknown claims and unsupported algorithms/oversized files refuse without modifying saved drafts/configuration/records; deliberate unsigned import displays accurate integrity/compatibility/publisher status and retains normal preview/use-as-unsaved controls.
- Positive browser crypto/component test: intercepted test-only page bundles the **same verifier and status component**, passes an ephemeral public test registry explicitly, and checks verified status, forged/retired refusal and accessibility in both themes across all viewports. It installs no app route, no public trust switch and no private key in browser code. This does **not** claim a positive real-publisher Studio import, since the shipped registry is empty.

## Final results

Pending final verification. No PostgreSQL or restore success is claimed from local tooling; the existing real PostgreSQL CI job remains required. Screenshots and exact job links/counts are added after the final source revision passes.
