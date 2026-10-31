import { useState } from "react";
import { validateConfig, type BusinessConfig } from "../core/config";
import type { WorkspaceSnapshot } from "../core/engine";
import { manifests, plannedModules } from "../modules/registry";
export function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ProjectPanel({
  workspace,
  busy,
  onPublish,
  onExport,
}: {
  workspace: WorkspaceSnapshot;
  busy: boolean;
  onPublish: (config: BusinessConfig, restoredFrom?: number) => Promise<void>;
  onExport: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(workspace.config.document);
  const [error, setError] = useState("");
  const enabled = new Set(draft.modules.map((m) => m.id));
  async function publish(config: BusinessConfig, restoredFrom?: number) {
    setError("");
    try {
      await onPublish(validateConfig(config), restoredFrom);
    } catch (err) {
      setError(
        err instanceof Error && err.name !== "ZodError"
          ? err.message
          : "This configuration is invalid. Check module dependencies.",
      );
    }
  }
  return (
    <div className="stack">
      <section className="panel">
        <span className="eyebrow">Project configuration · schema v1</span>
        <h2>A workspace that fits the work</h2>
        <p className="muted">
          This small configuration editor demonstrates the engine. The guided
          website builder is planned.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void publish(draft);
          }}
        >
          <label htmlFor="project-name">Business name</label>
          <input
            id="project-name"
            value={draft.name}
            required
            maxLength={80}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <div className="form-grid terminology">
            <div>
              <label htmlFor="customer-singular">
                Customer term · singular
              </label>
              <input
                id="customer-singular"
                value={
                  draft.entities.find((e) => e.id === "customers")?.singular ??
                  ""
                }
                required
                maxLength={80}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    entities: draft.entities.map((entity) =>
                      entity.id === "customers"
                        ? { ...entity, singular: e.target.value }
                        : entity,
                    ),
                  })
                }
              />
            </div>
            <div>
              <label htmlFor="customer-plural">Customer term · plural</label>
              <input
                id="customer-plural"
                value={
                  draft.entities.find((e) => e.id === "customers")?.plural ?? ""
                }
                required
                maxLength={80}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    entities: draft.entities.map((entity) =>
                      entity.id === "customers"
                        ? { ...entity, plural: e.target.value }
                        : entity,
                    ),
                  })
                }
              />
            </div>
          </div>
          <fieldset>
            <legend>Optional modules</legend>
            <div className="module-grid">
              {manifests
                .filter((m) => draft.entities.some((e) => e.module === m.id))
                .map((module) => (
                  <label className="module-option" key={module.id}>
                    <input
                      type="checkbox"
                      checked={enabled.has(module.id)}
                      disabled={["customers", "tasks"].includes(module.id)}
                      onChange={(event) => {
                        const modules = event.target.checked
                          ? [
                              ...draft.modules,
                              { id: module.id, version: module.version },
                            ]
                          : draft.modules.filter((m) => m.id !== module.id);
                        const selected = new Set(modules.map((m) => m.id));
                        setDraft({
                          ...draft,
                          modules,
                          navigation: [
                            ...draft.navigation.filter((id) =>
                              selected.has(
                                draft.entities.find((e) => e.id === id)!.module,
                              ),
                            ),
                            ...draft.entities
                              .filter(
                                (e) =>
                                  e.module === module.id &&
                                  event.target.checked &&
                                  !draft.navigation.includes(e.id),
                              )
                              .map((e) => e.id),
                          ],
                        });
                      }}
                    />
                    <span>
                      <strong>{module.name}</strong>
                      <small>{module.description}</small>
                    </span>
                  </label>
                ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Navigation order</legend>
            <ol className="navigation-order">
              {draft.navigation.map((id, index) => (
                <li key={id}>
                  <span>{draft.entities.find((e) => e.id === id)?.plural}</span>
                  <button
                    className="quiet"
                    type="button"
                    disabled={index === 0}
                    aria-label={`Move ${id} up`}
                    onClick={() => {
                      const navigation = [...draft.navigation];
                      [navigation[index - 1], navigation[index]] = [
                        navigation[index],
                        navigation[index - 1],
                      ];
                      setDraft({ ...draft, navigation });
                    }}
                  >
                    Move up ↑
                  </button>
                </li>
              ))}
            </ol>
          </fieldset>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="actions">
            <button disabled={busy} type="submit">
              Apply configuration
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => {
                try {
                  downloadJson("lms-project.json", validateConfig(draft));
                } catch {
                  setError("Check configuration before saving.");
                }
              }}
            >
              Save project JSON
            </button>
          </div>
        </form>
      </section>
      <section className="panel">
        <h2>Configuration history</h2>
        <p className="muted">
          Restoring appends a new revision. Existing records are retained.
        </p>
        <ul className="history">
          {workspace.history.map((item) => (
            <li key={item.revision}>
              <span>
                Revision {item.revision} · {item.document.name}
                {item.restored_from
                  ? ` · restored from ${item.restored_from}`
                  : ""}
              </span>
              {item.revision === workspace.config.revision ? (
                <strong className="badge">Current</strong>
              ) : (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void publish(item.document, item.revision)}
                >
                  Restore revision {item.revision}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <h2>Your data stays yours</h2>
        <p className="muted">
          Export includes this workspace’s records, archived and disabled-module
          records, configuration and revision history. It is an application
          export; full backup and restore are future work.
        </p>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void onExport().catch((err) => setError(err.message))}
        >
          Export workspace JSON
        </button>
      </section>
      <section className="panel subdued">
        <h2>On the roadmap</h2>
        <p className="muted">
          {plannedModules.join(" · ")}. These modules are unavailable in this
          foundation. No invoices, messages, payment processing or AI actions
          run here.
        </p>
        <a href="https://github.com/larrinamsalva/LMS/blob/feat/configurable-foundation/ROADMAP.md">
          View the public roadmap ↗
        </a>
      </section>
    </div>
  );
}
