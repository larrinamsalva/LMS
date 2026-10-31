import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { z } from "zod";
import { EngineError } from "../../core/engine";
import { validateConfig } from "../../core/config";
import { presets } from "../../presets";

export const bootstrapSchema = z
  .object({
    operationId: z.uuid(),
    ownerId: z.uuid(),
    name: z.string().trim().min(3).max(80),
    preset: z.enum(["property", "cleaning"]),
    confirmation: z.literal("CREATE FICTIONAL WORKSPACE"),
  })
  .strict();

/** Trusted local maintenance only. Never call with browser input or runtime credentials. */
export async function bootstrapFictionalWorkspace(
  client: Client,
  value: unknown,
) {
  const input = bootstrapSchema.parse(value);
  const configuration = validateConfig({
    ...presets[input.preset],
    name: input.name,
  });
  if (
    !(
      await client.query(
        "select rolsuper from pg_roles where rolname=current_user",
      )
    ).rows[0]?.rolsuper
  )
    throw new EngineError("Use the separate local administrator.", 403);
  await client.query("BEGIN");
  try {
    await client.query("select pg_advisory_xact_lock(74021904)");
    const previous = (
      await client.query<{ organization_id: string; matches: boolean }>(
        "select organization_id,(owner_id=$2 and configuration=$3::jsonb) as matches from lms_private.workspace_bootstraps where operation_id=$1",
        [input.operationId, input.ownerId, JSON.stringify(configuration)],
      )
    ).rows[0];
    if (previous) {
      if (!previous.matches)
        throw new EngineError(
          "Bootstrap operation already used with different input.",
          409,
        );
      // A retry must never reset a membership or reverse a later ownership handover.
      await client.query("COMMIT");
      return { organizationId: previous.organization_id, replayed: true };
    }
    const identity = (
      await client.query<{ name: string }>(
        `select u.name from lms_identity."user" u where u.id=$1 and u.email like '%@example.test'
       and exists(select 1 from lms_identity.account a where a."userId"=u.id and a."providerId"='credential') for share`,
        [input.ownerId],
      )
    ).rows[0];
    if (!identity)
      throw new EngineError(
        "Provision a fictional local owner identity first.",
      );
    const organizationId = randomUUID();
    await client.query("select set_config('lms.user_id',$1,true)", [
      input.ownerId,
    ]);
    await client.query(
      "insert into lms.users(id,display_name) values($1,$2) on conflict do nothing",
      [input.ownerId, identity.name],
    );
    await client.query("insert into lms.organizations(id,name) values($1,$2)", [
      organizationId,
      input.name,
    ]);
    await client.query("insert into lms.memberships values($1,$2,'owner')", [
      organizationId,
      input.ownerId,
    ]);
    await client.query(
      "insert into lms.config_revisions(organization_id,revision,document,created_by) values($1,1,$2,$3)",
      [organizationId, configuration, input.ownerId],
    );
    await client.query(
      "insert into lms.access_versions(organization_id) values($1)",
      [organizationId],
    );
    await client.query(
      `insert into lms.audit_events(organization_id,actor_id,entity,record_id,action,after_data)
       values($1,$2,'membership',$2,'bootstrap',$3)`,
      [
        organizationId,
        input.ownerId,
        {
          role: "owner",
          operationId: input.operationId,
          reason: "Explicit fictional workspace bootstrap",
        },
      ],
    );
    await client.query(
      "insert into lms_private.workspace_bootstraps(operation_id,owner_id,organization_id,configuration) values($1,$2,$3,$4)",
      [input.operationId, input.ownerId, organizationId, configuration],
    );
    await client.query("COMMIT");
    return { organizationId, replayed: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
