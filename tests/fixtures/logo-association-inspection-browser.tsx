/** Test-only presentation harness. Responses are fixtures; native authorization/persistence is tested separately. */
import { createRoot } from "react-dom/client";
import { BusinessIdentity } from "../../src/components/business-brand";
import { defaultBranding, brandingVariables } from "../../src/core/branding";
import type { LogoAsset } from "../../src/core/private-logo";
import { validateConfig } from "../../src/core/config";
import { logoAssociationInspection } from "../../src/core/logo-associations";
export function render(org: string, asset: LogoAsset, responses: unknown[]) {
  const root = createRoot(document.getElementById("result")!);
  const states = responses.map((r) => logoAssociationInspection.parse(r));
  const config = validateConfig(states[0].configuration);
  const branding = config.branding ?? defaultBranding(config.industry);
  function paint(theme: "light" | "dark", index = 0, layout = asset.display) {
    const inspection = states[index];
    root.render(
      <div
        className="app"
        data-theme={theme}
        style={brandingVariables(branding, theme)}
      >
        <main className="stack studio" style={{ padding: "1.5rem" }}>
          <h1>Private branding association inspection</h1>
          <p>
            Test-only host presentation fixture. Synthetic responses and pixels
            use the shared branding renderer. Native PostgreSQL tests separately
            verify binding, history, permissions and restoration. No persistent
            image route is installed.
          </p>
          <section className="panel" aria-label="Current published identity">
            <h2>Fictional property business</h2>
            <BusinessIdentity
              name="Fictional Meadow Park"
              branding={branding}
              logo={
                inspection.status === "active"
                  ? {
                      organizationId: org,
                      asset: { ...asset, display: layout },
                    }
                  : undefined
              }
            />
            <p role="status">
              {inspection.status === "active"
                ? "Explicitly associated private image · host inspection only"
                : inspection.status === "configuration-changed"
                  ? "Configuration changed · built-in mark until explicit new review"
                  : "Explicit built-in fallback · retained history preserved"}
            </p>
            <dl>
              <dt>Published configuration revision</dt>
              <dd>{inspection.configurationRevision}</dd>
              <dt>Association revision</dt>
              <dd>{inspection.revision}</dd>
              <dt>Reviewed layout</dt>
              <dd>{layout}</dd>
            </dl>
            <p>
              No portable branding publication, activation or recovery approval
              is implied.
            </p>
          </section>
          <div className="actions">
            <button
              type="button"
              onClick={() =>
                paint(theme === "light" ? "dark" : "light", index, layout)
              }
            >
              Switch inspection theme
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                paint(
                  theme,
                  index,
                  layout === "square" ? "rectangle" : "square",
                )
              }
            >
              Inspect other contained layout
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => paint(theme, 1, layout)}
            >
              Show stale-configuration response
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => paint(theme, 2, layout)}
            >
              Show explicit built-in response
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => paint(theme, 0, layout)}
            >
              Show reviewed association response
            </button>
          </div>
          <p>
            These buttons inspect fixture responses. They do not publish, bind,
            replace, roll back or alter any database.
          </p>
        </main>
      </div>,
    );
  }
  paint("light");
}
