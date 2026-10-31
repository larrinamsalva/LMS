import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { EngineError } from "../../core/engine";
import { canonical, digest, readTrust } from "../recovery/trust";
import { readPrivateText } from "../recovery/private-file";
import {
  assertFresh,
  checkpointDigest,
  hexDigest,
  verifyJournal,
  type Journal,
} from "../lineage/protocol";
import {
  rootSchema,
  recordSchema,
  publicationSchema,
  requestSchema,
  verifyPublication,
  verifySuccessor,
  receiptDigest,
  type Root,
  type PublicationRecord,
} from "./protocol";
import {
  privateDirectory,
  syncDirectory,
  newFile,
  completeFile,
  withPublicationLock,
  recordLimit,
  storeLimit,
} from "./files";
const filename = (generation: number) =>
  String(generation).padStart(3, "0") + ".json";
const encode = (value: unknown) => canonical(value) + "\n";
interface Options {
  directory: string;
  trustFile: string;
  expectedRootDigest?: string;
}
type TrustFile = Awaited<ReturnType<typeof readTrust>>;
export class CheckpointPublisher {
  constructor(private readonly options: Options) {}
  /** Failure-injection boundary for tests, never configurable through CLI/environment/input. */
  protected async afterDurabilityStep(_step: string): Promise<void> {}
  private file(name: string) {
    return path.join(this.options.directory, name);
  }
  private async locked<T>(fn: (trust: TrustFile) => Promise<T>) {
    return withPublicationLock(this.options.directory, async () =>
      fn(await readTrust(this.options.trustFile)),
    );
  }
  private async load(trust: TrustFile, allowPending = false) {
    if (!this.options.expectedRootDigest)
      throw new EngineError("Independent publication root pin required.", 403);
    hexDigest.parse(this.options.expectedRootDigest);
    const root = rootSchema.parse(
      JSON.parse(await readPrivateText(this.file("root.json"), 4096)),
    );
    if (
      digest(canonical(root)) !== this.options.expectedRootDigest ||
      root.registryDigest !== trust.digest
    )
      throw new EngineError(
        "Publication root or registry differs from independent custody.",
        403,
      );
    const names = await readdir(this.options.directory);
    if (
      names.length > 131 ||
      names.some(
        (n) =>
          !["root.json", ".lock", "pending.json"].includes(n) &&
          !/^\d{3}\.json$/.test(n),
      )
    )
      throw new EngineError(
        "Unknown or excessive publication files; review custody offline.",
        409,
      );
    const pending = names.includes("pending.json");
    if (pending && !allowPending)
      throw new EngineError(
        "Incomplete publication. Resume its exact approved intent; no older head is accepted.",
        423,
      );
    const files = names.filter((n) => /^\d{3}\.json$/.test(n)).sort();
    let previous: PublicationRecord | undefined,
      total = 0;
    const receipts: string[] = [];
    const publicationIds: string[] = [];
    for (const [index, file] of files.entries()) {
      if (file !== filename(index + 1) || index >= 128)
        throw new EngineError(
          "Publication history is missing or out of order.",
          409,
        );
      total += (await stat(this.file(file))).size;
      if (total > storeLimit)
        throw new EngineError("Publication store limit exceeded.", 409);
      let row: PublicationRecord;
      try {
        row = recordSchema.parse(
          JSON.parse(await readPrivateText(this.file(file), recordLimit)),
        );
      } catch (error) {
        if (allowPending && pending && index === files.length - 1)
          return { root, previous, receipts, publicationIds, total, pending, partial: file };
        throw error;
      }
      verifyPublication(row, root, trust.registry, new Date());
      if (
        publicationIds.includes(row.publication.request.publicationId) ||
        row.publication.request.generation !== index + 1 ||
        row.publication.request.previousReceiptDigest !==
          (receipts.at(-1) ?? null)
      )
        throw new EngineError("Conflicting receipt chain.", 409);
      verifySuccessor(row.journal, root, previous);
      receipts.push(receiptDigest(row.publication));
      publicationIds.push(row.publication.request.publicationId);
      previous = row;
    }
    return { root, previous, receipts, publicationIds, total, pending, partial: undefined };
  }
  async initialize(journal: Journal, value: unknown) {
    const input = z
      .object({
        expectedCheckpointDigest: hexDigest,
        confirmation: z.literal("INITIALIZE FICTIONAL PUBLICATION CUSTODY"),
      })
      .strict()
      .parse(value);
    if (this.options.expectedRootDigest)
      throw new EngineError(
        "Initialization cannot replace an independently pinned root.",
        403,
      );
    await privateDirectory(path.dirname(this.options.directory));
    const trust = await readTrust(this.options.trustFile);
    const verified = verifyJournal(
      journal,
      trust.registry,
      trust.digest,
      input.expectedCheckpointDigest,
      new Date(),
    );
    const root: Root = {
      protocol: "lms-publication-root-v1",
      id: randomUUID(),
      streamId: verified.journal.streamId,
      registryDigest: trust.digest,
      initialCheckpointDigest: input.expectedCheckpointDigest,
      fictionalOnly: true,
    };
    verifySuccessor(verified.journal, root);
    // An interrupted initialization remains unusable; an existing store is never adopted/reset.
    await mkdir(this.options.directory, { mode: 0o700 });
    await syncDirectory(path.dirname(this.options.directory));
    await newFile(this.file("root.json"), encode(root));
    await syncDirectory(this.options.directory);
    return {
      root,
      rootDigest: digest(canonical(root)),
      activationAllowed: false as const,
    };
  }
  async review(journal: Journal, value: unknown) {
    const input = z
      .object({
        expectedReceiptDigest: hexDigest.nullable(),
        confirmation: z.literal("REVIEW FICTIONAL CHECKPOINT PUBLICATION"),
      })
      .strict()
      .parse(value);
    return this.locked(async (trust) => {
      const state = await this.load(trust),
        last = state.receipts.at(-1) ?? null;
      if (last !== input.expectedReceiptDigest)
        throw new EngineError(
          "Latest receipt differs from independent review.",
          409,
        );
      const cpDigest = checkpointDigest(journal.checkpoints.at(-1)!);
      const verified = verifyJournal(
        journal,
        trust.registry,
        trust.digest,
        cpDigest,
        new Date(),
      );
      verifySuccessor(verified.journal, state.root, state.previous);
      const now = new Date();
      assertFresh(verified.latest, now);
      return requestSchema.parse({
        protocol: "lms-checkpoint-publication-v1",
        storeId: state.root.id,
        streamId: state.root.streamId,
        registryDigest: trust.digest,
        publicationId: randomUUID(),
        generation: state.receipts.length + 1,
        previousReceiptDigest: last,
        checkpointDigest: cpDigest,
        journalDigest: digest(canonical(verified.journal)),
        createdAt: now.toISOString(),
        expiresAt: new Date(
          Math.min(
            now.getTime() + 300000,
            Date.parse(verified.latest.expiresAt),
          ),
        ).toISOString(),
      });
    });
  }
  private fresh(row: PublicationRecord) {
    const now = new Date();
    assertFresh(row.journal.checkpoints.at(-1)!.checkpoint, now);
    if (
      Date.parse(row.publication.request.createdAt) > now.getTime() ||
      Date.parse(row.publication.request.expiresAt) <= now.getTime()
    )
      throw new EngineError(
        "Publication approval expired. Custody remains blocked.",
        410,
      );
  }
  private async finish(row: PublicationRecord) {
    const text = encode(row);
    this.fresh(row);
    await completeFile(
      this.file(filename(row.publication.request.generation)),
      text,
    );
    await this.afterDurabilityStep("record-synced");
    await syncDirectory(this.options.directory);
    await this.afterDurabilityStep("record-directory-synced");
    this.fresh(row);
    await unlink(this.file("pending.json"));
    await this.afterDurabilityStep("pending-removed");
    await syncDirectory(this.options.directory);
    await this.afterDurabilityStep("completion-directory-synced");
    return {
      receipt: row.publication,
      receiptDigest: receiptDigest(row.publication),
      checkpointDigest: row.publication.request.checkpointDigest,
      activationAllowed: false as const,
    };
  }
  async publish(journal: Journal, value: unknown) {
    const input = z
      .object({
        publication: publicationSchema,
        confirmation: z.literal("PUBLISH VERIFIED FICTIONAL CHECKPOINT"),
      })
      .strict()
      .parse(value);
    return this.locked(async (trust) => {
      const state = await this.load(trust),
        r = input.publication.request;
      if (
        state.publicationIds.includes(r.publicationId) ||
        r.generation !== state.receipts.length + 1 ||
        r.previousReceiptDigest !== (state.receipts.at(-1) ?? null)
      )
        throw new EngineError("Competing, replayed or stale publication.", 409);
      const row = recordSchema.parse({
        protocol: "lms-publication-record-v1",
        publication: input.publication,
        journal,
      });
      verifyPublication(row, state.root, trust.registry, new Date());
      verifySuccessor(row.journal, state.root, state.previous);
      this.fresh(row);
      const text = encode(row);
      if (
        Buffer.byteLength(text) > recordLimit ||
        state.total + Buffer.byteLength(text) > storeLimit
      )
        throw new EngineError(
          "Publication capacity exceeded; no pruning is supported.",
          409,
        );
      await newFile(this.file("pending.json"), text);
      await this.afterDurabilityStep("intent-synced");
      await syncDirectory(this.options.directory);
      await this.afterDurabilityStep("intent-directory-synced");
      return this.finish(row);
    });
  }
  async resume(value: unknown) {
    const input = z
      .object({
        expectedPublicationDigest: hexDigest,
        confirmation: z.literal("RESUME THE EXACT APPROVED PUBLICATION"),
      })
      .strict()
      .parse(value);
    return this.locked(async (trust) => {
      const state = await this.load(trust, true);
      if (!state.pending)
        throw new EngineError(
          "No interrupted publication exists. Verify the independently retained receipt.",
          409,
        );
      const row = recordSchema.parse(
        JSON.parse(
          await readPrivateText(this.file("pending.json"), recordLimit),
        ),
      );
      verifyPublication(row, state.root, trust.registry, new Date());
      if (receiptDigest(row.publication) !== input.expectedPublicationDigest)
        throw new EngineError(
          "Pending publication differs from independent approval.",
          403,
        );
      const same = state.receipts.at(-1) === input.expectedPublicationDigest;
      if (same) {
        if (canonical(state.previous) !== canonical(row))
          throw new EngineError(
            "Pending and recorded publications conflict.",
            409,
          );
      } else {
        if (
          state.publicationIds.includes(row.publication.request.publicationId) ||
          row.publication.request.generation !== state.receipts.length + 1 ||
          row.publication.request.previousReceiptDigest !==
            (state.receipts.at(-1) ?? null) ||
          (state.partial &&
            state.partial !== filename(row.publication.request.generation))
        )
          throw new EngineError(
            "Interrupted publication is not the exact next generation.",
            409,
          );
        verifySuccessor(row.journal, state.root, state.previous);
      }
      const textSize = Buffer.byteLength(encode(row));
      const existingSize = same
        ? (await stat(this.file(filename(row.publication.request.generation))))
            .size
        : state.partial
          ? (await stat(this.file(state.partial))).size
          : 0;
      if (
        textSize > recordLimit ||
        state.total - existingSize + textSize > storeLimit
      )
        throw new EngineError("Publication capacity exceeded.", 409);
      return this.finish(row);
    });
  }
  async verify(value: unknown) {
    const input = z
      .object({
        minimumReceiptDigest: hexDigest,
        confirmation: z.literal("VERIFY PUBLISHED FICTIONAL CHECKPOINT"),
      })
      .strict()
      .parse(value);
    return this.locked(async (trust) => {
      const state = await this.load(trust);
      if (
        !state.previous ||
        !state.receipts.includes(input.minimumReceiptDigest)
      )
        throw new EngineError(
          "Independently retained receipt is missing; possible store rollback or fork.",
          409,
        );
      assertFresh(
        state.previous.journal.checkpoints.at(-1)!.checkpoint,
        new Date(),
      );
      return {
        receipt: state.previous.publication,
        receiptDigest: state.receipts.at(-1)!,
        checkpointDigest: state.previous.publication.request.checkpointDigest,
        journal: state.previous.journal,
        activationAllowed: false as const,
      };
    });
  }
}
