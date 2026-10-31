# Contributing

Keep the engine independent of an industry or hosted vendor. Start with a small issue or proposal describing the workflow and acceptance checks. Work on a feature branch and open a small pull request. Never auto-merge, change ForgeOS, connect production databases, issue real invoices/messages or activate payments as part of routine development.

Use Node 22+, `npm ci`, and `npm run check`. For UI changes, build and run `npm run test:e2e` on desktop/phone, inspect screenshots and test keyboard focus and both themes. SQL/authorization changes need direct negative tests as the unprivileged application role; UI filtering is not isolation. Put fictional data in fixtures. Do not commit credentials, customer data, environment files, generated builds, screenshots or test outputs.

Pin exact dependencies and commit the lockfile. Run `npm run licenses`, review every new license and `npm audit`, and preserve applicable LICENSE/NOTICE files. Dependency metadata is not proof that a packaged binary meets redistribution obligations. Keep the API, examples, roadmap and verification record accurate; state limitations and unrun checks.

Business configuration is data: no scripts, raw SQL or arbitrary remote plugins. New modules need a manifest, declared dependencies/capabilities, configuration validation and migration/uninstall/data-retention behavior. Avoid duplicating UI/service/database code for another industry. Finance must use exact values and immutable correction histories in its own reviewed module, never float totals or generic record edits.

By contributing you license your contribution under MIT and confirm you have the right to contribute it. Retain attribution for reused code. Include problem/result, material limits and actual validation evidence in the PR description.
