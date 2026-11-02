/** Presentation fixture only; no production asset loader, runtime attachment, credentials or trust override. */
import { createRoot } from "react-dom/client";
import { BusinessIdentity } from "../../src/components/business-brand";
import { defaultBranding, brandingVariables } from "../../src/core/branding";
import type { LogoAsset } from "../../src/core/private-logo";
export function render(org: string, asset: LogoAsset) {
  const root = createRoot(document.getElementById("result")!),
    branding = defaultBranding("cleaning");
  function paint(theme: "light" | "dark", image = true) {
    root.render(
      <div
        className="app"
        data-theme={theme}
        style={brandingVariables(branding, theme)}
      >
        <main className="stack studio" style={{ padding: "1.5rem" }}>
          <h1>Private logo inspection fixture</h1>
          <p>
            Host-only storage is verified separately by native PostgreSQL tests.
            This synthetic, temporary inspection uses the shared branding
            renderer and a test-only transport. Durable assets are unavailable
            through the public demo.
          </p>
          <section className="panel" aria-label="Authorized image inspection">
            <h2>Retained fictional logo</h2>
            <BusinessIdentity
              name="Fictional Local Cleaners"
              branding={branding}
              logo={image ? { organizationId: org, asset } : undefined}
            />
            <p>
              Stored image · future selection only · no published branding
              association
            </p>
            <p>
              Contained layout: {asset.display} · {asset.width} × {asset.height}{" "}
              pixels
            </p>
          </section>
          <div className="actions">
            <button
              type="button"
              onClick={() => paint(theme === "light" ? "dark" : "light", image)}
            >
              Switch inspection theme
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => paint(theme, false)}
            >
              Use built-in inspection identity
            </button>
          </div>
        </main>
      </div>,
    );
  }
  paint("light");
}
