# LMS v0.1 fictional demo release candidate

LMS, the Living Management System, is an MIT-licensed, configurable workspace inspired by ForgeOS. The v0.1 source candidate runs a fictional cleaning company and property manager on your own computer. Both workspaces use the same engine and keep separate records.

| Area | What you can try |
| --- | --- |
| Daily work | Add sample customers, link cleaning jobs or maintenance requests, book appointments and review resources and crew availability. |
| Supplies and tools | Record stock receipts and usage, and optionally enable equipment registration, inspection and checkout. |
| Pricing | Review fictional estimate drafts and optionally convert one to an unissued invoice draft. |
| BuildPlan Studio | Choose a business starter, set features and branding, preview in a separate workspace, and save or explicitly publish a temporary demo configuration. |
| Keep a configuration | Export BuildPlan JSON or a supported Blueprint ZIP for later import and review. These files carry configuration. Business records, session access and operational history stay in the temporary workspace. |

See the [Windows guide](install-windows.md) or [Node/npm install and walkthrough](first-release.md). The release workflow checks a clean source archive on Windows and Linux using Node.js 24. The PR records the exact candidate commit, actual job results and screenshots. Automated shutdown checks verify process exit and port reuse. The Windows runner stops its own test process through the operating system, so this check does not simulate pressing Ctrl+C in a desktop console. The browser viewports simulate desktop, tablet and phone in Chromium. macOS, physical mobile devices, other browsers, Docker and desktop installers are outside this verification.

## Source candidate and integrity

The Linux release-install job creates a review artifact named **fictional-source-candidate**. It includes a source ZIP, `source.txt` with the package version and full commit, and `SHA256SUMS` for the inner ZIP. Both platform jobs build from an extracted source ZIP of that commit. Install dependencies with `npm ci` so the committed lockfile controls their versions.

The ZIP contains committed source, tests and fictional fixtures, migration definitions, documentation, the npm lockfile, MIT license and third-party/ForgeOS attribution. Git export rules omit environment files (including lab examples), common key/backup paths, dependency folders, build products and local test output. Untracked local files are outside the Git archive. Review the tracked contents before distribution, especially for credentials, private data or database exports under unexpected names. Dependency binaries are fetched during installation. This source ZIP runs LMS itself. BuildPlan exports describe a configuration to reopen in LMS.

To reconstruct the same source from a Git checkout, run `git archive --format=zip --prefix=LMS/ --output=LMS-0.1.0-source.zip COMMIT` with the full reviewed commit in place of `COMMIT`. Use the published checksum for the exact distributed ZIP because archive tooling can produce different bytes from the same source.

Open the verification run for the reviewed commit and obtain the ZIP and checksum record together. Before extracting, compare the full commit in `source.txt` to the reviewed commit on GitHub and check the ZIP hash. On Windows, run this in the folder containing the downloaded files:

```powershell
Get-FileHash -Algorithm SHA256 .\LMS-0.1.0-source.zip
Get-Content .\SHA256SUMS
```

Compare every hex character, ignoring case. On Linux, run `sha256sum --check SHA256SUMS` from that folder. Stop if the digest differs. The checksum detects a mismatch against the independently obtained reference. Publisher identity and signing-key custody remain a separate release process.

## Release checklist

Before manual publication, confirm each item for the **final merged commit**. An open PR's checks are review evidence. Use the successful main-branch run for the exact source to distribute.

- [ ] Verify a clean checkout, typecheck, foundation tests, production build and dependency license check.
- [ ] Verify native PostgreSQL isolation, audit and recovery regressions in the disposable lab.
- [ ] Verify Windows and Linux locked install, archive extraction, localhost launch, restart and port release. Verify desktop, tablet and phone workflows, including light/dark and keyboard interactions.
- [ ] Record the candidate commit, checksums, completed job links and screenshots.
- [ ] Review the source archive contents and make sure the guide and fictional-use warning accompany the download.
- [ ] Obtain separate maintainer approval to create the tag and publish the release.

The candidate evidence belongs in the review PR. If any required job fails or is missing at the release commit, hold publication. A signed source manifest, Docker image, macOS verification and additional browser coverage are optional follow-up work. The production gates below remain separate from fictional demo acceptance.

## Manual GitHub release after approval

1. Verify the accepted version and commit on `main`, and copy the link to that commit's successful quality run. Download its source candidate and verify the full commit and hash as described above.
2. In **Releases → Draft a new release**, select or create the approved tag (for example, `v0.1.0`) at that exact commit. Use the title **LMS v0.1 fictional demo** and choose **pre-release** if publishing a candidate.
3. Attach the reviewed source ZIP, `source.txt` and `SHA256SUMS`. Link the install guide, release notes, verification run and screenshots. Include the following wording in the release description before publishing.

> Fictional data only. Use this local demo with made-up names, records, amounts and images. Sessions expire after two hours and stopping or restarting clears demo data. Export a configuration to keep your setup choices. Keep the demo on your own computer. Real customer records, credentials and financial information belong outside this demo.

Public or real-business operation remains blocked pending verified real-user identity and access, production HTTP and session security, recovery and restore acceptance, privacy and retention controls, and separate financial and migration reviews. The experimental native PostgreSQL lab remains host-only and restored runtime activation remains blocked. [Security policy](../SECURITY.md)
