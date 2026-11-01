import { useEffect, useRef, useState } from "react";
import {
  filterGallery,
  galleryWorkflows,
  reviewedGallery,
  remixGalleryEntry,
  type GalleryEntry,
} from "../core/gallery";
import { moduleRequirements, type BuildPlan } from "../core/buildplan";
import { manifests, plannedModules } from "../modules/registry";
const types = {
  property: "Property Management",
  cleaning: "Cleaning Business",
  custom: "General / Custom Business",
};
export function BuildPlanGallery({
  busy,
  onBack,
  onCustomize,
  onPreview,
}: {
  busy: boolean;
  onBack: () => void;
  onCustomize: (plan: BuildPlan, name: string) => void;
  onPreview: (plan: BuildPlan) => Promise<string>;
}) {
  const [entries] = useState(reviewedGallery),
    [query, setQuery] = useState(""),
    [type, setType] = useState("all"),
    [feature, setFeature] = useState("all"),
    [pending, setPending] = useState<string | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [previews, setPreviews] = useState<Record<string, string>>({});
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const shown = filterGallery(entries, query, type, feature),
    working = busy || pending !== null;
  async function preview(entry: GalleryEntry) {
    setPending(entry.metadata.id);
    setError("");
    setNotice("");
    try {
      const url = await onPreview(remixGalleryEntry(entry));
      setPreviews((p) => ({ ...p, [entry.metadata.id]: url }));
      setNotice(
        `Preview ready for ${entry.metadata.name}. Open the real workspace in a new tab.`,
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not prepare this template preview.",
      );
    } finally {
      setPending(null);
    }
  }
  return (
    <div className="stack studio" aria-label="BuildPlan template gallery">
      <section className="panel">
        <span className="eyebrow">
          Curated BuildPlan Gallery · fictional starters
        </span>
        <div className="section-heading">
          <h2 ref={heading} tabIndex={-1}>
            Browse Business Templates
          </h2>
          <button
            type="button"
            className="secondary"
            disabled={working}
            onClick={onBack}
          >
            Return to my Studio choices
          </button>
        </div>
        <p>
          Find a starting configuration for the work you do. These blueprints
          use existing reviewed LMS modules; they are not complete industry
          applications.
        </p>
        <p className="muted">
          Browsing and previewing preserve your Studio choices. Customize copies
          a template into new unsaved choices, replacing only the choices
          currently in the editor. Saved plans, published configurations and
          business records are retained.
        </p>
        <div className="form-grid">
          <div>
            <label htmlFor="gallery-search">Search business templates</label>
            <input
              id="gallery-search"
              type="search"
              value={query}
              maxLength={200}
              placeholder="Try cleaning, maintenance or estimates"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="gallery-business-type">Business type</label>
            <select
              id="gallery-business-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="all">All business types</option>
              {Object.entries(types).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="gallery-feature">Includes feature</label>
            <select
              id="gallery-feature"
              value={feature}
              onChange={(e) => setFeature(e.target.value)}
            >
              <option value="all">Any included feature</option>
              {manifests
                .filter((m) =>
                  entries.some((e) =>
                    e.plan.configuration.modules.some((n) => n.id === m.id),
                  ),
                )
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <p role="status">
          {shown.length} {shown.length === 1 ? "template" : "templates"} match.{" "}
          {pending ? "Preparing a fictional workspace…" : notice}
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <p className="muted">
          Preview Template uses the same Engine-powered preview as Studio. The
          existing three-fresh-preview session limit applies across both
          screens. During this Studio visit, unchanged successful previews are
          reused. Reloading does not reset the server quota. Export your plan
          before this temporary demo expires.
        </p>
      </section>
      {shown.length ? (
        <div className="studio-cards gallery-cards">
          {shown.map((entry) => {
            const { metadata, plan } = entry,
              modules = plan.configuration.modules,
              enabled = new Set(modules.map((m) => m.id)),
              disabled = [
                "scheduling",
                "workforce",
                "estimates",
                "inventory",
              ].filter((id) => !enabled.has(id));
            return (
              <article
                className="studio-card"
                aria-label={metadata.name}
                key={metadata.id}
              >
                <span className="eyebrow">
                  {types[plan.template]} · Starter · Revision{" "}
                  {metadata.revision}
                </span>
                <h3>{metadata.name}</h3>
                <p>{metadata.purpose}</p>
                <h4>Included modules</h4>
                <ul className="gallery-modules">
                  {modules.map((m) => (
                    <li key={m.id}>
                      {manifests.find((n) => n.id === m.id)?.name ?? m.id}
                    </li>
                  ))}
                </ul>
                <h4>Supported starting workflows</h4>
                <ul>
                  {metadata.workflows.map((w) => (
                    <li key={w}>{galleryWorkflows[w].name}</li>
                  ))}
                </ul>
                {disabled.length > 0 && (
                  <p className="muted">
                    Not enabled:{" "}
                    {disabled
                      .map(
                        (id) => manifests.find((m) => m.id === id)?.name ?? id,
                      )
                      .join(", ")}
                    . You can add supported features in Studio.
                  </p>
                )}
                <details>
                  <summary>Dependencies included</summary>
                  <ul>
                    {modules
                      .filter(
                        (m) =>
                          moduleRequirements(plan.configuration, m.id).length >
                          0,
                      )
                      .map((m) => (
                        <li key={m.id}>
                          {manifests.find((n) => n.id === m.id)?.name}:{" "}
                          {moduleRequirements(plan.configuration, m.id)
                            .map(
                              (id) =>
                                manifests.find((n) => n.id === id)?.name ?? id,
                            )
                            .join(", ")}
                        </li>
                      ))}
                  </ul>
                  <p className="muted">
                    Missing dependencies or unsupported versions make a bundled
                    template invalid. Studio automatically includes required
                    features when you change its module choices.
                  </p>
                </details>
                <details>
                  <summary>Scope and limitations</summary>
                  <ul>
                    {metadata.limitations.map((text) => (
                      <li key={text}>{text}</li>
                    ))}
                  </ul>
                </details>
                <div className="actions gallery-actions">
                  <button
                    className="secondary"
                    type="button"
                    disabled={working}
                    onClick={() => void preview(entry)}
                  >
                    Preview Template
                  </button>
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => {
                      try {
                        onCustomize(remixGalleryEntry(entry), metadata.name);
                      } catch {
                        setError(
                          "This template no longer matches the reviewed BuildPlan contract.",
                        );
                      }
                    }}
                  >
                    Customize This Template
                  </button>
                </div>
                {previews[metadata.id] && (
                  <a
                    href={previews[metadata.id]}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open {metadata.name} preview (new tab)
                  </a>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <section className="panel">
          <h3>No reviewed starter matches these choices.</h3>
          <p>
            Try a broader search or another business type. Filters only match
            enabled modules, not features you might add later.
          </p>
          <button
            className="secondary"
            type="button"
            onClick={() => {
              setQuery("");
              setType("all");
              setFeature("all");
            }}
          >
            Clear template filters
          </button>
        </section>
      )}
      <section className="panel subdued">
        <h3>What comes later?</h3>
        <p>
          {plannedModules.join(" · ")} · Community submissions · Marketplace ·
          AI generation · Hosting/deployment. These cannot be enabled by
          selecting a template. The gallery only supplies reviewed starter
          configurations; all production identity, recovery and financial gates
          remain.
        </p>
      </section>
    </div>
  );
}
