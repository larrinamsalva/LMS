import { z } from "zod";
import { validateConfig } from "../../core/config";
import {
  EngineError,
  type Principal,
  type SqlConnection,
} from "../../core/engine";
import { logoDisplay } from "../../core/private-logo";
import {
  logoAssociation,
  logoAssociationCommand,
  logoAssociationHistory,
  logoAssociationInspection,
  logoAssociationReview,
} from "../../core/logo-associations";
import type { DurableLogoMetadata } from "../../core/logo-assets";
import { readVerifiedStoredLogo } from "../stored-logo-reader";

type Scope = <T>(
  actor: Principal,
  org: string,
  fn: (tx: SqlConnection) => Promise<T>,
) => Promise<T>;
/** Internal extension of the EXISTING trusted store; no second connection, identity resolver or trust file. */
export function privateLogoAssociations(
  scoped: Scope,
  instance: string,
  readAsset: (
    actor: Principal,
    org: string,
    asset: string,
    revision: number,
  ) => Promise<{ metadata: DurableLogoMetadata; bytes: Uint8Array }>,
  failure: (error: unknown) => never,
) {
  const actor = (p: Principal) => ({ userId: z.uuid().parse(p.userId) });
  async function call<T>(
    principal: Principal,
    org: string,
    fn: (tx: SqlConnection) => Promise<T>,
  ) {
    return scoped(principal, org, async (tx) => {
      const ready = (
        await tx.query<{ ready: boolean }>(
          "select to_regprocedure('lms.logo_association_operation(uuid,uuid,jsonb)') is not null as ready",
        )
      ).rows[0].ready;
      if (!ready)
        throw new EngineError(
          "Host-only private logo association requires reviewed migration 14; no automatic migration is performed.",
          409,
        );
      return fn(tx);
    });
  }
  async function inspect(principal: Principal, org: string) {
    const result = await call(principal, org, async (tx) =>
      logoAssociationInspection.parse(
        (
          await tx.query<{ document: unknown }>(
            "select lms.logo_association_inspect($1,$2) as document",
            [org, instance],
          )
        ).rows[0].document,
      ),
    );
    if (
      result.organizationId !== org ||
      (result.association && result.association.organizationId !== org)
    )
      throw new EngineError(
        "Private association organization mismatch; keep the built-in fallback.",
        409,
      );
    return { ...result, configuration: validateConfig(result.configuration) };
  }
  return {
    inspect,
    async history(principal: Principal, org: string) {
      return call(principal, org, async (tx) =>
        logoAssociationHistory.parse(
          (
            await tx.query<{ document: unknown }>(
              "select lms.logo_association_history($1,$2) as document",
              [org, instance],
            )
          ).rows[0].document,
        ),
      );
    },
    async review(principal: Principal, org: string, input: unknown) {
      principal = actor(principal);
      const options = z
        .object({
          mode: z.enum(["image", "builtin"]),
          display: logoDisplay.nullable(),
          historyRevision: z.number().int().positive().nullable(),
        })
        .strict()
        .parse(input);
      const result = await call(principal, org, async (tx) =>
        logoAssociationReview.parse(
          (
            await tx.query<{ document: unknown }>(
              "select lms.logo_association_review($1,$2,$3,$4,$5) as document",
              [
                org,
                instance,
                options.mode,
                options.display,
                options.historyRevision,
              ],
            )
          ).rows[0].document,
        ),
      );
      // The existing versioned reader remains authoritative, even before a review is displayed.
      const state = await inspect(principal, org);
      if (
        state.configurationRevision !== result.configurationRevision ||
        state.configurationSha256 !== result.configurationSha256
      )
        throw new EngineError(
          "Published configuration changed during review. Explicitly refresh.",
          409,
        );
      if (result.asset) {
        const checked = await readAsset(
          principal,
          org,
          result.asset.id,
          result.asset.revision,
        );
        checked.bytes.fill(0);
      }
      return result;
    },
    async apply(principal: Principal, org: string, input: unknown) {
      principal = actor(principal);
      const command = logoAssociationCommand.parse(input);
      if (
        command.review.organizationId !== org ||
        command.review.actorId !== principal.userId
      )
        throw new EngineError(
          "Association review belongs to a different organization or actor.",
          409,
        );
      const applied = await call(principal, org, async (tx) => {
        if (
          !(
            await tx.query<{ allowed: boolean }>(
              "select lms.has_role($1,array['owner','admin']) as allowed",
              [org],
            )
          ).rows[0].allowed
        )
          throw new EngineError(
            "Current owner/admin authority is required to change private branding.",
            403,
          );
        return (
          (
            await tx.query(
              "select 1 from lms.logo_association_receipts where organization_id=$1 and operation_id=$2",
              [org, command.operationId],
            )
          ).rows.length > 0
        );
      });
      if (!applied && command.review.asset) {
        const checked = await readAsset(
          principal,
          org,
          command.review.asset.id,
          command.review.asset.revision,
        );
        try {
          if (checked.metadata.sha256 !== command.review.asset.sha256)
            throw new EngineError(
              "Reviewed image digest changed. Inspect the retained image again.",
              409,
            );
        } finally {
          checked.bytes.fill(0);
        }
      }
      return call(principal, org, async (tx) => {
        const result = logoAssociation.parse(
          (
            await tx.query<{ document: unknown }>(
              "select lms.logo_association_operation($1,$2,$3) as document",
              [org, instance, command],
            )
          ).rows[0].document,
        );
        // The operation holds the organization/publication lock until this transaction commits.
        // Review data is not proof that the COMPLETE current configuration was validated.
        // If validation fails, Engine.asUser rolls back every association/receipt/audit effect.
        const current = (
          await tx.query<{ document: unknown }>(
            "select document from lms.config_revisions where organization_id=$1 order by revision desc limit 1",
            [org],
          )
        ).rows[0];
        validateConfig(current?.document);
        return result;
      });
    },
    async read(principal: Principal, org: string) {
      principal = actor(principal);
      const inspection = await inspect(principal, org);
      if (inspection.status !== "active" || !inspection.association?.asset)
        return { inspection, logo: null };
      const association = inspection.association;
      try {
        const logo = await readVerifiedStoredLogo(
          () =>
            call(
              principal,
              org,
              async (tx) =>
                (
                  await tx.query<{ image: Buffer; metadata: unknown }>(
                    "select * from lms.logo_association_read($1,$2,$3,$4)",
                    [
                      org,
                      instance,
                      inspection.revision,
                      inspection.configurationRevision,
                    ],
                  )
                ).rows[0],
            ),
          org,
          { id: association.asset!.id, sha256: association.asset!.sha256 },
        );
        return { inspection, logo: { ...logo, display: association.display! } };
      } catch (error) {
        // Authorization, recovery and stale-state failures remain refusals. The caller renders the built-in mark.
        return failure(error);
      }
    },
  };
}
