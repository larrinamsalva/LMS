import { createHash } from "node:crypto";
import { z } from "zod";
import type { VerifiedSession } from "../../core/access";
import {
  EngineError,
  type Principal,
  type SqlConnection,
} from "../../core/engine";
import { validateConfig } from "../../core/config";
import { blueprintJson } from "../../core/blueprint";
import {
  BRANDED_BUNDLE_LIMIT,
  BrandedBundleError,
  inspectBrandedBlueprintBundle,
} from "../../core/branded-bundle";
import { inspectLogoCompanion } from "../../core/logo-companion";
import { durableLogoLimits } from "../../core/logo-assets";
import {
  logoTransferCommand,
  logoTransferExpected,
  logoTransferReview,
  logoTransferSource,
  privateLogoDestinationMap,
  privateLogoTransferHistory,
} from "../../core/logo-transfers";
import { reserveLogoProcessing } from "../logo-processing";
import { sanitizeLogo } from "../logo-sanitizer";

type Scope = <T>(
  actor: Principal,
  org: string,
  fn: (tx: SqlConnection) => Promise<T>,
) => Promise<T>;
/** Resolve with existing local-auth identity(headers), never JSON, a claimed actor or a demo cookie. */
export type LogoTransferIdentity = () => Promise<VerifiedSession | null>;
const verifiedSession = z
  .object({ userId: z.uuid(), sessionId: z.uuid() })
  .strict();
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const stateSchema = z
  .object({
    configuration: z.unknown(),
    expected: logoTransferExpected,
    usage: z
      .object({
        assets: z.number().int().nonnegative(),
        bytes: z.number().int().nonnegative(),
        operations: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
function capture(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > BRANDED_BUNDLE_LIMIT)
    throw new EngineError(
      "Choose a nonempty branded bundle no larger than 384 KiB.",
      413,
    );
  return Buffer.from(bytes); // Snapshot before any asynchronous identity, digest or decoder work.
}
async function current(resolve: LogoTransferIdentity) {
  const value = await resolve();
  if (!value)
    throw new EngineError(
      "Sign in locally again before private logo transfer.",
      401,
    );
  return verifiedSession.parse(value);
}
/** Internal extension of existing restricted pool, independent trust allowlist and maintenance lease. No HTTP surface. */
export function privateLogoTransfers(
  scoped: Scope,
  instance: string,
  failure: (error: unknown) => never,
) {
  async function call<T>(
    session: VerifiedSession,
    org: string,
    fn: (tx: SqlConnection) => Promise<T>,
  ) {
    return scoped({ userId: session.userId }, org, async (tx) => {
      const ready = (
        await tx.query<{ ready: boolean }>(
          "select to_regprocedure('lms.logo_transfer_operation(uuid,uuid,uuid,jsonb,bytea)') is not null as ready",
        )
      ).rows[0].ready;
      if (!ready)
        throw new EngineError(
          "Private transfer requires reviewed migration 15. No automatic migration or fallback storage is provided.",
          409,
        );
      return fn(tx);
    });
  }
  async function state(session: VerifiedSession, org: string) {
    return call(session, org, async (tx) => {
      const data = stateSchema.parse(
        (
          await tx.query<{ document: unknown }>(
            "select lms.logo_transfer_state($1,$2,$3) as document",
            [org, instance, session.sessionId],
          )
        ).rows[0].document,
      );
      return { ...data, configuration: validateConfig(data.configuration) };
    });
  }
  function capacity(
    usage: z.infer<typeof stateSchema>["usage"],
    extraBytes = 0,
  ) {
    if (
      usage.assets >= durableLogoLimits.assets ||
      usage.bytes + extraBytes > durableLogoLimits.bytes ||
      usage.operations >= durableLogoLimits.operations
    )
      throw new EngineError(
        "Retained private logo quota is exhausted. Retirement never refunds storage or operation budgets.",
        409,
      );
  }
  async function inspect(bytes: Uint8Array) {
    const bundle = await inspectBrandedBlueprintBundle(bytes);
    try {
      if (!bundle.logoBytes || !bundle.logo || !bundle.manifest.logo)
        throw new EngineError(
          "This bundle has no logo companion to transfer. Nothing was stored.",
          400,
        );
      const companion = await inspectLogoCompanion(bundle.logoBytes);
      try {
        const m = bundle.manifest,
          image = companion.manifest.image;
        const source = logoTransferSource.parse({
          bundleVersion: 1,
          bundleSha256: hash(bytes),
          bundleBytes: bytes.length,
          blueprintVersion: m.compatibility.blueprintPackage,
          blueprintSha256: m.blueprint.sha256,
          blueprintBytes: m.blueprint.bytes,
          buildPlanVersion: m.compatibility.buildPlan,
          configurationSchema: m.compatibility.configurationSchema,
          companionVersion: 1,
          companionSha256: m.logo!.sha256,
          companionBytes: m.logo!.bytes,
          imageSha256: hash(companion.image),
          imageBytes: image.bytes,
          imageWidth: image.width,
          imageHeight: image.height,
          display: companion.manifest.display,
        });
        return {
          source,
          blueprint: bundle.blueprint,
          image: Buffer.from(companion.image),
        };
      } finally {
        companion.image.fill(0);
      }
    } finally {
      bundle.blueprintBytes.fill(0);
      bundle.logoBytes?.fill(0);
    }
  }
  function refuse(error: unknown): never {
    if (error instanceof BrandedBundleError)
      throw new EngineError(error.message, 400);
    return failure(error);
  }
  async function operation(
    session: VerifiedSession,
    org: string,
    command: z.infer<typeof logoTransferCommand>,
    image: Buffer | null,
  ) {
    return call(session, org, async (tx) => {
      const result = privateLogoDestinationMap.parse(
        (
          await tx.query<{ document: unknown }>(
            "select lms.logo_transfer_operation($1,$2,$3,$4,$5) as document",
            [org, instance, session.sessionId, command, image],
          )
        ).rows[0].document,
      );
      // SQL holds the original organization/publication fence through COMMIT.
      // Failure of the complete versioned reader aborts ALL asset/history/receipt/audit effects.
      const row = (
        await tx.query<{ document: unknown }>(
          "select document from lms.config_revisions where organization_id=$1 order by revision desc limit 1",
          [org],
        )
      ).rows[0];
      validateConfig(row?.document);
      return result;
    });
  }
  return {
    async review(
      resolve: LogoTransferIdentity,
      org: string,
      input: Uint8Array,
    ) {
      z.uuid().parse(org);
      const bytes = capture(input);
      let imported: Awaited<ReturnType<typeof inspect>> | undefined;
      try {
        const session = await current(resolve);
        const destination = await state(session, org);
        capacity(destination.usage); // Refuse authority/capability/quota before expensive work.
        imported = await inspect(bytes);
        const review = await call(session, org, async (tx) =>
          logoTransferReview.parse(
            (
              await tx.query<{ document: unknown }>(
                "select lms.logo_transfer_review($1,$2,$3,$4) as document",
                [org, instance, session.sessionId, imported!.source],
              )
            ).rows[0].document,
          ),
        );
        if (
          blueprintJson(review.expected) !== blueprintJson(destination.expected)
        )
          throw new EngineError(
            "Destination changed during review. Explicitly refresh.",
            409,
          );
        return {
          review,
          blueprint: imported.blueprint,
          destinationConfiguration: destination.configuration,
          usage: destination.usage,
        };
      } catch (error) {
        return refuse(error);
      } finally {
        bytes.fill(0);
        imported?.image.fill(0);
      }
    },
    async accept(
      resolve: LogoTransferIdentity,
      org: string,
      input: Uint8Array,
      value: unknown,
    ) {
      z.uuid().parse(org);
      const command = logoTransferCommand.parse(value),
        bytes = capture(input);
      let imported: Awaited<ReturnType<typeof inspect>> | undefined;
      let clean: Awaited<ReturnType<typeof sanitizeLogo>> | undefined;
      let release: (() => void) | undefined;
      try {
        const session = await current(resolve),
          r = command.review;
        if (
          r.organizationId !== org ||
          r.instanceId !== instance ||
          r.actorId !== session.userId
        )
          throw new EngineError(
            "Transfer review belongs to a different destination, instance or operator.",
            409,
          );
        const destination = await state(session, org);
        imported = await inspect(bytes);
        if (blueprintJson(imported.source) !== blueprintJson(r.source))
          throw new EngineError(
            "Exact bundle or image bytes changed since review. Review the chosen file again.",
            409,
          );
        const committed = await call(
          session,
          org,
          async (tx) =>
            (
              await tx.query(
                "select 1 from lms.logo_transfer_receipts where organization_id=$1 and operation_id=$2",
                [org, command.operationId],
              )
            ).rows.length > 0,
        );
        if (committed) return await operation(session, org, command, null);
        if (blueprintJson(destination.expected) !== blueprintJson(r.expected))
          throw new EngineError(
            "Destination revisions changed. Explicitly refresh transfer review.",
            409,
          );
        capacity(destination.usage);
        release = reserveLogoProcessing();
        clean = await sanitizeLogo(imported.image); // No manifest, checksum or signature bypass.
        if (
          clean.width !== r.source.imageWidth ||
          clean.height !== r.source.imageHeight
        )
          throw new EngineError(
            "Sanitized dimensions differ from the reviewed image.",
            422,
          );
        capacity(destination.usage, clean.bytes.length);
        const fresh = await current(resolve);
        if (
          fresh.userId !== session.userId ||
          fresh.sessionId !== session.sessionId
        )
          throw new EngineError(
            "Verified local session changed during processing. Sign in and review again.",
            401,
          );
        // SQL rechecks/locks the actual session and current membership after decoding through commit.
        return await operation(fresh, org, command, clean.bytes);
      } catch (error) {
        return refuse(error);
      } finally {
        bytes.fill(0);
        imported?.image.fill(0);
        clean?.bytes.fill(0);
        release?.();
      }
    },
    async history(resolve: LogoTransferIdentity, org: string) {
      const session = await current(resolve);
      return call(session, org, async (tx) =>
        privateLogoTransferHistory.parse(
          (
            await tx.query<{ document: unknown }>(
              "select lms.logo_transfer_history($1,$2,$3) as document",
              [org, instance, session.sessionId],
            )
          ).rows[0].document,
        ),
      );
    },
  };
}
