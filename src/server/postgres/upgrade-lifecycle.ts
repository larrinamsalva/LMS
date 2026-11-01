import { randomBytes } from "node:crypto";
import { readdir, lstat, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Client } from "pg";
import {
  Engine,
  EngineError,
  type SqlConnection,
  type SqlDatabase,
} from "../../core/engine";
import {
  impactReviewInput,
  type MigrationReview,
} from "../../core/migration-review";
import { validateBuildPlan } from "../../core/buildplan";
import { upgradeBlueprint } from "../../core/upgrade-blueprint";
import { canonical, digest } from "../recovery/trust";
import { readPrivateText } from "../recovery/private-file";
import {
  newFile,
  syncDirectory,
  withPublicationLock,
} from "../publication/files";
import {
  nativeReadiness,
  withNativeCopyInspection,
  nativeRehearsalConfirmation,
  nativeReadinessChecks,
  type NativeReadinessOptions,
  type NativeSourceEvidence,
} from "./native-readiness";
import { sameNative, type NativeObservation } from "./readiness-inspection";

const hex = z.string().regex(/^[a-f0-9]{64}$/);
export const upgradeRequest = impactReviewInput
  .extend({ actorId: z.uuid(), organizationId: z.uuid() })
  .strict()
  .transform((r) => ({ ...r, document: validateBuildPlan(r.document) }));
export const copyStates = [
  "newly-prepared",
  "verified-copied-state",
  "quarantined-for-inspection",
  "inspection-completed",
  "retired",
  "blocked-pending-manual-disposition",
] as const;
const pin = z
  .object({
    oid: z.string().regex(/^\d+$/),
    cluster: z.string().regex(/^\d+$/),
    locale: z.string().max(2000),
  })
  .strict();
const observation = z
  .object({
    signatures: z.record(z.string(), hex),
    counts: z.record(z.string(), z.number().int().min(0).max(10000)),
    catalog: z.record(z.string(), hex),
    configurationSchemas: z.array(z.union([z.literal(1), z.literal(2)])),
    buildPlanVersions: z.array(z.union([z.literal(1), z.literal(2)])),
  })
  .strict();
const rootSchema = z
  .object({
    format: z.literal("lms-upgrade-lifecycle"),
    version: z.literal(1),
    keyDigest: hex,
    trustDigest: hex,
    request: z.unknown(),
    sourcePin: pin,
    targetPin: pin,
    source: observation,
    blueprintDigest: hex,
  })
  .strict();
const eventSchema = z
  .object({
    version: z.literal(1),
    index: z.number().int().min(1).max(32),
    previous: hex,
    state: z.enum(copyStates),
    copy: observation.optional(),
    nativeEvidence: hex.optional(),
  })
  .strict();
type Root = z.infer<typeof rootSchema>;
type Event = z.infer<typeof eventSchema>;
type Stored = {
  root: Root;
  key: Buffer;
  events: Event[];
  head: string;
  pending: boolean;
};
export interface UpgradeOptions {
  directory: string;
  native: Omit<
    NativeReadinessOptions,
    "mode" | "onSource" | "onCopy" | "observationKey"
  >;
  rootDigest?: string;
}
const assert = (truth: unknown) => {
  if (!truth)
    throw new EngineError(
      "Upgrade evidence is stale, incomplete or unsupported. Keep quarantine and review private operator evidence.",
      409,
    );
};
const filename = (n: number) => String(n).padStart(3, "0") + ".json";
async function review(
  c: Client,
  input: ReturnType<typeof upgradeRequest.parse>,
): Promise<MigrationReview> {
  const tx: SqlConnection = {
    async query<T>(sql: string, p?: unknown[]) {
      return { rows: (await c.query(sql, p)).rows as T[] };
    },
    exec: (s) => c.query(s),
  };
  const db: SqlDatabase = {
    ...tx,
    async transaction<T>(fn: (t: SqlConnection) => Promise<T>) {
      await c.query("savepoint upgrade_review");
      try {
        return await fn(tx);
      } finally {
        await c.query(
          "rollback to savepoint upgrade_review; release savepoint upgrade_review",
        );
      }
    },
  };
  return new Engine(db).reviewBuildPlanImpact(
    { userId: input.actorId },
    input.organizationId,
    { document: input.document, draft: input.draft, expected: input.expected },
  );
}
/** One private lab case per directory. Hash pins are operator-held observations, not a monotonic witness or recovery approval. */
export class UpgradeLifecycle {
  constructor(private readonly options: UpgradeOptions) {}
  protected async afterDurabilityStep(_step: string): Promise<void> {}
  private file(name: string) {
    return path.join(this.options.directory, name);
  }
  private async json(name: string, limit = 256 * 1024) {
    const s = await lstat(this.file(name));
    assert(s.nlink === 1);
    return JSON.parse(await readPrivateText(this.file(name), limit));
  }
  private async load(
    expectedHead: string,
    allowPending = false,
  ): Promise<Stored> {
    hex.parse(this.options.rootDigest);
    hex.parse(expectedHead);
    const names = await readdir(this.options.directory);
    assert(
      names.length <= 36 &&
        names.every(
          (n) =>
            [".lock", "root.json", "key.txt", "pending.json"].includes(n) ||
            /^\d{3}\.json$/.test(n),
        ),
    );
    const root = rootSchema.parse(await this.json("root.json"));
    assert(digest(canonical(root)) === this.options.rootDigest);
    upgradeRequest.parse(root.request);
    const keyText = await readPrivateText(this.file("key.txt"), 65);
    hex.parse(keyText);
    assert(digest(keyText) === root.keyDigest);
    const events: Event[] = [];
    let head = this.options.rootDigest!;
    for (const name of names.filter((n) => /^\d{3}\.json$/.test(n)).sort()) {
      assert(name === filename(events.length + 1));
      const e = eventSchema.parse(await this.json(name));
      assert(e.index === events.length + 1 && e.previous === head);
      const prior = events.at(-1)?.state;
      assert(
        e.state === "blocked-pending-manual-disposition" ||
          (e.state === "newly-prepared" && !prior) ||
          (e.state === "verified-copied-state" && prior === "newly-prepared") ||
          (e.state === "quarantined-for-inspection" &&
            prior === "verified-copied-state") ||
          (e.state === "inspection-completed" &&
            prior === "quarantined-for-inspection") ||
          (e.state === "retired" && prior === "inspection-completed"),
      );
      assert(
        (e.state === "verified-copied-state") ===
          (!!e.copy && !!e.nativeEvidence),
      );
      head = digest(canonical(e));
      events.push(e);
    }
    assert(events.length > 0 && head === expectedHead);
    const pending = names.includes("pending.json");
    if (pending) {
      const p = await this.json("pending.json", 4096);
      assert(
        p &&
          p.version === 1 &&
          ["prepare", "copy", "inspect", "retire"].includes(p.action),
      );
      assert(allowPending);
    }
    return { root, key: Buffer.from(keyText, "hex"), events, head, pending };
  }
  private async intent(action: string) {
    await newFile(
      this.file("pending.json"),
      canonical({ version: 1, action }) + "\n",
    );
    await syncDirectory(this.options.directory);
    await this.afterDurabilityStep("intent");
  }
  private async append(
    s: Stored,
    state: Event["state"],
    extra: Partial<Event> = {},
  ) {
    const e = eventSchema.parse({
      version: 1,
      index: s.events.length + 1,
      previous: s.head,
      state,
      ...extra,
    });
    await newFile(this.file(filename(e.index)), canonical(e) + "\n");
    await syncDirectory(this.options.directory);
    s.events.push(e);
    s.head = digest(canonical(e));
    await this.afterDurabilityStep(state);
  }
  private async finish() {
    await unlink(this.file("pending.json"));
    await syncDirectory(this.options.directory);
    await this.afterDurabilityStep("finished");
  }
  private async validate(e: NativeSourceEvidence, s: Stored) {
    assert(
      digest(canonical(e.trust)) === s.root.trustDigest &&
        canonical(e.sourcePin) === canonical(s.root.sourcePin) &&
        canonical(e.targetPin) === canonical(s.root.targetPin),
    );
    sameNative(s.root.source, e.observation, false);
    const r = await review(e.source, upgradeRequest.parse(s.root.request));
    assert(digest(canonical(upgradeBlueprint(r))) === s.root.blueprintDigest);
    return r;
  }
  private output(s: Stored, r?: MigrationReview) {
    return {
      format: "lms-private-upgrade-blueprint-report",
      version: 1,
      rootDigest: digest(canonical(s.root)),
      headDigest: s.head,
      lifecycle: s.pending
        ? "blocked-pending-manual-disposition"
        : s.events.at(-1)!.state,
      recordedStates: s.events.map((e) => e.state),
      blueprint: r ? upgradeBlueprint(r) : undefined,
      backupEvidence: s.events.some((e) => e.state === "verified-copied-state")
        ? "PR #21 same-schema round-trip verified at the recorded copy checkpoint; no schema transformation or retained rollback archive verified"
        : "Missing: no verified copied state",
      currentVerification: r
        ? "Fresh authorized source/copy observation"
        : "Recorded file state only; no live readiness claim",
      activationAllowed: false,
      executionAuthorized: false,
      retirement:
        "Tracking retirement never drops or deletes a database; quarantine remains.",
    };
  }
  async prepare(input: unknown) {
    return withPublicationLock(this.options.directory, async () => {
      assert(
        (await readdir(this.options.directory)).every((n) => n === ".lock"),
      );
      const request = upgradeRequest.parse(input),
        key = randomBytes(32);
      let captured: NativeSourceEvidence | undefined,
        r: MigrationReview | undefined;
      await this.intent("prepare");
      try {
        const native = await nativeReadiness({
          ...this.options.native,
          mode: "preflight",
          observationKey: key,
          onSource: async (e) => {
            assert(
              e.trust.source.organizations.includes(request.organizationId),
            );
            r = await review(e.source, request);
            captured = e;
          },
        });
        assert(native.result === "preflight-complete" && captured && r);
        const root = rootSchema.parse({
          format: "lms-upgrade-lifecycle",
          version: 1,
          keyDigest: digest(key.toString("hex")),
          trustDigest: digest(canonical(captured!.trust)),
          request: { ...request, expected: r!.state },
          sourcePin: captured!.sourcePin,
          targetPin: captured!.targetPin,
          source: captured!.observation,
          blueprintDigest: digest(canonical(upgradeBlueprint(r!))),
        });
        await newFile(this.file("key.txt"), key.toString("hex"));
        await newFile(this.file("root.json"), canonical(root) + "\n");
        await syncDirectory(this.options.directory);
        const s: Stored = {
          root,
          key,
          events: [],
          head: digest(canonical(root)),
          pending: false,
        };
        await this.append(s, "newly-prepared");
        await this.finish();
        return this.output(s, r);
      } finally {
        key.fill(0);
      }
    });
  }
  async status(expectedHead: string) {
    return withPublicationLock(this.options.directory, async () => {
      const s = await this.load(expectedHead, true);
      try {
        return this.output(s);
      } finally {
        s.key.fill(0);
      }
    });
  }
  async copy(expectedHead: string, confirmation: string) {
    return withPublicationLock(this.options.directory, async () => {
      const s = await this.load(expectedHead);
      assert(s.events.at(-1)!.state === "newly-prepared");
      assert(confirmation === nativeRehearsalConfirmation);
      let copied: NativeObservation | undefined, r: MigrationReview | undefined;
      await this.intent("copy");
      try {
        const result = await nativeReadiness({
          ...this.options.native,
          mode: "rehearse",
          confirmation,
          observationKey: s.key,
          onSource: async (e) => {
            r = await this.validate(e, s);
          },
          onCopy: async (value) => {
            copied = value;
          },
        });
        if (
          result.result !== "rehearsal-complete" ||
          result.backupReadiness !== "verified-fictional-round-trip" ||
          result.checks.length !== nativeReadinessChecks.length ||
          new Set(result.checks.map((c) => c.id)).size !==
            nativeReadinessChecks.length ||
          !result.checks.every(
            (c) =>
              c.status === "passed" && nativeReadinessChecks.includes(c.id),
          ) ||
          !copied
        ) {
          await this.append(s, "blocked-pending-manual-disposition");
          await this.finish();
          return this.output(s);
        }
        await this.append(s, "verified-copied-state", {
          copy: observation.parse(copied),
          nativeEvidence: digest(canonical(result)),
        });
        await this.append(s, "quarantined-for-inspection");
        await this.finish();
        return this.output(s, r);
      } finally {
        s.key.fill(0);
      }
    });
  }
  async inspect(expectedHead: string, retireConfirmation?: string) {
    return withPublicationLock(this.options.directory, async () => {
      const retirement = retireConfirmation !== undefined;
      const s = await this.load(expectedHead),
        prior = s.events.at(-1)!.state;
      assert(
        retirement
          ? prior === "inspection-completed" &&
              retireConfirmation === "RETIRE FICTIONAL COPY TRACKING"
          : prior === "quarantined-for-inspection",
      );
      const expectedCopy = s.events.find(
        (e) => e.state === "verified-copied-state",
      )?.copy;
      assert(expectedCopy);
      await this.intent(retirement ? "retire" : "inspect");
      try {
        let r: MigrationReview;
        try {
          r = await withNativeCopyInspection(
            { ...this.options.native, mode: "preflight" },
            s.key,
            async (e, copy) => {
              sameNative(expectedCopy!, copy, false);
              return this.validate(e, s);
            },
            { source: s.root.sourcePin, target: s.root.targetPin },
          );
        } catch {
          await this.append(s, "blocked-pending-manual-disposition");
          await this.finish();
          return this.output(s);
        }
        await this.append(s, retirement ? "retired" : "inspection-completed");
        await this.finish();
        return this.output(s, r);
      } finally {
        s.key.fill(0);
      }
    });
  }
}
