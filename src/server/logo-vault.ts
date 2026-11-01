import { createHash, randomUUID } from "node:crypto";
import { EngineError } from "../core/engine";
import {
  logoCommandSchema,
  logoLimits,
  type LogoAsset,
  type LogoState,
} from "../core/private-logo";
import { sanitizeLogo } from "./logo-sanitizer";
import {
  createLogoCompanion,
  inspectLogoCompanion,
  LogoCompanionError,
} from "../core/logo-companion";
interface Owner {
  expiresAt: number;
}
interface Asset {
  metadata: LogoAsset;
  bytes: Buffer;
}
interface Collection {
  revision: number;
  uploads: number;
  selected?: Asset;
  staged?: Asset;
  busy: boolean;
  receipts: Map<
    string,
    { digest: string; status: "pending" | "complete" | "failed" }
  >;
}
/** Private temporary memory only. The demo service must authorize every call; this class never accepts browser tokens/paths. */
export class LogoVault {
  private owners = new Map<Owner, Map<string, Collection>>();
  private processing = 0;
  private timer = setInterval(() => this.sweep(), 60000).unref();
  close() {
    clearInterval(this.timer);
    for (const owner of this.owners.keys()) this.drop(owner);
  }
  drop(owner: Owner) {
    const groups = this.owners.get(owner);
    if (groups)
      for (const c of groups.values()) {
        c.selected?.bytes.fill(0);
        c.staged?.bytes.fill(0);
      }
    this.owners.delete(owner);
  }
  sweep() {
    const now = Date.now();
    for (const [owner, groups] of this.owners) {
      if (owner.expiresAt <= now) {
        this.drop(owner);
        continue;
      }
      for (const c of groups.values())
        if (c.staged && c.staged.metadata.expiresAt <= now) {
          c.staged.bytes.fill(0);
          delete c.staged;
          c.revision++;
        }
    }
  }
  private collection(owner: Owner, org: string) {
    this.sweep();
    if (owner.expiresAt <= Date.now())
      throw new EngineError(
        "The private logo session ended. Start a new fictional demo.",
        401,
      );
    let groups = this.owners.get(owner);
    if (!groups) this.owners.set(owner, (groups = new Map()));
    let c = groups.get(org);
    if (!c)
      groups.set(
        org,
        (c = { revision: 0, uploads: 0, receipts: new Map(), busy: false }),
      );
    return c;
  }
  state(owner: Owner, org: string): LogoState {
    const c = this.collection(owner, org);
    return {
      revision: c.revision,
      selected: c.selected ? structuredClone(c.selected.metadata) : null,
      staged: c.staged ? structuredClone(c.staged.metadata) : null,
      remainingUploads: logoLimits.uploads - c.uploads,
      expiresAt: owner.expiresAt,
    };
  }
  private total(owner?: Owner) {
    let size = 0;
    for (const [who, groups] of this.owners)
      if (!owner || owner === who)
        for (const c of groups.values())
          size +=
            (c.selected?.bytes.length ?? 0) + (c.staged?.bytes.length ?? 0);
    return size;
  }
  private begin(
    c: Collection,
    revision: number,
    id: string,
    digest: string,
    cleanup = false,
  ) {
    const previous = c.receipts.get(id);
    if (previous) {
      if (previous.digest !== digest)
        throw new EngineError(
          "This logo operation belongs to different choices.",
          409,
        );
      if (previous.status !== "complete")
        throw new EngineError(
          "The earlier logo operation is pending or failed. Refresh, then explicitly retry with a new operation.",
          409,
        );
      return false;
    }
    if (c.busy)
      throw new EngineError(
        "Logo processing is busy. Wait and refresh before retrying.",
        423,
      );
    if (c.revision !== revision)
      throw new EngineError(
        "Private logo choices changed. Refresh before changing or removing an image.",
        409,
      );
    if (c.receipts.size >= logoLimits.mutations + (cleanup ? 2 : 0))
      throw new EngineError(
        "This session's logo operation quota is exhausted.",
        429,
      );
    c.receipts.set(id, { digest, status: "pending" });
    return true;
  }
  async stage(
    owner: Owner,
    org: string,
    bytes: Uint8Array,
    revision: number,
    operationId: string,
    reauthorize: () => Promise<void>,
    kind: "image" | "companion" = "image",
  ) {
    if (!bytes.length || bytes.length > logoLimits.inputBytes)
      throw new EngineError(
        "Choose a nonempty logo no larger than 1 MiB.",
        413,
      );
    const input = Buffer.from(bytes),
      c = this.collection(owner, org),
      digest = createHash("sha256")
        .update(String(revision))
        .update(kind === "image" ? ":upload:" : ":companion:")
        .update(input)
        .digest("hex");
    let begun: boolean;
    try {
      begun = this.begin(c, revision, operationId, digest);
    } catch (error) {
      input.fill(0);
      throw error;
    }
    if (!begun) {
      input.fill(0);
      return this.state(owner, org);
    }
    const receipt = c.receipts.get(operationId)!;
    if (
      c.uploads >= logoLimits.uploads ||
      this.processing >= logoLimits.processing ||
      this.total(owner) + logoLimits.outputBytes > logoLimits.sessionBytes ||
      this.total() + (this.processing + 1) * logoLimits.outputBytes >
        logoLimits.globalBytes
    ) {
      input.fill(0);
      receipt.status = "failed";
      throw new EngineError(
        "Private logo quota or processing capacity reached. Keep the current image or retry later with a new operation.",
        429,
      );
    }
    c.uploads++;
    c.busy = true;
    this.processing++;
    let imported: Awaited<ReturnType<typeof inspectLogoCompanion>> | undefined;
    let clean: Awaited<ReturnType<typeof sanitizeLogo>> | undefined;
    let retained = false;
    try {
      if (kind === "companion") imported = await inspectLogoCompanion(input);
      clean = await sanitizeLogo(imported?.image ?? input);
      if (
        imported &&
        (clean.width !== imported.manifest.image.width ||
          clean.height !== imported.manifest.image.height)
      )
        throw new EngineError(
          "Decoded companion dimensions changed. Nothing was staged.",
          422,
        );
      await reauthorize(); // Session and Engine role must still be valid after native work.
      if (this.collection(owner, org) !== c || c.revision !== revision)
        throw new EngineError(
          "Private logo state changed while processing. Nothing was replaced.",
          409,
        );
      c.staged?.bytes.fill(0);
      c.staged = {
        bytes: clean.bytes,
        metadata: {
          id: randomUUID(),
          width: clean.width,
          height: clean.height,
          bytes: clean.bytes.length,
          display: imported?.manifest.display ?? "square",
          ...(imported
            ? {
                companion: {
                  version: 1 as const,
                  imageSha256: imported.manifest.image.sha256,
                },
              }
            : {}),
          expiresAt: Math.min(
            owner.expiresAt,
            Date.now() + logoLimits.stagedMs,
          ),
        },
      };
      retained = true;
      c.revision++;
      receipt.status = "complete";
      return this.state(owner, org);
    } catch (error) {
      receipt.status = "failed";
      if (error instanceof LogoCompanionError)
        throw new EngineError(error.message, 422);
      throw error;
    } finally {
      input.fill(0);
      imported?.image.fill(0);
      if (!retained) clean?.bytes.fill(0);
      c.busy = false;
      this.processing--;
    }
  }
  /** Read-only export of the explicitly selected revision. Authorization is supplied by the existing demo Engine boundary. */
  async saveSelected(
    owner: Owner,
    org: string,
    id: string,
    revision: number,
    format: "png" | "companion",
    reauthorize: () => Promise<void>,
  ) {
    const c = this.collection(owner, org),
      asset = c.selected;
    if (c.busy)
      throw new EngineError(
        "Logo processing is busy. Wait and refresh before saving.",
        423,
      );
    if (c.revision !== revision || !asset || asset.metadata.id !== id)
      throw new EngineError(
        "Select the current session logo and refresh its revision before saving.",
        409,
      );
    if (this.processing >= logoLimits.processing)
      throw new EngineError(
        "Private logo processing capacity reached. Retry later.",
        429,
      );
    c.busy = true;
    this.processing++;
    const image = Buffer.from(asset.bytes);
    let output: Uint8Array | undefined;
    try {
      output =
        format === "companion"
          ? await createLogoCompanion(image, asset.metadata)
          : new Uint8Array(image);
      await reauthorize();
      if (
        this.collection(owner, org) !== c ||
        c.revision !== revision ||
        c.selected !== asset
      )
        throw new EngineError(
          "Private logo changed or expired while saving. Refresh before retrying.",
          409,
        );
      return output;
    } catch (error) {
      output?.fill(0);
      throw error;
    } finally {
      image.fill(0);
      c.busy = false;
      this.processing--;
    }
  }
  command(owner: Owner, org: string, input: unknown) {
    const command = logoCommandSchema.parse(input),
      c = this.collection(owner, org),
      digest = createHash("sha256")
        .update(JSON.stringify(command))
        .digest("hex");
    // Two reserved cleanup receipts cover the at-most-two retained images after the ordinary operation budget is exhausted.
    if (
      command.action === "remove" &&
      !c.receipts.has(command.operationId) &&
      ![c.staged, c.selected].some((a) => a?.metadata.id === command.assetId)
    )
      throw new EngineError(
        "Private logo unavailable for removal. Refresh first.",
        409,
      );
    if (
      !this.begin(
        c,
        command.revision,
        command.operationId,
        digest,
        command.action === "remove",
      )
    )
      return this.state(owner, org);
    const receipt = c.receipts.get(command.operationId)!;
    try {
      const asset = [c.staged, c.selected].find(
        (a) => a?.metadata.id === command.assetId,
      );
      if (!asset)
        throw new EngineError(
          "Logo is no longer available in this organization. Refresh before retrying.",
          409,
        );
      if (command.action === "select") {
        if (asset !== c.staged)
          throw new EngineError(
            "Only the current staged image can replace a session logo.",
            409,
          );
        c.selected?.bytes.fill(0);
        c.selected = asset;
        delete c.staged;
        asset.metadata.expiresAt = owner.expiresAt;
      } else if (command.action === "remove") {
        asset.bytes.fill(0);
        if (asset === c.staged) delete c.staged;
        else delete c.selected;
      } else asset.metadata.display = command.display!;
      c.revision++;
      receipt.status = "complete";
      return this.state(owner, org);
    } catch (error) {
      receipt.status = "failed";
      throw error;
    }
  }
  image(owner: Owner, org: string, id: string, canManage: boolean) {
    const c = this.collection(owner, org),
      asset = [c.selected, ...(canManage ? [c.staged] : [])].find(
        (a) => a?.metadata.id === id,
      );
    if (!asset) throw new EngineError("Private logo unavailable.", 404);
    return Buffer.from(asset.bytes);
  }
}
