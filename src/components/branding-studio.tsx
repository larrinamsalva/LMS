import {
  brandingVariables,
  brandingSchema,
  defaultBranding,
  palettes,
  paletteIds,
  logoMarks,
  type Branding,
} from "../core/branding";
import { type BusinessConfig } from "../core/config";
import { BusinessIdentity } from "./business-brand";
import { CustomLogoStudio, type LogoController } from "./private-logo";
export function BrandingStudio({
  config,
  onChange,
  logoController,
  organizationId,
  canManageLogo,
}: {
  config: BusinessConfig;
  onChange: (config: BusinessConfig) => void;
  logoController: LogoController;
  organizationId: string;
  canManageLogo: boolean;
}) {
  const brand = config.branding ?? defaultBranding(config.industry),
    valid = brandingSchema.safeParse(brand);
  function update(patch: Partial<Branding>) {
    onChange({ ...config, schemaVersion: 2, branding: { ...brand, ...patch } });
  }
  return (
    <section
      className="studio-review branding-studio"
      aria-labelledby="brand-heading"
    >
      <h3 id="brand-heading">Brand Your Business</h3>
      <p>
        Give your fictional workspace a professional identity. These are unsaved
        choices; the current workspace keeps its published appearance.
      </p>
      <label htmlFor="studio-name">Business name</label>
      <input
        id="studio-name"
        aria-describedby="brand-name-help"
        value={config.name}
        maxLength={80}
        required
        onChange={(e) => onChange({ ...config, name: e.target.value })}
      />
      <p className="muted" id="brand-name-help">
        Your business display name appears in the dashboard header. Use
        fictional, plain text.
      </p>
      <label className="check-label">
        <input
          type="checkbox"
          checked={!!config.branding}
          onChange={(e) => {
            if (e.target.checked) update({});
            else {
              const { branding: _branding, ...rest } = config;
              onChange({ ...rest, schemaVersion: 1 });
            }
          }}
        />{" "}
        Include business branding in this BuildPlan
      </label>
      <p className="muted">
        Branding uses BuildPlan 2 / configuration schema 2 / package 2. Existing
        version-1 files remain supported. Turn this off to use the original LMS
        appearance and export a legacy plan.
      </p>
      <fieldset disabled={!config.branding}>
        <legend>Business identity</legend>
        <div className="form-grid">
          <div>
            <label htmlFor="brand-tagline">Tagline or slogan (optional)</label>
            <input
              id="brand-tagline"
              value={brand.tagline ?? ""}
              maxLength={120}
              onChange={(e) => update({ tagline: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="brand-monogram">Monogram or initials</label>
            <input
              id="brand-monogram"
              value={brand.monogram}
              maxLength={4}
              onChange={(e) =>
                update({ monogram: e.target.value.toUpperCase() })
              }
            />
            <small>
              1–4 letters A–Z or numbers. Retained when an icon is selected.
            </small>
          </div>
          <div>
            <label htmlFor="brand-mark">Logo mark</label>
            <select
              id="brand-mark"
              value={brand.mark}
              onChange={(e) =>
                update({ mark: e.target.value as Branding["mark"] })
              }
            >
              {Object.entries(logoMarks).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="brand-appearance">
              Default workspace appearance
            </label>
            <select
              id="brand-appearance"
              value={brand.appearance}
              onChange={(e) =>
                update({ appearance: e.target.value as Branding["appearance"] })
              }
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
            <small>
              A viewer's saved light/dark preference takes priority.
            </small>
          </div>
        </div>
      </fieldset>
      <fieldset disabled={!config.branding}>
        <legend>Reviewed professional palettes</legend>
        <p>
          Choose primary, secondary and accent colors together. Their light and
          dark variants keep text and controls readable; arbitrary color/CSS
          entry is unavailable.
        </p>
        <div className="studio-cards">
          {paletteIds.map((id) => (
            <label className="studio-card" key={id}>
              <span className="check-label">
                <input
                  type="radio"
                  name="business-palette"
                  value={id}
                  checked={brand.palette === id}
                  onChange={() => update({ palette: id })}
                />{" "}
                <strong>{palettes[id].name}</strong>
              </span>
              <small>{palettes[id].purpose}</small>
              <span className="brand-swatches" aria-hidden="true">
                {["primary", "secondary", "accent"].map((role) => (
                  <span
                    key={role}
                    style={{
                      backgroundColor:
                        palettes[id].light[
                          role as "primary" | "secondary" | "accent"
                        ],
                    }}
                  />
                ))}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {!valid.success && (
        <p className="error" role="alert">
          Use a reviewed palette/mark, plain single-line tagline and 1–4
          uppercase letters or numbers for the monogram. Save/export/Engine
          preview require valid branding.
        </p>
      )}
      <CustomLogoStudio controller={logoController} canManage={canManageLogo} />
      <h4>Immediate light and dark appearance</h4>
      <p className="muted">
        These identity samples use the same marks and palette tokens as the
        workspace. Use Prepare workspace preview on the Review step to try the
        actual shared Engine.
      </p>
      <div className="studio-cards">
        {(["light", "dark"] as const).map((mode) => (
          <div
            className="brand-example"
            key={mode}
            data-theme={mode}
            aria-label={`${mode} branding sample`}
            style={brandingVariables(
              { ...defaultBranding(config.industry), palette: brand.palette },
              mode,
            )}
          >
            <p className="eyebrow">{mode} appearance</p>
            <BusinessIdentity
              name={config.name || "Your business"}
              branding={brand}
              logo={(logoController.state?.staged ?? logoController.state?.selected) ? { organizationId, asset: (logoController.state?.staged ?? logoController.state?.selected)! } : undefined}
            />
            <div className="brand-sample-nav">
              Customers · Selected navigation
            </div>
            <span className="brand-sample-action">Sample action</span>
            <dl className="brand-colors">
              {(["primary", "secondary", "accent"] as const).map((role) => (
                <div key={role}>
                  <dt>{role}</dt>
                  <dd>{palettes[brand.palette][mode][role]}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      <p className="muted">
        Portable branding uses built-in marks and text only. Private session image previews are temporary. No image URL, HTML, scripts, external font or SVG upload is accepted.
      </p>
    </section>
  );
}
