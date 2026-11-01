"use client";
import { useEffect, useRef, useState } from "react";
import {
  activeEntities,
  type BusinessConfig,
  type RecordData,
} from "../core/config";
import type { WorkspaceRecord, WorkspaceSnapshot } from "../core/engine";
import { Schedule, relatedLabel } from "./schedule";
import { Workforce } from "./workforce";
import { recordWriteRoles } from "../core/permissions";
import { money, type EstimatePricing } from "../core/pricing";
import { displayTime } from "../core/time";
import { RecordForm } from "./record-form";
import { EstimateForm } from "./estimate-form";
import { Catalog, Estimates } from "./pricing-workspace";
import { downloadJson, ProjectPanel } from "./project-panel";
type DemoResponse = {
  session: {
    organizations: { id: string; industry: "property" | "cleaning" }[];
    expiresAt: number;
  };
  workspace: WorkspaceSnapshot;
};
async function jsonRequest(url: string, input?: unknown) {
  const response = await fetch(
    url,
    input
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }
      : { cache: "no-store" },
  );
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error ?? "The request could not be completed.");
  return value;
}
export function Workspace() {
  const [data, setData] = useState<DemoResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [view, setView] = useState<
    | "records"
    | "project"
    | "activity"
    | "schedule"
    | "workforce"
    | "catalog"
    | "estimates"
  >("records");
  const [selected, setSelected] = useState("customers");
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editor, setEditor] = useState<WorkspaceRecord | "new" | null>(null);
  const archiveOperation = useRef("");
  const [archive, setArchive] = useState<WorkspaceRecord | null>(null);
  useEffect(() => {
    let active = true;
    try {
      if (localStorage.getItem("lms-theme-v1") === "dark") setTheme("dark");
    } catch {
      /* preference is optional */
    }
    void fetch("/api/demo", { cache: "no-store" })
      .then(async (response) => {
        if (response.ok) {
          const value = await response.json();
          if (active) setData(value);
        }
      })
      .catch(() => {
        /* Start demo remains available. */
      });
    return () => {
      active = false;
    };
  }, []);
  async function mutate(input: unknown, message = "") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setData(await jsonRequest("/api/demo", input));
      setNotice(message);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "The request failed.";
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }
  async function switchWorkspace(organizationId: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setData(
        await jsonRequest(
          `/api/demo?organizationId=${encodeURIComponent(organizationId)}`,
        ),
      );
      setView("records");
      setSelected("customers");
      setQuery("");
      setShowArchived(false);
      setEditor(null);
      setArchive(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load workspace.",
      );
    } finally {
      setBusy(false);
    }
  }
  const workspace = data?.workspace;
  const config = workspace?.config.document;
  const entities = config ? activeEntities(config) : [];
  const entity = entities.find((e) => e.id === selected) ?? entities[0];
  const records =
    workspace?.records.filter(
      (r) =>
        r.entity === entity?.id &&
        r.archived === showArchived &&
        Object.values(r.data).some((v) =>
          String(v).toLowerCase().includes(query.toLowerCase()),
        ),
    ) ?? [];
  const canWrite = workspace
    ? ["owner", "admin", "staff"].includes(workspace.role)
    : false;
  const canEditEntity =
    !!workspace &&
    !!entity &&
    recordWriteRoles(entity.id).includes(workspace.role);
  const canAdmin = workspace
    ? ["owner", "admin"].includes(workspace.role)
    : false;
  const Editor = entity?.id === "estimates" ? EstimateForm : RecordForm;
  function openRecord(entityId: string, record?: WorkspaceRecord) {
    setSelected(entityId);
    setView("records");
    setEditor(record ?? "new");
    setArchive(null);
    setError("");
  }
  function archiveRecord(record: WorkspaceRecord) {
    setSelected(record.entity);
    setView("records");
    setEditor(null);
    setArchive(record);
    archiveOperation.current = crypto.randomUUID();
    setError("");
  }
  function changeView(next: typeof view, entityId?: string) {
    setView(next);
    if (entityId) setSelected(entityId);
    setEditor(null);
    setArchive(null);
    setQuery("");
    setNotice("");
    setError("");
  }
  return (
    <div className="app" data-theme={theme}>
      <a className="skip-link" href="#main">
        Skip to workspace
      </a>
      <div className="demo-banner">
        <span className="status-dot" /> Fictional-data demo{" "}
        <span className="banner-detail">
          · No account required · Resets after two hours or server restart
        </span>
      </div>
      <header className="topbar">
        <a className="brand" href="/" aria-label="LMS home">
          <span className="brand-mark" aria-hidden="true">
            L<span>•</span>
          </span>
          <span>
            LMS<small>Living Management System</small>
          </span>
        </a>
        <div className="topbar-actions">
          <a
            className="source-link"
            href="https://github.com/larrinamsalva/LMS"
          >
            Open source ↗
          </a>
          <button
            type="button"
            className="theme-toggle secondary"
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            onClick={() => {
              const next = theme === "light" ? "dark" : "light";
              setTheme(next);
              try {
                localStorage.setItem("lms-theme-v1", next);
              } catch {
                /* optional */
              }
            }}
          >
            {theme === "light" ? "☾" : "☀"}
            <span>{theme === "light" ? "Dark" : "Light"}</span>
          </button>
        </div>
      </header>
      {!data ? (
        <main id="main" className="welcome">
          <span className="eyebrow">
            An open foundation for small businesses
          </span>
          <h1>
            Your business.
            <br />
            Your way.
          </h1>
          <p className="welcome-copy">
            A shared engine that adapts to the work you do. Start with a
            property or cleaning workspace, shape the records, and keep control
            of your data.
          </p>
          <div className="actions">
            <button
              disabled={busy}
              onClick={() => void mutate({ action: "start" }).catch(() => {})}
            >
              {busy
                ? "Preparing your workspace…"
                : "Explore the working demo →"}
            </button>
            <a
              className="text-link"
              href="https://github.com/larrinamsalva/LMS#readme"
            >
              Read the setup guide ↗
            </a>
          </div>
          <p className="muted">
            Use made-up information only. No billing, messaging, AI or payment
            services are connected.
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="welcome-cards">
            <article className="panel">
              <span className="card-number">01 / PROPERTY</span>
              <h2>Keep a place running.</h2>
              <p>
                Customers, sites and units, maintenance tasks, supply records.
              </p>
            </article>
            <article className="panel">
              <span className="card-number">02 / CLEANING</span>
              <h2>Make the day flow.</h2>
              <p>
                Customers, service jobs, crew notes, tasks and supply records.
              </p>
            </article>
            <article className="panel">
              <span className="card-number">ONE SHARED ENGINE</span>
              <h2>Built to be yours.</h2>
              <p>
                MIT licensed. Configurable modules. No mandatory cloud account.
              </p>
            </article>
          </div>
        </main>
      ) : (
        <div className="workspace-shell">
          <aside className="sidebar">
            <div className="workspace-picker">
              <label htmlFor="business-workspace">Business workspace</label>
              <select
                id="business-workspace"
                disabled={busy}
                value={workspace!.organizationId}
                onChange={(event) => void switchWorkspace(event.target.value)}
              >
                {data.session.organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.industry === "property"
                      ? "Property Manager"
                      : "Cleaning Company"}
                  </option>
                ))}
              </select>
              <small>Same engine · different configuration</small>
            </div>
            <nav aria-label="Workspace navigation">
              <span className="nav-label">DAILY WORK</span>
              {config!.navigation.map((id) => {
                const item = entities.find((e) => e.id === id)!;
                const count = workspace!.records.filter(
                  (r) => r.entity === id && !r.archived,
                ).length;
                return (
                  <button
                    disabled={busy}
                    key={id}
                    className={`nav-item ${view === "records" && entity?.id === id ? "active" : ""}`}
                    aria-current={
                      view === "records" && entity?.id === id
                        ? "page"
                        : undefined
                    }
                    onClick={() =>
                      changeView(
                        id === "estimates" ? "estimates" : "records",
                        id,
                      )
                    }
                  >
                    <span>{item.plural}</span>
                    <span className="nav-count">{count}</span>
                  </button>
                );
              })}
              {config!.modules.some((m) => m.id === "scheduling") && (
                <button
                  className={`nav-item ${view === "schedule" ? "active" : ""}`}
                  disabled={busy}
                  onClick={() => changeView("schedule")}
                >
                  Schedule
                </button>
              )}
              {config!.modules.some((m) => m.id === "estimates") && (
                <button
                  className={`nav-item ${view === "catalog" ? "active" : ""}`}
                  disabled={busy}
                  onClick={() => changeView("catalog")}
                >
                  Services & Rates
                </button>
              )}
              <span className="nav-label">YOUR SYSTEM</span>
              {entities.some((e) => e.id === "employees") && (
                <button
                  className={`nav-item ${view === "workforce" ? "active" : ""}`}
                  disabled={busy}
                  onClick={() => changeView("workforce")}
                >
                  Crews & availability
                </button>
              )}
              <button
                className={`nav-item ${view === "project" ? "active" : ""}`}
                disabled={!canAdmin || busy}
                onClick={() => changeView("project")}
              >
                Project & modules <span aria-hidden="true">↗</span>
              </button>
              <button
                className={`nav-item ${view === "activity" ? "active" : ""}`}
                disabled={!canAdmin || busy}
                onClick={() => changeView("activity")}
              >
                Audit history <span aria-hidden="true">↗</span>
              </button>
            </nav>
            <div className="sidebar-note">
              <span className="mini-mark" aria-hidden="true">
                ✳
              </span>
              <strong>One engine. Any business.</strong>
              <p>Your data. Your control.</p>
              <small>Foundation v0.1 · MIT</small>
            </div>
          </aside>
          <main id="main" className="main-content" aria-busy={busy}>
            <div className="workspace-heading">
              <div>
                <span className="eyebrow">
                  {config!.industry === "property"
                    ? "Property operations"
                    : "Cleaning operations"}{" "}
                  / Fictional workspace
                </span>
                <h1>{config!.name}</h1>
                <p className="muted">
                  A little structure. More room to get things done.
                </p>
              </div>
              <span className="revision-label">
                Configuration v{workspace!.config.revision}
                <small>{workspace!.role} · demo identity</small>
              </span>
            </div>
            <div role="status" className="status-message">
              {busy ? "Working…" : notice}
            </div>
            {error && (
              <div role="alert" className="error">
                {error}{" "}
                <button
                  className="quiet"
                  disabled={busy}
                  onClick={() =>
                    void mutate({ action: "start" }, "Demo ready.").catch(
                      () => {},
                    )
                  }
                >
                  Start or reload demo
                </button>
              </div>
            )}
            {view === "schedule" && (
              <Schedule
                records={workspace!.records}
                zone={config!.timeZone ?? "UTC"}
                canWrite={canWrite}
                assignments={workspace!.staffAssignments}
                busy={busy}
                onAdd={() => {
                  setSelected("appointments");
                  setView("records");
                  setEditor("new");
                  setArchive(null);
                }}
                onEdit={(record) => {
                  setSelected("appointments");
                  setView("records");
                  setEditor(record);
                  setArchive(null);
                }}
                onArchive={(record) => {
                  setSelected("appointments");
                  setView("records");
                  setEditor(null);
                  archiveOperation.current = crypto.randomUUID();
                  setArchive(record);
                }}
              />
            )}
            {view === "workforce" && (
              <Workforce
                records={workspace!.records}
                assignments={workspace!.staffAssignments}
                zone={config!.timeZone ?? "UTC"}
                canManage={canAdmin}
                busy={busy}
                onAdd={(entityId) => {
                  setSelected(entityId);
                  setView("records");
                  setEditor("new");
                  setArchive(null);
                }}
                onEdit={(record) => {
                  setSelected(record.entity);
                  setView("records");
                  setEditor(record);
                  setArchive(null);
                }}
                onArchive={(record) => {
                  setSelected(record.entity);
                  setView("records");
                  setEditor(null);
                  archiveOperation.current = crypto.randomUUID();
                  setArchive(record);
                }}
              />
            )}
            {view === "catalog" && (
              <Catalog
                records={workspace!.records}
                canManage={canAdmin}
                busy={busy}
                onAdd={(id) => openRecord(id)}
                onEdit={(r) => openRecord(r.entity, r)}
                onArchive={archiveRecord}
              />
            )}
            {view === "estimates" && (
              <Estimates
                records={workspace!.records}
                versions={workspace!.estimateVersions}
                businessName={config!.name}
                theme={theme}
                canManage={canAdmin}
                busy={busy}
                onAdd={(id) => openRecord(id)}
                onEdit={(r) => openRecord(r.entity, r)}
                onArchive={archiveRecord}
              />
            )}
            {view === "records" && entity && (
              <>
                <section
                  className="workspace-summary"
                  aria-label="Workspace summary"
                >
                  <div>
                    <span className="metric-label">Active records</span>
                    <strong>
                      {workspace!.records.filter((r) => !r.archived).length}
                    </strong>
                  </div>
                  <div>
                    <span className="metric-label">Enabled modules</span>
                    <strong>
                      {config!.modules.length.toString().padStart(2, "0")}
                    </strong>
                  </div>
                  <div className="summary-message">
                    <span className="eyebrow">Own the way you work</span>
                    <p>
                      Change the business above.
                      <br />
                      The engine stays the same.
                    </p>
                  </div>
                </section>
                <section
                  className="panel records-panel"
                  aria-labelledby="records-heading"
                >
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">Your daily workspace</span>
                      <h2 id="records-heading">{entity.plural}</h2>
                    </div>
                    <button
                      disabled={!canEditEntity || busy}
                      onClick={() => {
                        setEditor("new");
                        setArchive(null);
                      }}
                    >
                      + Add {entity.singular.toLowerCase()}
                    </button>
                  </div>
                  <div className="record-toolbar">
                    <div className="search-field">
                      <label htmlFor="record-search">
                        Search {entity.plural.toLowerCase()}
                      </label>
                      <input
                        id="record-search"
                        type="search"
                        placeholder="Find a record…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={showArchived}
                        onChange={(e) => setShowArchived(e.target.checked)}
                      />{" "}
                      Show archived
                    </label>
                    <span className="record-count">
                      {records.length}{" "}
                      {records.length === 1 ? "record" : "records"}
                    </span>
                  </div>
                  {records.length === 0 ? (
                    <div className="empty-state">
                      <h3>
                        {showArchived
                          ? "No archived records here."
                          : query
                            ? "No matching records."
                            : "A fresh start."}
                      </h3>
                      <p>
                        {query
                          ? "Try another search."
                          : `Add a ${entity.singular.toLowerCase()} to shape this workspace.`}
                      </p>
                    </div>
                  ) : (
                    <div className="record-list">
                      {records.map((record) => {
                        const title = String(record.data[entity.titleField]);
                        return (
                          <article className="record-row" key={record.id}>
                            <div className="record-symbol" aria-hidden="true">
                              {title.slice(0, 1).toUpperCase()}
                            </div>
                            <div className="record-details">
                              <h3>{title}</h3>
                              <dl>
                                {entity.fields
                                  .filter(
                                    (f) =>
                                      f.key !== entity.titleField &&
                                      record.data[f.key] !== undefined &&
                                      record.data[f.key] !== "",
                                  )
                                  .slice(0, 3)
                                  .map((f) => (
                                    <div key={f.key}>
                                      <dt>{f.label}</dt>
                                      <dd>
                                        {f.type === "reference"
                                          ? relatedLabel(
                                              record.data[f.key],
                                              workspace!.records,
                                            )
                                          : f.type === "datetime"
                                            ? displayTime(
                                                String(record.data[f.key]),
                                                String(
                                                  record.data.time_zone ??
                                                    config!.timeZone ??
                                                    "UTC",
                                                ),
                                              )
                                            : f.type === "money"
                                              ? money(
                                                  String(record.data[f.key]),
                                                )
                                              : f.type === "estimate"
                                                ? money(
                                                    (
                                                      record.data[
                                                        f.key
                                                      ] as EstimatePricing
                                                    ).totalMinor,
                                                  )
                                                : String(record.data[f.key])}
                                      </dd>
                                    </div>
                                  ))}
                              </dl>
                            </div>
                            <div className="record-actions">
                              <span className="muted small">
                                v{record.revision}
                              </span>
                              {!record.archived && (
                                <button
                                  className="secondary"
                                  disabled={!canEditEntity || busy}
                                  aria-label={`Edit ${title}`}
                                  onClick={() => {
                                    setEditor(record);
                                    setArchive(null);
                                  }}
                                >
                                  Edit
                                </button>
                              )}
                              <button
                                className="quiet"
                                disabled={!canEditEntity || busy}
                                aria-label={`${record.archived ? "Restore" : "Archive"} ${title}`}
                                onClick={() => {
                                  archiveOperation.current =
                                    crypto.randomUUID();
                                  setArchive(record);
                                  setEditor(null);
                                }}
                              >
                                {record.archived ? "Restore" : "Archive"}
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                  <p className="record-footnote">
                    Changes stay in this demo session. Archived records and
                    their history are retained.
                  </p>
                </section>
                {archive && (
                  <section
                    className="panel confirmation"
                    aria-label="Review archive action"
                  >
                    <h2>
                      {archive.archived ? "Restore" : "Archive"} this record?
                    </h2>
                    <p>
                      {String(archive.data[entity.titleField])} ·{" "}
                      {archive.archived
                        ? "It will return to the active list."
                        : "Its data and audit history will remain available."}
                    </p>
                    <div className="actions">
                      <button
                        disabled={busy}
                        onClick={() =>
                          void mutate(
                            {
                              action: "archive",
                              organizationId: workspace!.organizationId,
                              recordId: archive.id,
                              revision: archive.revision,
                              archived: !archive.archived,
                              operationId: archiveOperation.current,
                            },
                            archive.archived
                              ? "Record restored."
                              : "Record archived.",
                          )
                            .then(() => setArchive(null))
                            .catch(() => {})
                        }
                      >
                        Confirm {archive.archived ? "restore" : "archive"}
                      </button>
                      <button
                        className="secondary"
                        onClick={() => setArchive(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </section>
                )}
                {editor && (
                  <Editor
                    key={`${workspace!.organizationId}-${entity.id}-${editor === "new" ? "new" : editor.id}`}
                    entity={entity}
                    records={workspace!.records}
                    businessZone={config!.timeZone ?? "UTC"}
                    workforceEnabled={config!.modules.some(
                      (m) => m.id === "workforce",
                    )}
                    record={editor === "new" ? undefined : editor}
                    busy={busy}
                    onCancel={() => {
                      setEditor(null);
                      setError("");
                    }}
                    onSave={async (
                      recordData: RecordData,
                      operationId: string,
                    ) => {
                      await mutate(
                        {
                          action: "save",
                          organizationId: workspace!.organizationId,
                          entity: entity.id,
                          data: recordData,
                          operationId,
                          ...(editor === "new"
                            ? {}
                            : {
                                existing: {
                                  id: editor.id,
                                  revision: editor.revision,
                                },
                              }),
                        },
                        "Record saved.",
                      );
                      setEditor(null);
                    }}
                  />
                )}
              </>
            )}
            {view === "project" && (
              <ProjectPanel
                key={`${workspace!.organizationId}-${workspace!.config.revision}`}
                workspace={workspace!}
                busy={busy}
                onPublish={async (
                  document: BusinessConfig,
                  restoredFrom?: number,
                ) => {
                  await mutate(
                    {
                      action: "configure",
                      organizationId: workspace!.organizationId,
                      revision: workspace!.config.revision,
                      document,
                      ...(restoredFrom ? { restoredFrom } : {}),
                    },
                    "Configuration saved as a new revision.",
                  );
                }}
                onExport={async () => {
                  const value = await jsonRequest(
                    `/api/demo?organizationId=${workspace!.organizationId}&export=1`,
                  );
                  downloadJson("lms-demo-workspace.json", value);
                }}
              />
            )}
            {view === "activity" && (
              <section className="panel">
                <span className="eyebrow">Retained change history</span>
                <h2>Audit history</h2>
                <p className="muted">
                  Latest 100 events for this organization. Only owners and
                  administrators can read these snapshots.
                </p>
                <div className="audit-list">
                  {workspace!.audit.map((event) => (
                    <details key={event.id}>
                      <summary>
                        <strong>
                          {event.entity} · {event.action}
                        </strong>
                        <span>
                          {new Date(event.occurred_at).toLocaleString()}
                        </span>
                      </summary>
                      <pre>
                        {JSON.stringify(
                          {
                            before: event.before_data,
                            after: event.after_data,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  ))}
                </div>
              </section>
            )}
            <footer className="workspace-footer">
              <span>LMS is a work in progress, built in the open.</span>
              <a href="https://github.com/larrinamsalva/LMS">
                Follow the project ↗
              </a>
            </footer>
          </main>
        </div>
      )}
    </div>
  );
}
