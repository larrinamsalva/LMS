import { useEffect, useRef, useState } from "react";
import { DataImpactReview, type ReviewImpact } from "./migration-review";
import type { MigrationReview } from "../core/migration-review";
import type { Rehearse } from "./rehearsal";
import type { WorkspaceSnapshot } from "../core/engine";
import {
  configurationImpact,
  type BusinessConfig,
  type EntityDefinition,
} from "../core/config";
import {
  newBuildPlan,
  planForConfig,
  validateBuildPlan,
  parseBuildPlanText,
  selectModules,
  moduleRequirements,
  builderTemplate,
  customFieldTypes,
  customFieldEntities,
  addCustomField,
  publishPlanConfirmation,
  BUILD_PLAN_LIMIT,
  type BuildPlan,
  type BuildPlanRevision,
  type Template,
} from "../core/buildplan";
import { manifests, plannedModules } from "../modules/registry";
import { BuildPlanGallery } from "./buildplan-gallery";
import { downloadJson } from "./project-panel";
import { BrandingStudio } from "./branding-studio";
import {
  TemplateUpdates,
  type TemplateUpdateSession,
} from "./template-updates";
import {
  reviewedTemplateHistory,
  savedTemplateBaseline,
  planDigest,
} from "../core/template-history";
import { blueprintJson } from "../core/blueprint";
import { BlueprintPackageTools, BlueprintReview } from "./blueprint-package";
import {
  ATTESTATION_LIMIT,
  inspectBlueprintPackage,
  type InspectedBlueprint,
} from "../core/blueprint-provenance";
import {
  createBlueprintPackage,
  BLUEPRINT_PACKAGE_LIMIT,
  type BlueprintDetails,
} from "../core/blueprint";
const names = {
  property: "Property Management",
  cleaning: "Cleaning Business",
  custom: "Custom Business",
};
const questions: Record<string, string> = {
  customers: "Do you keep customer details?",
  tasks: "Do you track work requests and daily tasks?",
  property: "Do you manage sites or units?",
  cleaning: "Do you track cleaning jobs?",
  scheduling: "Do you book appointments and resources?",
  workforce: "Do employees work individually or in crews?",
  estimates: "Do you price services and prepare estimates?",
  inventory: "Do you track supplies and stock?",
  "custom-records": "Do you need notes with your own optional fields?",
};
function ModuleChoices({
  config,
  onChange,
}: {
  config: BusinessConfig;
  onChange: (c: BusinessConfig) => void;
}) {
  const enabled = new Set(config.modules.map((m) => m.id));
  return (
    <fieldset>
      <legend>What does a normal business day include?</legend>
      <div className="studio-cards">
        {manifests
          .filter((m) => config.entities.some((e) => e.module === m.id))
          .map((m) => {
            const requiredBy = config.modules.filter(
              (n) =>
                n.id !== m.id &&
                moduleRequirements(config, n.id).includes(m.id),
            );
            const core = ["customers", "tasks"].includes(m.id),
              deps = moduleRequirements(config, m.id);
            return (
              <label className="studio-card" key={m.id}>
                <span className="check-label">
                  <input
                    type="checkbox"
                    aria-label={m.name}
                    aria-describedby={`studio-module-${m.id}`}
                    checked={enabled.has(m.id)}
                    disabled={core || requiredBy.length > 0}
                    onChange={(e) =>
                      onChange(
                        selectModules(
                          config,
                          e.target.checked
                            ? [...enabled, m.id]
                            : [...enabled].filter((id) => id !== m.id),
                        ),
                      )
                    }
                  />
                  <strong>{m.name}</strong>
                </span>
                <span>{questions[m.id]}</span>
                <small id={`studio-module-${m.id}`}>{m.description}</small>
                {deps.length > 0 && (
                  <small>
                    Includes dependencies:{" "}
                    {deps
                      .map(
                        (id) => manifests.find((m) => m.id === id)?.name ?? id,
                      )
                      .join(", ")}
                    .
                  </small>
                )}
                {core ? (
                  <small>Required foundation for these templates.</small>
                ) : requiredBy.length > 0 ? (
                  <small>
                    Required by{" "}
                    {requiredBy
                      .map(
                        (m) =>
                          manifests.find((n) => n.id === m.id)?.name ?? m.id,
                      )
                      .join(", ")}
                    . Turn those features off first to remove this one.
                  </small>
                ) : null}
              </label>
            );
          })}
      </div>
      <p className="muted">
        Services and estimate drafts are one reviewed feature. Employees, crew
        membership and availability are one reviewed feature. Required features
        are selected automatically and are listed again at review.
      </p>
    </fieldset>
  );
}
function PlanCustomization({
  config,
  template,
  onChange,
}: {
  config: BusinessConfig;
  template: Template;
  onChange: (c: BusinessConfig) => void;
}) {
  const base = builderTemplate(template),
    [target, setTarget] = useState("customers"),
    [label, setLabel] = useState(""),
    [type, setType] = useState<(typeof customFieldTypes)[number]>("text"),
    [error, setError] = useState("");
  const active = config.entities.filter((e) =>
    config.modules.some((m) => m.id === e.module),
  );
  const updateEntity = (id: string, change: Partial<EntityDefinition>) =>
    onChange({
      ...config,
      entities: config.entities.map((e) =>
        e.id === id ? { ...e, ...change } : e,
      ),
    });
  const count = config.entities
    .flatMap((e) => e.fields)
    .filter((f) => f.key.startsWith("extra_")).length;
  return (
    <div className="stack">
      <div className="form-grid">
        <div>
          <label htmlFor="studio-zone">Business time zone</label>
          <input
            id="studio-zone"
            value={config.timeZone ?? "UTC"}
            maxLength={80}
            required
            onChange={(e) => onChange({ ...config, timeZone: e.target.value })}
          />
        </div>
      </div>
      <p className="muted">
        Use an IANA time zone, such as America/Los_Angeles or UTC. Existing
        booking instants retain their original meaning.
      </p>
      <h3>Use words your business understands</h3>
      <div className="studio-cards">
        {active.map((entity) => {
          const original = base.entities.find((e) => e.id === entity.id)!;
          return (
            <fieldset className="studio-card" key={entity.id}>
              <legend>{original.plural}</legend>
              <label htmlFor={`studio-${entity.id}-singular`}>
                Singular term for {original.plural}
              </label>
              <input
                id={`studio-${entity.id}-singular`}
                value={entity.singular}
                maxLength={80}
                required
                onChange={(e) =>
                  updateEntity(entity.id, { singular: e.target.value })
                }
              />
              <label htmlFor={`studio-${entity.id}-plural`}>
                Plural term for {original.plural}
              </label>
              <input
                id={`studio-${entity.id}-plural`}
                value={entity.plural}
                maxLength={80}
                required
                onChange={(e) =>
                  updateEntity(entity.id, { plural: e.target.value })
                }
              />
              <label htmlFor={`studio-${entity.id}-nav`}>
                Navigation label for {original.plural}
              </label>
              <input
                id={`studio-${entity.id}-nav`}
                value={entity.navigationLabel ?? entity.plural}
                maxLength={80}
                required
                onChange={(e) =>
                  updateEntity(entity.id, { navigationLabel: e.target.value })
                }
              />
            </fieldset>
          );
        })}
      </div>
      <fieldset>
        <legend>Optional custom fields · {count}/4</legend>
        <p className="muted">
          Add a text, notes, email, date or operational-number field. Core
          fields and permissions stay reviewed. Changing fields on populated
          records requires a migration; Studio never performs that migration.
        </p>
        <div className="form-grid">
          <div>
            <label htmlFor="studio-field-target">Add field to</label>
            <select
              id="studio-field-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              {active
                .filter((e) => customFieldEntities.includes(e.id))
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.plural}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label htmlFor="studio-field-label">New field label</label>
            <input
              id="studio-field-label"
              value={label}
              maxLength={80}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="studio-field-type">New field type</label>
            <select
              id="studio-field-type"
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              {customFieldTypes.map((t) => (
                <option key={t} value={t}>
                  {
                    {
                      text: "Text",
                      longtext: "Notes",
                      email: "Email",
                      date: "Date",
                      number: "Operational number",
                    }[t]
                  }
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          className="secondary"
          type="button"
          disabled={count >= 4 || !label.trim()}
          onClick={() => {
            try {
              const next = addCustomField(config, target, {
                key:
                  "extra_" +
                  crypto.randomUUID().replaceAll("-", "").slice(0, 12),
                label: label.trim(),
                type,
                required: false,
              });
              onChange(next);
              setLabel("");
              setError("");
            } catch {
              setError("Check the field label and available field slots.");
            }
          }}
        >
          Add optional field
        </button>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <ul>
          {config.entities.flatMap((entity) =>
            entity.fields
              .filter((f) => f.key.startsWith("extra_"))
              .map((f) => (
                <li key={f.key}>
                  {entity.plural} · {f.label} ({f.type}){" "}
                  <button
                    className="quiet"
                    type="button"
                    aria-label={`Remove optional field ${f.label}`}
                    onClick={() =>
                      updateEntity(entity.id, {
                        fields: entity.fields.filter((n) => n.key !== f.key),
                      })
                    }
                  >
                    Remove
                  </button>
                </li>
              )),
          )}
        </ul>
      </fieldset>
      <fieldset>
        <legend>Arrange navigation</legend>
        <ol className="navigation-order">
          {config.navigation.map((id, index) => (
            <li key={id}>
              <span>
                {config.entities.find((e) => e.id === id)?.navigationLabel ??
                  config.entities.find((e) => e.id === id)?.plural}
              </span>
              <button
                className="quiet"
                disabled={index === 0}
                type="button"
                aria-label={`Move ${config.entities.find((e) => e.id === id)?.plural} up`}
                onClick={() => {
                  const next = [...config.navigation];
                  [next[index - 1], next[index]] = [
                    next[index],
                    next[index - 1],
                  ];
                  onChange({ ...config, navigation: next });
                }}
              >
                Move up ↑
              </button>
            </li>
          ))}
        </ol>
      </fieldset>
    </div>
  );
}
function initial(workspace: WorkspaceSnapshot) {
  try {
    return { plan: planForConfig(workspace.config.document), warning: "" };
  } catch {
    return {
      plan: newBuildPlan(workspace.config.document.industry),
      warning:
        "This manually customized configuration is outside Studio's reviewed template contract. These are fresh template choices; your workspace and records have not changed.",
    };
  }
}
export function BuildPlanStudio({
  workspace,
  busy,
  onSave,
  onPublish,
  onPreview,
  onReview,
  onRehearse,
}: {
  workspace: WorkspaceSnapshot;
  busy: boolean;
  onSave: (
    plan: BuildPlan,
    id: string,
    revision: number,
    baseRevision: number,
  ) => Promise<void>;
  onPublish: (input: unknown) => Promise<void>;
  onPreview: (plan: BuildPlan, operationId: string) => Promise<string>;
  onReview: ReviewImpact;
  onRehearse: Rehearse;
}) {
  const [start] = useState(() => initial(workspace)),
    [plan, setPlan] = useState(start.plan),
    [step, setStep] = useState(0),
    [browsing, setBrowsing] = useState(false),
    [updates, setUpdates] = useState<TemplateUpdateSession | null>(null),
    [dataImpact, setDataImpact] = useState<MigrationReview | null>(null),
    [startingPoint, setStartingPoint] = useState<{
      id: string;
      revision: number;
      plan: BuildPlan;
    } | null>(null),
    [reviewing, setReviewing] = useState<InspectedBlueprint | null>(null),
    [packageDetails, setPackageDetails] = useState<BlueprintDetails>({
      name: "",
      description: "A reusable fictional LMS business configuration.",
    }),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState(false),
    [draftId, setDraftId] = useState<string | null>(null),
    [draftRevision, setDraftRevision] = useState(0),
    [baseRevision, setBaseRevision] = useState(workspace.config.revision),
    [saved, setSaved] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [preview, setPreview] = useState<{ body: string; url: string } | null>(
      null,
    );
  const previewRequest = useRef<{ body: string; id: string } | null>(null),
    baselineRequest = useRef<{
      id: string;
      baseRevision: number;
      source: string;
    } | null>(null),
    previewCache = useRef(new Map<string, string>()),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step, browsing, reviewing, updates, dataImpact]);
  let valid: BuildPlan | undefined,
    validation = "";
  try {
    valid = validateBuildPlan(plan);
  } catch (e) {
    validation =
      e instanceof Error && e.name !== "ZodError"
        ? e.message
        : "Check business name, terms, time zone and allowed feature choices.";
  }
  const impact = configurationImpact(
      workspace.config.document,
      plan.configuration,
      workspace.populatedEntities,
    ),
    body = JSON.stringify({ plan, baseRevision }),
    dirty = body !== saved,
    blocked =
      impact.identityChanged ||
      impact.migrationEntities.length > 0 ||
      baseRevision !== workspace.config.revision;
  const working = busy || pending;
  async function run(action: () => Promise<void>) {
    setPending(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error && e.name !== "ZodError"
          ? e.message
          : "This BuildPlan is invalid or unsupported.",
      );
    } finally {
      setPending(false);
    }
  }
  async function preparePreview(input: BuildPlan) {
    const p = validateBuildPlan(input),
      key = JSON.stringify(p),
      cached = previewCache.current.get(key);
    if (cached) return cached;
    if (previewRequest.current?.body !== key)
      previewRequest.current = { body: key, id: crypto.randomUUID() };
    const url = await onPreview(p, previewRequest.current.id);
    // Successful server previews are bounded by the existing three-slot session quota.
    previewCache.current.set(key, url);
    return url;
  }
  function change(config: BusinessConfig) {
    setPlan((p) => ({
      ...p,
      version: config.schemaVersion,
      configuration: config,
    }));
    setConfirmed(false);
  }
  function reopen(item: BuildPlanRevision) {
    void run(async () => {
      const p = validateBuildPlan(item.document);
      setPlan(p);
      setStartingPoint(null);
      baselineRequest.current = null;
      setPackageDetails({
        name: "",
        description: "A reusable fictional LMS business configuration.",
      });
      setDraftId(item.id);
      const latest = Math.max(
        ...workspace.buildPlans
          .filter((n) => n.id === item.id)
          .map((n) => n.revision),
      );
      setDraftRevision(latest);
      setBaseRevision(item.base_revision);
      setSaved(
        item.revision === latest
          ? JSON.stringify({ plan: p, baseRevision: item.base_revision })
          : "",
      );
      setConfirmed(false);
      setStep(3);
      setNotice(
        `Reopened revision ${item.revision}. The next changed save appends after revision ${latest}.`,
      );
    });
  }
  const latest = workspace.buildPlans.filter(
    (item) =>
      !workspace.buildPlans.some(
        (other) => other.id === item.id && other.revision > item.revision,
      ),
  );
  if (dataImpact)
    return (
      <DataImpactReview
        initial={dataImpact}
        onReview={onReview}
        onRehearse={onRehearse}
        onBack={() => setDataImpact(null)}
        onPreview={preparePreview}
      />
    );
  if (browsing)
    return (
      <BuildPlanGallery
        busy={working}
        onBack={() => setBrowsing(false)}
        onPreview={preparePreview}
        onCustomize={(input, name, metadata) => {
          const copy = validateBuildPlan(input);
          setPlan(copy);
          setStartingPoint({
            id: metadata.id,
            revision: metadata.revision,
            plan: copy,
          });
          baselineRequest.current = null;
          setPackageDetails({
            name: copy.configuration.name,
            description: metadata.purpose,
            gallery: { id: metadata.id, revision: metadata.revision },
          });
          setDraftId(null);
          setDraftRevision(0);
          setBaseRevision(workspace.config.revision);
          setSaved("");
          setConfirmed(false);
          setPreview(null);
          setError("");
          setStep(2);
          setBrowsing(false);
          setNotice(
            `Loaded ${name} as unsaved Studio choices. Nothing was saved or published.`,
          );
        }}
      />
    );
  if (reviewing)
    return (
      <BlueprintReview
        inspection={reviewing}
        workspace={workspace}
        choices={plan}
        onCancel={() => setReviewing(null)}
        onPreview={preparePreview}
        onUse={() => {
          setPlan(validateBuildPlan(reviewing.blueprint.plan));
          setStartingPoint(null);
          baselineRequest.current = null;
          setPackageDetails(reviewing.blueprint.manifest.blueprint);
          setDraftId(null);
          setDraftRevision(0);
          setBaseRevision(workspace.config.revision);
          setSaved("");
          setConfirmed(false);
          setPreview(null);
          setError("");
          setStep(3);
          setReviewing(null);
          setNotice(
            "Blueprint loaded as unsaved Studio choices. Saved drafts, records and published configuration are unchanged.",
          );
        }}
      />
    );
  if (updates)
    return (
      <TemplateUpdates
        session={updates}
        workspace={workspace}
        onKeep={() => setUpdates(null)}
        onPreview={preparePreview}
        onUse={(next, captured) => {
          if (
            blueprintJson(validateBuildPlan(plan)) !==
              blueprintJson(captured.plan) ||
            workspace.config.revision !== captured.configRevision
          )
            throw new Error(
              "The editor or workspace changed. Keep your version and check for updates again.",
            );
          setPlan(validateBuildPlan(next));
          setConfirmed(false);
          setPreview(null);
          setUpdates(null);
          setStep(3);
          setNotice(
            "Reviewed replacements loaded as unsaved Studio choices. Your draft ID/history, unselected customizations and all business records are retained. Save and review publication separately.",
          );
        }}
      />
    );
  return (
    <div className="stack studio" aria-label="BuildPlan Studio">
      <section className="panel">
        <span className="eyebrow">
          BuildPlan Studio · manual, open and fictional
        </span>
        <h2>Build My Business System</h2>
        <p>
          Choose the work you do, use your own words, then try the generated
          system. Saving a plan does not change your business workspace.
        </p>
        <p className="muted">
          Drafts and preview records expire with this temporary demo or server
          restart. Export your BuildPlan to keep your choices. No login or AI is
          required.
        </p>
        <button
          className="secondary"
          type="button"
          disabled={working}
          onClick={() => setBrowsing(true)}
        >
          Browse Business Templates
        </button>
        <button
          className="secondary"
          type="button"
          disabled={working || !valid}
          onClick={() =>
            void run(async () => {
              const p = validateBuildPlan(plan),
                history = await reviewedTemplateHistory(),
                baseline = await savedTemplateBaseline(
                  history,
                  workspace.buildPlans,
                  draftId,
                  draftRevision,
                  p,
                );
              setUpdates({
                history,
                baseline,
                plan: p,
                configRevision: workspace.config.revision,
                preferredId: startingPoint?.id,
                hint: packageDetails.gallery,
              });
            })
          }
        >
          Check for Template Updates
        </button>
        <button
          type="button"
          className="secondary"
          disabled={working || !valid}
          onClick={() =>
            void run(async () => {
              setDataImpact(
                await onReview({
                  document: validateBuildPlan(plan),
                  ...(draftId && draftRevision > 0
                    ? { draft: { id: draftId, revision: draftRevision } }
                    : {}),
                }),
              );
            })
          }
        >
          Review Data Impact
        </button>
        {startingPoint && !draftId && (
          <section className="studio-review">
            <h3>Optional: retain an exact reviewed starting point</h3>
            <p>
              Save the unmodified reviewed starter as draft revision one, while
              keeping your customized editor choices. Then Save BuildPlan draft
              to append your choices. This uses two of the existing twenty
              revisions and establishes a repeatable comparison baseline.
              Imported ZIP hints cannot create this link.
            </p>
            <button
              className="secondary"
              type="button"
              disabled={working || !valid}
              onClick={() =>
                void run(async () => {
                  const history = await reviewedTemplateHistory(),
                    source = history.find(
                      (h) =>
                        h.entry.metadata.id === startingPoint.id &&
                        h.entry.metadata.revision === startingPoint.revision,
                    );
                  if (
                    !source ||
                    (await planDigest(startingPoint.plan)) !== source.planSha256
                  )
                    throw new Error(
                      "This starting point no longer matches reviewed local history.",
                    );
                  const sourceKey = source.sha256;
                  if (
                    !baselineRequest.current ||
                    baselineRequest.current.source !== sourceKey
                  )
                    baselineRequest.current = {
                      id: crypto.randomUUID(),
                      baseRevision: workspace.config.revision,
                      source: sourceKey,
                    };
                  const request = baselineRequest.current;
                  await onSave(
                    source.entry.plan,
                    request.id,
                    0,
                    request.baseRevision,
                  );
                  setDraftId(request.id);
                  setDraftRevision(1);
                  setBaseRevision(request.baseRevision);
                  setSaved(
                    JSON.stringify({
                      plan: source.entry.plan,
                      baseRevision: request.baseRevision,
                    }),
                  );
                  setConfirmed(false);
                  setNotice(
                    "Reviewed starting point saved as revision one. Your editor choices are unchanged; save them as the next draft revision.",
                  );
                })
              }
            >
              Save reviewed starting point
            </button>
          </section>
        )}
        {start.warning && <p className="error">{start.warning}</p>}
        <nav className="studio-steps" aria-label="BuildPlan steps">
          {["Start", "Features", "Customize", "Review & try"].map(
            (label, index) => (
              <button
                type="button"
                className={step === index ? "" : "secondary"}
                key={label}
                aria-current={step === index ? "step" : undefined}
                disabled={working}
                onClick={() => setStep(index)}
              >
                {index + 1} · {label}
              </button>
            ),
          )}
        </nav>
      </section>
      <section className="panel" aria-labelledby="studio-step-heading">
        <h2 ref={heading} tabIndex={-1} id="studio-step-heading">
          Step {step + 1} ·{" "}
          {
            [
              "Choose a starting point",
              "Choose your business features",
              "Make it yours",
              "Review, preview and save",
            ][step]
          }
        </h2>
        {step === 0 && (
          <>
            <p>
              Start from a reviewed template, or continue with this workspace's
              compatible choices. Starting another template replaces unsaved
              choices; saved drafts remain available below.
            </p>
            <div className="studio-cards">
              {(["property", "cleaning", "custom"] as const).map((type) => (
                <article className="studio-card" key={type}>
                  <h3>{names[type]}</h3>
                  <p>
                    {type === "property"
                      ? "Customer/site maintenance, workers, scheduling and supplies."
                      : type === "cleaning"
                        ? "Customers, cleaning jobs, crews, service rates and supplies."
                        : "General customers and work items with the same optional scheduling, workforce, pricing and stock modules."}
                  </p>
                  <button
                    className="secondary"
                    type="button"
                    disabled={working}
                    aria-pressed={plan.template === type}
                    onClick={() => {
                      setPlan(newBuildPlan(type));
                      setStartingPoint(null);
                      baselineRequest.current = null;
                      setPackageDetails({
                        name: "",
                        description:
                          "A reusable fictional LMS business configuration.",
                      });
                      setDraftId(null);
                      setDraftRevision(0);
                      setBaseRevision(workspace.config.revision);
                      setSaved("");
                      setConfirmed(false);
                      setPreview(null);
                      setNotice(`Started ${names[type]} choices.`);
                    }}
                  >
                    Start {names[type]}
                  </button>
                </article>
              ))}
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <ModuleChoices config={plan.configuration} onChange={change} />
            <section className="subdued studio-unavailable">
              <h3>Planned, unavailable here</h3>
              <p>
                {plannedModules.join(" · ")} · AI generation · Community gallery
                submissions/marketplace · Hosting/deployment. These features
                cannot be enabled by a plan or imported code.
              </p>
            </section>
          </>
        )}
        {step === 2 && (
          <>
            <BrandingStudio config={plan.configuration} onChange={change} />
            <PlanCustomization
              key={plan.template}
              config={plan.configuration}
              template={plan.template}
              onChange={change}
            />
          </>
        )}
        {step === 3 && (
          <>
            <div className="studio-review">
              <h3>{plan.configuration.name || "Name your business"}</h3>
              <p>
                {names[plan.template]} · Configuration schema{" "}
                {plan.configuration.schemaVersion} · BuildPlan version{" "}
                {plan.version}
              </p>
              <p>
                {plan.configuration.modules.length} reviewed modules ·{" "}
                {plan.configuration.navigation.length} navigation entries ·{" "}
                {plan.configuration.timeZone}
              </p>
              <h3>Dependencies included before saving</h3>
              <ul>
                {plan.configuration.modules
                  .filter(
                    (m) => moduleRequirements(plan.configuration, m.id).length,
                  )
                  .map((m) => (
                    <li key={m.id}>
                      {manifests.find((n) => n.id === m.id)?.name} needs{" "}
                      {moduleRequirements(plan.configuration, m.id)
                        .map(
                          (id) =>
                            manifests.find((n) => n.id === id)?.name ?? id,
                        )
                        .join(", ")}
                      .
                    </li>
                  ))}
              </ul>
            </div>
            <section className="studio-review" aria-labelledby="studio-impact">
              <h3 id="studio-impact">Changes to the current workspace</h3>
              <ul>
                {impact.nameChanged && <li>Business name changes.</li>}
                {impact.brandingChanged && (
                  <li>
                    Branding changes. Operational records and field schemas stay
                    intact.
                  </li>
                )}
                {impact.labelsChanged && (
                  <li>Terminology or navigation labels change.</li>
                )}
                {impact.navigationChanged && (
                  <li>Navigation order or visible features change.</li>
                )}
                {impact.timeZoneChanged && (
                  <li>
                    Time zone display/defaults change; existing appointment
                    instants stay fixed.
                  </li>
                )}
                {impact.fieldsChanged && (
                  <li>
                    Field definitions differ. Populated schemas are protected.
                  </li>
                )}
                {impact.disabledModules.length > 0 && (
                  <li>
                    Disabled modules retain all records and history:{" "}
                    {impact.disabledModules.join(", ")}.
                  </li>
                )}
              </ul>
              {impact.identityChanged && (
                <p className="error">
                  This starter has a different project identity. Use its fresh
                  preview or export it; it cannot replace this workspace.
                </p>
              )}
              {impact.migrationEntities.length > 0 && (
                <p className="error">
                  Database migration review required for populated records:{" "}
                  {impact.migrationEntities.join(", ")}. Studio cannot publish
                  these schema changes. Your existing data is preserved.
                </p>
              )}
              {baseRevision !== workspace.config.revision && (
                <>
                  <p className="error">
                    This plan was reviewed against configuration {baseRevision};
                    the current revision is {workspace.config.revision}. Review
                    these changes against the current configuration and save a
                    new draft revision.
                  </p>
                  <button
                    className="secondary"
                    type="button"
                    disabled={working}
                    onClick={() => {
                      setBaseRevision(workspace.config.revision);
                      setConfirmed(false);
                      setNotice(
                        "Review updated against the current configuration. Save the draft before publication.",
                      );
                    }}
                  >
                    Review against current revision
                  </button>
                </>
              )}
              {!blocked && (
                <p>
                  Compatible with the current records. Publication still
                  requires an unchanged saved draft, explicit confirmation and a
                  final Engine check.
                </p>
              )}
            </section>
            <div className="actions">
              <button
                type="button"
                disabled={
                  working ||
                  !valid ||
                  draftRevision >= 20 ||
                  (!dirty && !!draftId)
                }
                onClick={() =>
                  void run(async () => {
                    const p = validateBuildPlan(plan),
                      id = draftId ?? crypto.randomUUID();
                    setDraftId(id);
                    await onSave(p, id, draftRevision, baseRevision);
                    setDraftRevision((v) => v + 1);
                    setPlan(p);
                    setSaved(JSON.stringify({ plan: p, baseRevision }));
                    setNotice(
                      "BuildPlan draft saved. No workspace configuration was published.",
                    );
                  })
                }
              >
                Save BuildPlan draft
              </button>
              <button
                type="button"
                className="secondary"
                disabled={working}
                onClick={() => {
                  setDraftId(null);
                  setDraftRevision(0);
                  setBaseRevision(workspace.config.revision);
                  setSaved("");
                  setConfirmed(false);
                  setNotice(
                    "Copied these choices into a new unsaved plan. Existing drafts are retained.",
                  );
                }}
              >
                Copy choices to a new plan
              </button>
              <button
                className="secondary"
                type="button"
                disabled={working || !valid}
                onClick={() => {
                  downloadJson("lms-build-plan.json", validateBuildPlan(plan));
                  setNotice("Validated BuildPlan exported.");
                }}
              >
                Export BuildPlan JSON
              </button>
              <button
                className="secondary"
                type="button"
                disabled={working || !valid}
                onClick={() =>
                  downloadJson(
                    "lms-business-config.json",
                    validateBuildPlan(plan).configuration,
                  )
                }
              >
                Export configuration JSON
              </button>
            </div>
            <section className="studio-review" aria-labelledby="studio-preview">
              <h3 id="studio-preview">Try the actual generated workspace</h3>
              <p>
                Open a fresh, empty fictional workspace using the shared Engine,
                forms and business modules. Preview data stays separate from
                your current workspace. Up to three fresh previews per session;
                identical retries reuse their preview.
              </p>
              <button
                className="secondary"
                type="button"
                disabled={working || !valid}
                onClick={() =>
                  void run(async () => {
                    const p = validateBuildPlan(plan),
                      key = JSON.stringify(p),
                      url = await preparePreview(p);
                    setPreview({ body: key, url });
                    setNotice(
                      "Preview ready. Open it in a new tab; your plan choices stay here.",
                    );
                  })
                }
              >
                Prepare workspace preview
              </button>
              {preview && (
                <p>
                  {preview.body !== JSON.stringify(plan) && (
                    <strong>
                      Earlier choices preview · prepare again for your latest
                      changes.{" "}
                    </strong>
                  )}
                  <a
                    href={preview.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open interactive workspace preview (new tab)
                  </a>
                </p>
              )}
            </section>
            <fieldset>
              <legend>Optional: publish to this fictional workspace</legend>
              <p>
                This appends a configuration revision through the existing
                Engine. It does not deploy, activate recovery or connect real
                business data. Use Project & modules for retained configuration
                history and rollback.
              </p>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={working || blocked || dirty || !draftId || !valid}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />{" "}
                I reviewed this saved plan and want to publish a fictional
                configuration revision.
              </label>
              <button
                type="button"
                disabled={
                  working ||
                  blocked ||
                  dirty ||
                  !draftId ||
                  !valid ||
                  !confirmed
                }
                onClick={() =>
                  void run(async () => {
                    await onPublish({
                      id: draftId,
                      revision: draftRevision,
                      configRevision: baseRevision,
                      confirmation: publishPlanConfirmation,
                    });
                    setBaseRevision(baseRevision + 1);
                    setConfirmed(false);
                    setNotice(
                      "Configuration revision published. Records and prior history remain.",
                    );
                  })
                }
              >
                Publish reviewed BuildPlan
              </button>
              {draftRevision >= 20 && (
                <p className="muted">
                  This plan reached twenty revisions. Export it, or copy these
                  choices to a new plan if a plan slot is available.
                </p>
              )}
              {dirty && (
                <p className="muted">
                  Save the latest choices and review revision before publishing.
                </p>
              )}
            </fieldset>
          </>
        )}
        {validation && <p className="error">{validation}</p>}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <p role="status">{working ? "Working…" : notice}</p>
        <div className="section-heading">
          <button
            type="button"
            className="secondary"
            disabled={working || step === 0}
            onClick={() => setStep((s) => s - 1)}
          >
            Back
          </button>
          {step < 3 && (
            <button
              type="button"
              disabled={working || !valid}
              onClick={() => setStep((s) => s + 1)}
            >
              Continue to {step + 2}
            </button>
          )}
        </div>
      </section>
      <BlueprintPackageTools
        details={packageDetails}
        valid={!!valid}
        busy={working}
        onDetails={setPackageDetails}
        onDownload={() =>
          void run(async () => {
            const bytes = await createBlueprintPackage(plan, {
              ...packageDetails,
              name: packageDetails.name || plan.configuration.name,
            });
            const url = URL.createObjectURL(
                new Blob([bytes], { type: "application/zip" }),
              ),
              link = document.createElement("a");
            link.href = url;
            link.download = "lms-blueprint.zip";
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setNotice(
              "Blueprint package downloaded. Keep this file; the demo is temporary.",
            );
          })
        }
        onImport={(file, attestation) =>
          void run(async () => {
            if (file.size > BLUEPRINT_PACKAGE_LIMIT)
              throw new Error(
                "Choose a blueprint package no larger than 96 KiB.",
              );
            if (attestation && attestation.size > ATTESTATION_LIMIT)
              throw new Error(
                "Publisher attestation must be no larger than 8 KiB.",
              );
            const [zip, claim] = await Promise.all([
              file.arrayBuffer(),
              attestation?.arrayBuffer(),
            ]);
            try {
              setReviewing(
                await inspectBlueprintPackage(
                  new Uint8Array(zip),
                  claim === undefined ? undefined : new Uint8Array(claim),
                ),
              );
            } catch (error) {
              if (attestation)
                throw new Error(
                  `Publisher verification rejected. No import was accepted. ${error instanceof Error ? error.message : "Invalid attestation or package."}`,
                );
              throw error;
            }
          })
        }
      />
      <section className="panel">
        <h2>Saved BuildPlans</h2>
        <p className="muted">
          Five plans per workspace, up to twenty revisions each. Reopening an
          older revision and saving appends history. A BuildPlan contains
          configuration choices, not business records or account credentials.
        </p>
        {latest.length === 0 ? (
          <p>No saved plans in this temporary workspace yet.</p>
        ) : (
          <ul className="studio-saved">
            {latest.map((item) => (
              <li key={item.id}>
                <strong>
                  {String(
                    item.document?.configuration?.name ?? "Unsupported plan",
                  )}
                </strong>{" "}
                · Draft v{item.revision} · Based on configuration{" "}
                {item.base_revision}
                <button
                  className="secondary"
                  type="button"
                  disabled={working}
                  onClick={() => reopen(item)}
                >
                  Reopen {String(item.document?.configuration?.name ?? "plan")}
                </button>
                <details>
                  <summary>Saved draft history</summary>
                  {workspace.buildPlans
                    .filter((n) => n.id === item.id)
                    .map((n) => (
                      <p key={n.revision}>
                        Draft v{n.revision}{" "}
                        <button
                          className="quiet"
                          type="button"
                          disabled={working}
                          onClick={() => reopen(n)}
                        >
                          Reopen draft revision {n.revision}
                        </button>
                      </p>
                    ))}
                </details>
              </li>
            ))}
          </ul>
        )}
        <label htmlFor="studio-import">
          Load an exported BuildPlan JSON file
        </label>
        <input
          id="studio-import"
          type="file"
          accept=".json,application/json"
          disabled={working}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            void run(async () => {
              if (file.size > BUILD_PLAN_LIMIT)
                throw new Error(
                  "Choose a JSON BuildPlan no larger than 48 KiB.",
                );
              const imported = parseBuildPlanText(await file.text());
              setPlan(imported);
              setStartingPoint(null);
              baselineRequest.current = null;
              setPackageDetails({
                name: "",
                description: "A reusable fictional LMS business configuration.",
              });
              setDraftId(null);
              setDraftRevision(0);
              setBaseRevision(workspace.config.revision);
              setSaved("");
              setConfirmed(false);
              setPreview(null);
              setStep(3);
              setNotice(
                "Loaded a validated BuildPlan. Review and save it as a new draft; nothing was published.",
              );
            });
          }}
        />
        <p className="muted">
          Legacy BuildPlan 1 and branded BuildPlan 2 / Engine API 1 / template
          version 1 JSON are supported. Unsupported modules, unsafe keys,
          executable properties and changed core fields refuse. Imports never
          run code.
        </p>
      </section>
    </div>
  );
}
