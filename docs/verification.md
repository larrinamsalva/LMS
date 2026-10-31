# Foundation verification evidence

Verified locally on 2026-10-31 using Node **24.22.1**, npm **11.9.0**, Next.js **16.4.3**, PGlite **0.5.14**, Playwright **1.64.1** and installed **Chromium 153.0.8010.0**. The default Playwright Chromium 156 download returned a 195-byte HTML error page in this environment; the documented `PLAYWRIGHT_CHROMIUM_EXECUTABLE` override ran a real installed Chromium instead. This difference is not concealed as testing the default downloaded binary.

Story: a visitor starts an isolated fictional business workspace → API validates cookie/origin/input → the shared engine validates configuration/data → PostgreSQL checks membership/RLS and records an audit event → the refreshed UI renders the saved record and retains it after reload within the same session.

| Boundary / check | Local evidence |
| --- | --- |
| TypeScript and route contracts | `npm run typecheck` passed |
| Unit + database integration/security | `npm test`: **12 passed**, four files; actual SQL policies run under `lms_app` |
| Dependency inventory | `npm run licenses:check`: **123** lockfile package declarations verified |
| Current registry advisory scan | `npm audit --json`: **0** reported vulnerabilities on review date; not proof of future absence |
| Production compilation | `npm run build` passed; dynamic page + demo route + CSP proxy |
| Browser → API → database → UI | `npm run test:e2e`: **8 passed**, desktop 1440×1000 and phone 390×664 CSS viewport (iPhone 13 device profile, Chromium) |
| Shared engine / industry differences | Property site/unit flow and cleaning job/service-date/crew records use the same generated form, API, service and SQL |
| Retained edits | Create, edit, refresh, archive and restore verified through browser controls |
| Configuration changes | Disable supply catalog, retain/export hidden rows, restore revision and see original rows; project and workspace downloads work |
| Isolation / authorization | Direct SQL cross-org SELECT returns zero rows; cross-org INSERT fails; UPDATE affects no rows; viewer writes, staff config/membership edits, anonymous reads, identity reassignment and audit/config deletion fail |
| Browser security | Foreign origin, absent cookie, forged organization, second-session scope and unsupported invoice action rejected; CSP nonce present |
| Accessibility / responsive | Axe WCAG 2 A/AA + 2.1 AA reported **0 violations** in light workspace and dark customer form; no horizontal document overflow on both viewports. Keyboard skip link and initial form focus checked |
| Visual inspection | Desktop/phone dark form screenshots inspected; labels/fields remain readable and controls fit. Screenshots are test outputs, not deployed pages |
| Source separation | Reference ForgeOS checkout remains clean at `5831e20023c8f2f1e7269bbfb63b6ba0f21ee3b8`; no writes or deployment to ForgeOS |

A browser test caught a real boundary failure: Next.js normalizes loopback request URLs to localhost, so comparing Origin to `request.url` alone rejected 127.0.0.1. The fix preserves the actual loopback Host, ignores forwarded-host assertions, requires exact origin, and requires explicit origin configuration for non-loopback use. A unit regression test and successful full browser run cover the correction. Script CSP nonces are generated per request; no unsafe-inline scripts are enabled in production.

## Limits

No network PostgreSQL concurrent-load, real identity provider, hosted Supabase/Data API/Storage, persistent-disk recovery, packaged distribution, live invoice/message/payment/AI or deployment acceptance was performed. The app is an in-memory fictional-data demo, not a real-business service. Automation does not establish complete accessibility compliance; manual assistive-technology and wider device testing remain necessary. Browser profile emulation is not physical iOS/Safari testing.

GitHub CI status is a separate remote result, not inferred from these local checks. CI is configured for typecheck/unit/SQL/license/build and desktop/phone browser verification. Pull requests must be reviewed and merged manually.
