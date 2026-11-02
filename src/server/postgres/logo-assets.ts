import { createHash } from "node:crypto";
import { z } from "zod";
import {
  Engine,
  EngineError,
  type Principal,
  type SqlConnection,
} from "../../core/engine";
import {
  durableLogoChange,
  durableLogoHistory,
  durableLogoMetadata,
  durableLogoReceipt,
  durableLogoSnapshot,
  durableLogoStoreCommand,
} from "../../core/logo-assets";
import { logoLimits } from "../../core/private-logo";
import { sanitizeLogo } from "../logo-sanitizer";
import { reserveLogoProcessing } from "../logo-processing";
import { readPrivateText } from "../recovery/private-file";
import { nativeTrustSchema } from "./native-readiness";
import { connectPostgres } from "./adapter";
import { localTarget } from "./targets";

const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const id = z.uuid();
function failure(error: unknown): never {
  if (error instanceof EngineError) throw error;
  if (error instanceof z.ZodError)
    throw new EngineError(
      "Invalid private logo contract or command. Review version 1 and current revisions.",
      400,
    );
  const code = (error as { code?: string })?.code;
  if (code === "42501")
    throw new EngineError(
      "Private logo access is unavailable for this organization, role or asset state.",
      403,
    );
  if (["40001", "40P01", "55P03", "23503", "23505"].includes(code ?? ""))
    throw new EngineError(
      "Private logo state changed or the retry conflicts. Refresh before an explicit retry.",
      409,
    );
  if (code === "23514")
    throw new EngineError(
      "Private logo integrity, lifecycle or retained-storage quota refused the operation. Inspect current metadata; no bytes were deleted.",
      409,
    );
  if (code === "55000")
    throw new EngineError(
      "Private logo database is blocked, under maintenance or has a different instance identity.",
      409,
    );
  throw new EngineError(
    "Private logo storage failed. Keep the database private and inspect host tooling; no native diagnostics or image values are returned.",
    503,
  );
}

/** Trusted host code only. Principals must come from the existing verified local identity adapter or reviewed fictional test tooling. */
export async function openPrivateLogoStore(options: {
  databaseUrl: string;
  trustFile: string;
}) {
  const trust = nativeTrustSchema.parse(
    JSON.parse(await readPrivateText(options.trustFile, 8192)),
  );
  const target = localTarget(options.databaseUrl, trust.source.database);
  if (target.hostname === "localhost" || target.hash || !target.password)
    throw new EngineError(
      "Private logo storage requires the allowlisted fictional source on an exact literal loopback endpoint.",
      403,
    );
  // Reuse the restricted login verifier, pool and recovery/maintenance lease. No owner or administrator connection is accepted.
  const db = await connectPostgres({
    connectionString: target.toString(),
    maxConnections: 2,
  });
  const engine = new Engine(db);
  async function scoped<T>(
    principal: Principal,
    organizationId: string,
    fn: (tx: SqlConnection) => Promise<T>,
  ) {
    id.parse(organizationId);
    if (!trust.source.organizations.includes(organizationId))
      throw new EngineError(
        "Organization is outside the private fictional trust allowlist.",
        403,
      );
    try {
      return await engine.asUser(principal, fn);
    } catch (error) {
      return failure(error);
    }
  }
  try {
    await db.transaction(async (tx) => {
      await tx.exec("set local role lms_app");
      const { rows } = await tx.query<{ ready: boolean }>(
        `select current_database()=$1
        and exists(select 1 from lms_control.state where singleton and instance_id=$2 and not blocked)
        and not lms_control.is_blocked()
        and to_regprocedure('lms.logo_operation(uuid,uuid,jsonb,bytea)') is not null as ready`,
        [trust.source.database, trust.source.instanceId],
      );
      if (!rows[0]?.ready)
        throw new EngineError(
          "Private logo storage requires migration 13 and the exact unblocked trusted source instance.",
          409,
        );
    });
  } catch (error) {
    await db.close();
    return failure(error);
  }
  async function snapshot(principal: Principal, org: string) {
    return scoped(principal, org, async (tx) => {
      const row = (
        await tx.query<{ document: unknown }>(
          "select lms.logo_snapshot($1,$2) as document",
          [org, trust.source.instanceId],
        )
      ).rows[0];
      const state = durableLogoSnapshot.parse(row.document);
      if (
        state.assets.some((a) => a.organizationId !== org) ||
        new Set(state.assets.map((a) => a.id)).size !== state.assets.length ||
        state.assets.filter((a) => a.state === "selected").length !==
          (state.selectedId ? 1 : 0) ||
        (state.selectedId &&
          !state.assets.some(
            (a) => a.id === state.selectedId && a.state === "selected",
          ))
      )
        throw new EngineError(
          "Private asset selection history is inconsistent. Keep assets blocked for inspection.",
          409,
        );
      return state;
    });
  }
  async function read(
    principal: Principal,
    org: string,
    assetId: string,
    revision: number,
  ) {
    id.parse(assetId);
    z.number().int().positive().parse(revision);
    const release = reserveLogoProcessing();
    let image: Buffer | undefined,
      clean: Awaited<ReturnType<typeof sanitizeLogo>> | undefined;
    try {
      const row = await scoped(
        principal,
        org,
        async (tx) =>
          (
            await tx.query<{ image: Buffer; metadata: unknown }>(
              "select * from lms.logo_read($1,$2,$3,$4)",
              [org, trust.source.instanceId, assetId, revision],
            )
          ).rows[0],
      );
      image = row.image;
      const metadata = durableLogoMetadata.parse(row.metadata);
      if (
        metadata.organizationId !== org ||
        metadata.id !== assetId ||
        metadata.revision !== revision ||
        image.length !== metadata.bytes ||
        hash(image) !== metadata.sha256
      )
        throw new EngineError(
          "Stored private logo integrity failed. Keep it unavailable for inspection.",
          409,
        );
      // Validate even restored/administrator-damaged bytes using the SAME reviewed decoder and output profile.
      clean = await sanitizeLogo(image);
      if (
        clean.width !== metadata.width ||
        clean.height !== metadata.height ||
        clean.bytes.length !== metadata.bytes ||
        hash(clean.bytes) !== metadata.sha256
      )
        throw new EngineError(
          "Stored private logo no longer matches its reviewed sanitizer profile. Keep it unavailable for inspection.",
          409,
        );
      // Recheck live membership, state and revision after native work, without returning that second byte copy.
      await scoped(principal, org, async (tx) => {
        const again = (
          await tx.query<{ image: Buffer; metadata: unknown }>(
            "select * from lms.logo_read($1,$2,$3,$4)",
            [org, trust.source.instanceId, assetId, revision],
          )
        ).rows[0];
        again.image.fill(0);
      });
      return { metadata, bytes: new Uint8Array(image) };
    } catch (error) {
      if (error instanceof EngineError && error.status === 422)
        throw new EngineError(
          "Stored private logo cannot be safely decoded. Keep it unavailable for inspection.",
          409,
        );
      return failure(error);
    } finally {
      image?.fill(0);
      clean?.bytes.fill(0);
      release();
    }
  }
  async function operation(
    principal: Principal,
    org: string,
    command: object,
    image: Buffer | null,
  ) {
    return scoped(principal, org, async (tx) =>
      durableLogoReceipt.parse(
        (
          await tx.query<{ document: unknown }>(
            "select lms.logo_operation($1,$2,$3,$4) as document",
            [org, trust.source.instanceId, command, image],
          )
        ).rows[0].document,
      ),
    );
  }
  return {
    snapshot,
    read,
    async history(principal: Principal, org: string) {
      return scoped(principal, org, async (tx) =>
        durableLogoHistory.parse(
          (
            await tx.query<{ document: unknown }>(
              "select lms.logo_history($1,$2) as document",
              [org, trust.source.instanceId],
            )
          ).rows[0].document,
        ),
      );
    },
    async store(
      principal: Principal,
      org: string,
      bytes: Uint8Array,
      input: unknown,
    ) {
      const command = durableLogoStoreCommand.parse(input);
      if (!bytes.length || bytes.length > logoLimits.inputBytes)
        throw new EngineError(
          "Choose a nonempty fictional logo no larger than 1 MiB.",
          413,
        );
      if (!(await snapshot(principal, org)).canManage)
        throw new EngineError(
          "Owner/admin authority is required to store a private logo.",
          403,
        );
      const release = reserveLogoProcessing(),
        original = Buffer.from(bytes);
      let clean: Awaited<ReturnType<typeof sanitizeLogo>> | undefined;
      try {
        clean = await sanitizeLogo(original);
        return await operation(
          principal,
          org,
          { ...command, action: "store", inputSha256: hash(original) },
          clean.bytes,
        );
      } catch (error) {
        return failure(error);
      } finally {
        original.fill(0);
        clean?.bytes.fill(0);
        release();
      }
    },
    async change(principal: Principal, org: string, input: unknown) {
      const command = durableLogoChange.parse(input);
      if (!(await snapshot(principal, org)).canManage)
        throw new EngineError(
          "Owner/admin authority is required to change a private logo.",
          403,
        );
      const applied = await scoped(
        principal,
        org,
        async (tx) =>
          (
            await tx.query(
              "select 1 from lms.logo_asset_receipts where organization_id=$1 and operation_id=$2",
              [org, command.operationId],
            )
          ).rows.length > 0,
      );
      // A prior receipt is checked by the same SQL command/actor digest, before stale asset preconditions.
      if (applied) return operation(principal, org, command, null);
      if (["select", "restore"].includes(command.action)) {
        const checked = await read(
          principal,
          org,
          command.assetId,
          command.assetRevision,
        );
        checked.bytes.fill(0);
      }
      return operation(principal, org, command, null);
    },
    close: () => db.close(),
  };
}
