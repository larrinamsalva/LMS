import { validateBuildPlan, type BuildPlan } from "./buildplan";
import {
  configurationImpact,
  type BusinessConfig,
  type FieldDefinition,
} from "./config";
import { blueprintJson } from "./blueprint";
import { moduleById } from "../modules/registry";
import type { TemplateSnapshot } from "./template-history";
type Value =
  | string
  | boolean
  | string[]
  | FieldDefinition
  | BusinessConfig["branding"]
  | undefined;
type Operation =
  | { kind: "name" }
  | { kind: "zone" }
  | { kind: "branding" }
  | { kind: "navigation" }
  | { kind: "module"; id: string }
  | {
      kind: "term";
      entity: string;
      key: "singular" | "plural" | "navigationLabel";
    }
  | { kind: "field"; entity: string; key: string };
export interface TemplateChange {
  id: string;
  label: string;
  category: string;
  before: Value;
  current: Value;
  next: Value;
  classification: "suggestion" | "conflict" | "customized" | "informational";
  supported: boolean;
  reason: string;
  operation: Operation;
}
export interface TemplateUpdateReview {
  current: BuildPlan;
  target: TemplateSnapshot;
  baseline?: TemplateSnapshot;
  changes: TemplateChange[];
  editor: string;
  configRevision: number;
}
export class TemplateUpdateError extends Error {}
const equal = (a: unknown, b: unknown) =>
  blueprintJson(a ?? null) === blueprintJson(b ?? null);
export function templateValue(value: Value): string {
  if (value === undefined) return "Not configured";
  if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
  if (Array.isArray(value)) return value.join(" → ") || "None";
  if (typeof value === "string") return value;
  if ("key" in value)
    return `${value.label} [${value.key}] (${value.type}, ${value.required ? "required" : "optional"})${value.options ? "; choices: " + value.options.join(", ") : ""}${value.target ? "; links to: " + value.target : ""}`;
  return `${value.mark} · ${value.monogram} · ${value.palette} · ${value.appearance}${value.tagline ? " · " + value.tagline : ""}`;
}
/** Comparison only. Every proposed change remains unchecked until a person chooses it. */
export function reviewTemplateUpdate(
  currentInput: BuildPlan,
  target: TemplateSnapshot,
  base: TemplateSnapshot | undefined,
  configRevision: number,
): TemplateUpdateReview {
  const current = validateBuildPlan(currentInput),
    next = validateBuildPlan(target.entry.plan),
    baseline =
      base?.entry.metadata.id === target.entry.metadata.id ? base : undefined,
    previous = baseline?.entry.plan.configuration,
    a = current.configuration,
    b = next.configuration,
    changes: TemplateChange[] = [];
  const add = (
    id: string,
    label: string,
    category: string,
    before: Value,
    user: Value,
    newer: Value,
    operation: Operation,
    supported = true,
    reason = "",
  ) => {
    if (equal(user, newer)) return;
    const classification = !baseline
      ? "informational"
      : equal(user, before)
        ? "suggestion"
        : equal(newer, before)
          ? "customized"
          : "conflict";
    changes.push({
      id,
      label,
      category,
      before,
      current: user,
      next: newer,
      classification,
      supported,
      reason,
      operation,
    });
  };
  add(
    "name",
    "Business display name",
    "Identity",
    previous?.name,
    a.name,
    b.name,
    { kind: "name" },
  );
  add(
    "zone",
    "Business time zone",
    "Scheduling",
    previous?.timeZone,
    a.timeZone,
    b.timeZone,
    { kind: "zone" },
  );
  add(
    "branding",
    "Branding",
    "Branding",
    previous?.branding,
    a.branding,
    b.branding,
    { kind: "branding" },
    true,
    "Branding is selected as a complete reviewed configuration, not partially mixed colors.",
  );
  for (const id of new Set([...a.modules, ...b.modules].map((m) => m.id)))
    add(
      "module:" + id,
      moduleById.get(id)?.name ?? id,
      "Features",
      previous?.modules.some((m) => m.id === id),
      a.modules.some((m) => m.id === id),
      b.modules.some((m) => m.id === id),
      { kind: "module", id },
      !["customers", "tasks"].includes(id),
      "Dependencies must be explicitly retained or selected. Enabling/disabling a module changes its visible navigation; retained records are never removed.",
    );
  add(
    "navigation",
    "Navigation order",
    "Navigation",
    previous?.navigation,
    a.navigation,
    b.navigation,
    { kind: "navigation" },
    true,
    "Use the starter order for enabled shared entries; retain your other enabled entries afterward.",
  );
  for (const entity of a.entities) {
    const old = previous?.entities.find((e) => e.id === entity.id),
      newer = b.entities.find((e) => e.id === entity.id);
    if (!newer) continue;
    for (const key of ["singular", "plural", "navigationLabel"] as const)
      add(
        `term:${entity.id}:${key}`,
        `${entity.id}: ${key === "navigationLabel" ? "navigation label" : key + " term"}`,
        "Terminology",
        old?.[key],
        entity[key],
        newer[key],
        { kind: "term", entity: entity.id, key },
      );
    for (const key of new Set(
      [...entity.fields, ...newer.fields].map((f) => f.key),
    )) {
      const was = old?.fields.find((f) => f.key === key),
        user = entity.fields.find((f) => f.key === key),
        nextField = newer.fields.find((f) => f.key === key);
      add(
        `field:${entity.id}:${key}`,
        `${entity.plural}: ${nextField?.label ?? user?.label ?? key}`,
        "Fields",
        was,
        user,
        nextField,
        { kind: "field", entity: entity.id, key },
        key.startsWith("extra_"),
        "Only supported optional fields can change. Populated entity field changes require a separately reviewed migration.",
      );
    }
  }
  return {
    current: structuredClone(current),
    target: structuredClone(target),
    baseline: baseline && structuredClone(baseline),
    changes,
    editor: blueprintJson(current),
    configRevision,
  };
}
export function proposeTemplateUpdate(
  review: TemplateUpdateReview,
  selected: string[],
): BuildPlan {
  if (new Set(selected).size !== selected.length || selected.length > 100)
    throw new TemplateUpdateError("Duplicate or excessive update choices.");
  const current = validateBuildPlan(review.current),
    next = validateBuildPlan(review.target.entry.plan);
  if (
    current.template !== next.template ||
    current.configuration.id !== next.configuration.id
  )
    throw new TemplateUpdateError(
      "This starter has a different industry/project identity. It cannot update these choices.",
    );
  const config = structuredClone(current.configuration),
    enabled = new Set(config.modules.map((m) => m.id));
  let navigation: string[] | undefined;
  for (const id of selected) {
    const change = review.changes.find((r) => r.id === id);
    if (!change || !change.supported)
      throw new TemplateUpdateError("An unsupported change was selected.");
    const op = change.operation;
    // Values are derived again from the validated local target, never a serialized/imported patch.
    if (op.kind === "name") config.name = next.configuration.name;
    else if (op.kind === "zone") {
      if (next.configuration.timeZone)
        config.timeZone = next.configuration.timeZone;
      else delete config.timeZone;
    } else if (op.kind === "branding") {
      if (next.configuration.branding)
        config.branding = structuredClone(next.configuration.branding);
      else delete config.branding;
    } else if (op.kind === "module") {
      if (next.configuration.modules.some((m) => m.id === op.id))
        enabled.add(op.id);
      else enabled.delete(op.id);
    } else if (op.kind === "navigation")
      navigation = next.configuration.navigation;
    else {
      const entity = config.entities.find((e) => e.id === op.entity),
        target = next.configuration.entities.find((e) => e.id === op.entity);
      if (!entity || !target)
        throw new TemplateUpdateError("The selected entity is unavailable.");
      if (op.kind === "term") {
        const value = target[op.key];
        if (value === undefined && op.key === "navigationLabel")
          delete entity.navigationLabel;
        else if (value !== undefined) entity[op.key] = value;
      } else {
        if (!op.key.startsWith("extra_"))
          throw new TemplateUpdateError("Core fields cannot be replaced.");
        const field = target.fields.find((f) => f.key === op.key),
          index = entity.fields.findIndex((f) => f.key === op.key);
        if (field) {
          if (index < 0) entity.fields.push(structuredClone(field));
          else entity.fields[index] = structuredClone(field);
        } else entity.fields = entity.fields.filter((f) => f.key !== op.key);
      }
    }
  }
  config.modules = [
    ...config.modules.filter((m) => enabled.has(m.id)),
    ...next.configuration.modules.filter(
      (m) => enabled.has(m.id) && !config.modules.some((n) => n.id === m.id),
    ),
  ];
  const active = config.entities
    .filter((e) => enabled.has(e.module))
    .map((e) => e.id);
  config.navigation = [
    ...new Set([
      ...(navigation ?? config.navigation),
      ...config.navigation,
      ...next.configuration.navigation,
      ...active,
    ]),
  ].filter((id) => active.includes(id));
  config.schemaVersion = config.branding ? 2 : 1;
  try {
    return validateBuildPlan({
      ...current,
      version: config.schemaVersion,
      configuration: config,
    });
  } catch {
    throw new TemplateUpdateError(
      "These choices are incompatible. Select all required module dependencies and respect the four optional-field limit; nothing was applied.",
    );
  }
}
/** Final editor/config fences complement, never replace, the Engine's transaction-time publication checks. */
export function useTemplateChanges(
  review: TemplateUpdateReview,
  selected: string[],
  context: {
    current: BuildPlan;
    config: BusinessConfig;
    populated: string[];
    revision: number;
    allowVersionChange: boolean;
  },
): BuildPlan {
  if (
    blueprintJson(validateBuildPlan(context.current)) !== review.editor ||
    context.revision !== review.configRevision
  )
    throw new TemplateUpdateError(
      "The editor or workspace revision changed. Check for updates again before using changes.",
    );
  const result = proposeTemplateUpdate(review, selected);
  if (!selected.length || blueprintJson(result) === review.editor)
    throw new TemplateUpdateError(
      "Select a supported change that affects these choices.",
    );
  if (result.version !== review.current.version && !context.allowVersionChange)
    throw new TemplateUpdateError(
      "Explicitly approve the BuildPlan/package version change first.",
    );
  const impact = configurationImpact(
    context.config,
    result.configuration,
    context.populated,
  );
  if (impact.migrationEntities.length)
    throw new TemplateUpdateError(
      "Database migration review required for populated records: " +
        impact.migrationEntities.join(", ") +
        ". Deselect those field changes; no migration is performed.",
    );
  return result;
}
