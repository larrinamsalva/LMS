import { z } from "zod";
import basic1 from "../templates/history/basic-cleaning.1.json" with { type: "json" };
import basic2 from "../templates/history/basic-cleaning.2.json" with { type: "json" };
import crews1 from "../templates/history/cleaning-crews.1.json" with { type: "json" };
import property1 from "../templates/history/rv-property.1.json" with { type: "json" };
import maintenance1 from "../templates/history/property-maintenance.1.json" with { type: "json" };
import maintenance2 from "../templates/history/property-maintenance.2.json" with { type: "json" };
import general1 from "../templates/history/general-service.1.json" with { type: "json" };
import { validateGalleryEntry, type GalleryEntry } from "./gallery";
import {
  validateBuildPlan,
  type BuildPlan,
  type BuildPlanRevision,
} from "./buildplan";
import { blueprintJson, sha256 } from "./blueprint";
/** This source-controlled index is the trust boundary, not a digest claimed by an imported package. */
export const historyDigestLocks: Readonly<Record<string, string>> =
  Object.freeze({
    "basic-cleaning:1":
      "56207c28cd560d250a8db0e7fc75d6af6faa170506e87a25d608d729f15504fe",
    "cleaning-crews:1":
      "09814cb8d0974a33ade24e8c3573364eca52d73c47c237cb4783ca5298c14087",
    "rv-property:1":
      "ad0bce455c833cad6d894cc6348bc7ac82d06ce3140d5e8e49ac1591d5e2a598",
    "property-maintenance:1":
      "c2413b2bb36c8eaf748110f9cd913fc0172856b68df64384e3f5f764e6693f0a",
    "general-service:1":
      "70f3b9ffa89e83a8349747ae11d9c4c84343998db1e8f945c84133b07f227e9b",
    "basic-cleaning:2":
      "530c705ec50e815b1f64355a7dc764b5aa9d44f5a8fa7fd4bc75d8e28ac4e0d5",
    "property-maintenance:2":
      "1c5b34775cad2be08a57d30cd022cbddb0e1f98b16df0b07e2dc3c177ab207bc",
  });
const moduleSchema = z
  .object({ id: z.string().max(40), version: z.literal("1.0.0") })
  .strict();
const commonReader = {
  engineApi: z.literal(1),
  templateVersion: z.literal(1),
  modules: z.array(moduleSchema).min(1).max(12),
};
const snapshotSchema = z
  .object({
    format: z.literal("lms-reviewed-template"),
    version: z.literal(1),
    reader: z.discriminatedUnion("buildPlan", [
      z
        .object({
          ...commonReader,
          buildPlan: z.literal(1),
          configurationSchema: z.literal(1),
        })
        .strict(),
      z
        .object({
          ...commonReader,
          buildPlan: z.literal(2),
          configurationSchema: z.literal(2),
          branding: z.literal(1),
        })
        .strict(),
    ]),
    entry: z.unknown(),
    changes: z.array(z.string().trim().min(1).max(250)).min(1).max(6),
    planSha256: z.string().regex(/^[a-f0-9]{64}$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export interface TemplateSnapshot
  extends Omit<z.infer<typeof snapshotSchema>, "entry"> {
  entry: GalleryEntry;
}
export class TemplateHistoryError extends Error {}
export const planDigest = (plan: BuildPlan) =>
  sha256(new TextEncoder().encode(blueprintJson(validateBuildPlan(plan))));
export async function validateTemplateHistory(
  input: unknown,
): Promise<TemplateSnapshot[]> {
  try {
    const raw = z.array(snapshotSchema).min(1).max(40).parse(input),
      snapshots: TemplateSnapshot[] = [];
    for (const [index, item] of raw.entries()) {
      const entry = validateGalleryEntry(item.entry),
        plan = entry.plan,
        key = entry.metadata.id + ":" + entry.metadata.revision,
        { sha256: digest, ...payload } = { ...item, entry };
      if (
        blueprintJson({ ...item, entry }) !==
        blueprintJson((input as unknown[])[index])
      )
        throw new TemplateHistoryError(
          "Template history contains normalized or unexpected content.",
        );
      if (
        historyDigestLocks[key] !== digest ||
        (await sha256(new TextEncoder().encode(blueprintJson(payload)))) !==
          digest
      )
        throw new TemplateHistoryError(
          "Bundled template history integrity failed. No update can be used.",
        );
      if (
        item.reader.buildPlan !== plan.version ||
        item.reader.configurationSchema !== plan.configuration.schemaVersion ||
        blueprintJson(item.reader.modules) !==
          blueprintJson(plan.configuration.modules) ||
        (await planDigest(plan)) !== item.planSha256
      )
        throw new TemplateHistoryError(
          "Template does not match its declared compatibility reader or content digest.",
        );
      snapshots.push({ ...item, entry });
    }
    const keys = snapshots.map(
      (s) => s.entry.metadata.id + ":" + s.entry.metadata.revision,
    );
    if (
      new Set(keys).size !== keys.length ||
      keys.length !== Object.keys(historyDigestLocks).length ||
      Object.keys(historyDigestLocks).some((k) => !keys.includes(k))
    )
      throw new TemplateHistoryError(
        "Missing, duplicate or unreviewed template history.",
      );
    for (const id of new Set(snapshots.map((s) => s.entry.metadata.id))) {
      const versions = snapshots
        .filter((s) => s.entry.metadata.id === id)
        .sort((a, b) => a.entry.metadata.revision - b.entry.metadata.revision);
      if (
        versions.some(
          (s, i) =>
            s.entry.metadata.revision !== i + 1 ||
            s.entry.plan.template !== versions[0].entry.plan.template ||
            s.entry.plan.configuration.id !==
              versions[0].entry.plan.configuration.id,
        )
      )
        throw new TemplateHistoryError(
          "Unsupported template history sequence or industry identity.",
        );
    }
    return snapshots;
  } catch (error) {
    if (error instanceof TemplateHistoryError) throw error;
    throw new TemplateHistoryError(
      "Unsupported or malformed local template history. No update can be used.",
    );
  }
}
let verified: Promise<TemplateSnapshot[]> | undefined;
/** Detached source snapshots. No remote feed, package data or user-provided registry is accepted. */
export async function reviewedTemplateHistory(): Promise<TemplateSnapshot[]> {
  verified ??= validateTemplateHistory([
    basic1,
    basic2,
    crews1,
    property1,
    maintenance1,
    maintenance2,
    general1,
  ]);
  return structuredClone(await verified);
}
export function latestTemplate(history: TemplateSnapshot[], id: string) {
  return history
    .filter((s) => s.entry.metadata.id === id)
    .sort((a, b) => b.entry.metadata.revision - a.entry.metadata.revision)[0];
}
/** Exact persisted baseline match, not proof of human authorship or imported ZIP provenance. */
export async function savedTemplateBaseline(
  history: TemplateSnapshot[],
  drafts: BuildPlanRevision[],
  id: string | null,
  revision: number,
  current: BuildPlan,
): Promise<TemplateSnapshot | undefined> {
  if (!id || revision < 1) return;
  const chain = drafts.filter((d) => d.id === id && d.revision <= revision);
  if (
    chain.length !== revision ||
    chain.some((_, i) => !chain.some((d) => d.revision === i + 1))
  )
    return;
  try {
    const root = validateBuildPlan(
      chain.find((d) => d.revision === 1)!.document,
    );
    if (
      root.template !== current.template ||
      root.configuration.id !== current.configuration.id
    )
      return;
    const digest = await planDigest(root);
    return history.find((s) => s.planSha256 === digest);
  } catch {
    return;
  }
}
