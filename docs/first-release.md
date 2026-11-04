# Install the fictional LMS demo

LMS runs locally with two sample businesses and no login. Use made-up names, work, amounts and images. The demo stores records, draft plans, images and changes in memory. Sessions expire after two hours. Stopping or restarting the server erases all demo workspaces. A saved draft is still temporary.

## Install and start

Use Node.js 24 with npm and Git. Allow roughly 1 GB of free memory for the demo, with additional room for build and browser tests. The lockfile pins the dependencies. Installation needs network access for npm. The running demo needs no account, API key or database service.

From a terminal:

```sh
git clone https://github.com/larrinamsalva/LMS.git
cd LMS
npm ci
npm run build
npm run demo
```

Open **http://127.0.0.1:3000** in a browser on the same computer. Keep the terminal open. Use **Ctrl+C** to stop. Run `npm run demo -- --port 3200` and open **http://127.0.0.1:3200** if port 3000 is occupied. Use the displayed numeric address because writes check the exact origin. The launcher accepts only a port and binds to IPv4 loopback.

Use `npm run dev` for source development. The existing `npm start` also remains available for development and the regular browser tests. The release install uses a Git checkout and npm. Docker was unavailable for launch verification during this phase, so a demo image is deferred. The existing Compose setup is for the separate host-only PostgreSQL lab.

## First visit

1. Choose **Explore the working demo**. Use **Business workspace** to switch between **Property Manager** and **Cleaning Company**. Each has its own fictional records.
2. Open **Customers** and add a made-up name. Open **Cleaning jobs** or **Maintenance requests** and link a new record to that customer. In **Schedule**, add an appointment with the matching customer, work, resource and times. A seeded crew or worker may have restricted hours. Use **Crews & availability** to check them or add a new resource for a resource-only booking.
3. In **Inventory & stock**, use the seeded SKU or select a product, then review and post a fictional movement. In **Estimates**, link an estimate to the customer and work, select the local pricing zone, load a service rate and confirm the amounts.
4. To try optional **Equipment & Tools** or **Invoice Drafts** in a sample workspace, open **BuildPlan Studio** from that workspace, keep its current project, select the features, save the draft and explicitly confirm publication in **Review & try**. Register equipment at an existing stock location. An initial inspection and explicit release are required before checkout. Convert a reviewed estimate through **Create Invoice Draft from Estimate** and verify the **FICTIONAL DRAFT — NOT ISSUED** label.
5. To design a new workspace, open **Build My Business System** or **BuildPlan Studio** and choose a business starter. Choose features in **Features** and edit the business name and branding in **Customize**. Under **Review & try**, prepare an interactive preview and open it in a new tab. Starter previews use their own workspace and begin without sample records.
6. In **Review & try**, use **Export BuildPlan JSON** for configuration. The Blueprint tools can also export a supported ZIP. Reopen a compatible configuration through Studio import and review. Keep the file locally. Configuration exports do not restore business records, sessions or saved history.

## Readiness matrix

| State | Scope | Evidence or boundary |
| --- | --- | --- |
| Working and tested | No-login cleaning/property workspaces, linked customer and work records, daily scheduling, stock ledger, estimates, BuildPlan review/preview/export, light/dark themes | Installed-release workflows plus the regular browser, Foundation and PostgreSQL suites |
| Working with restrictions | Optional equipment, one crew/worker plus one mapped equipment reservation, and invoice drafts | Enable required modules through publication. Inspection, resource, availability, stock and draft confirmation rules still apply. Invoices remain unissued. |
| Working with restrictions | Gallery, scoped previews, configuration history, temporary private logos and data-only portable formats | Bounded sessions, strict version validation and explicit review. Publisher trust enrollment remains empty. |
| Experimental, host-only | Durable PostgreSQL, fictional identity and membership operations, native backup/restore, credential recovery and upgrade rehearsal | Separate local lab. Restored runtime activation remains blocked. |
| Unimplemented | Recurring scheduling, live payment, financial issuance, outbound delivery, executable BuildPlan deployment and real-data migration | See the [roadmap](../ROADMAP.md). |
| Blocked for production | Real-business operation and public deployment | Requires verified user identity and lifecycle, accepted public HTTP/session security, recovery/restore acceptance, operational privacy and retention controls, and separate financial and migration reviews. See [SECURITY](../SECURITY.md). |

## Check the install

```sh
npm run check
npm run test:install
npx playwright install chromium
npm run test:release
npm run test:e2e
```

Run the browser suites one at a time to limit local memory use. The install smoke launches the built demo, verifies the API and browser session contract, stops the process and starts a fresh one. A deterministic integration test separately expires a session without waiting two hours. The release browser suite uses the launcher for both business workflows on desktop, tablet and phone. For native database tests, use the disposable credentials and PostgreSQL tools in the [native test setup](postgres-setup.md) or run the GitHub quality workflow. PR #35 records completed counts, job links and screenshots.

## Screenshots from the installed demo

- [Cleaning appointment with its linked customer and work, desktop light mode](screenshots/first-release/cleaning-schedule-desktop.png)
- [Unissued property invoice draft with its saved estimate revision, phone dark mode](screenshots/first-release/property-invoice-phone-dark.png)

Both captures are from completed workflows using the production build and the local launcher.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| Missing build or incomplete install | Run `npm ci` and `npm run build` again in the checkout. |
| Launcher refuses environment files | Use a clean checkout for the demo. Keep local database or hosting settings in their own workspace. |
| Port already in use | Stop the other local server or choose another port using `--port`. |
| Changes are refused as coming from another page | Open the exact `http://127.0.0.1:PORT` URL printed by the launcher. |
| Expired session or empty records after restart | Start a fresh demo. Import a previously exported configuration if you want to reuse it. |
| Demo capacity reached | Export needed configurations and restart the local server. Protected expired histories can hold one of the 24 runtime slots until restart. |
| Optional feature absent | Check **Features** in the current workspace's BuildPlan and review required dependencies before publishing. |
