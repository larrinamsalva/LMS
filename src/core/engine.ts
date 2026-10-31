import { z } from "zod";
import { TimeError } from "./time";
import {
  activeEntities,
  getEntity,
  validateConfig,
  validateRecord,
  type BusinessConfig,
  type RecordData,
} from "./config";
/** Only trusted host code constructs principals, after authenticating a user. */
export interface Principal {
  userId: string;
}
export interface SqlConnection {
  query<T>(sql: string, parameters?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}
export interface SqlDatabase extends SqlConnection {
  transaction<T>(fn: (tx: SqlConnection) => Promise<T>): Promise<T>;
}
export interface WorkspaceRecord {
  id: string;
  organization_id: string;
  entity: string;
  data: RecordData;
  revision: number;
  config_revision: number;
  archived: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}
export interface ConfigRevision {
  revision: number;
  document: BusinessConfig;
  restored_from: number | null;
}
export interface AuditEvent {
  id: string;
  entity: string;
  record_id: string | null;
  action: string;
  occurred_at: Date | string;
  before_data: unknown;
  after_data: unknown;
}
export class EngineError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}
function recordFailure(error: unknown): never {
  if (error instanceof TimeError) throw new EngineError(error.message, 400);
  const e = error as { code?: string; message?: string };
  if (e.code === "23P01")
    throw new EngineError(
      "This resource already has an appointment during that time. Choose another time or resource.",
      409,
    );
  if (["40001", "40P01", "55P03"].includes(e.code ?? ""))
    throw new EngineError(
      "Concurrent work changed this workspace. Reload and review before retrying.",
      409,
    );
  if (e.code === "23514")
    throw new EngineError(
      e.message ?? "Check the related records and appointment range.",
      409,
    );
  if (["23503", "23505"].includes(e.code ?? ""))
    throw new EngineError(
      "The related record or operation changed. Reload before continuing.",
      409,
    );
  throw error;
}
const id = z.uuid();
const revision = z.number().int().min(1);
const allRoles = ["owner", "admin", "staff", "viewer"];
export class Engine {
  constructor(private readonly db: SqlDatabase) {}
  /** Identity is transaction-local: pooled connections must not retain a previous caller. */
  async asUser<T>(
    principal: Principal,
    fn: (tx: SqlConnection) => Promise<T>,
  ): Promise<T> {
    id.parse(principal.userId);
    return this.db.transaction(async (tx) => {
      await tx.exec("set local role lms_app");
      await tx.query("select set_config('lms.user_id',$1,true)", [
        principal.userId,
      ]);
      await tx.query("select set_config('lms.record_command','',true)");
      return fn(tx);
    });
  }
  private async requireRole(
    tx: SqlConnection,
    organizationId: string,
    roles = allRoles,
  ) {
    id.parse(organizationId);
    const result = await tx.query<{ allowed: boolean }>(
      "select lms.has_role($1,$2) as allowed",
      [organizationId, roles],
    );
    if (!result.rows[0]?.allowed)
      throw new EngineError(
        "This workspace is unavailable for your role.",
        403,
      );
  }
  private async current(
    tx: SqlConnection,
    organizationId: string,
  ): Promise<ConfigRevision> {
    const row = (
      await tx.query<ConfigRevision>(
        "select revision,document,restored_from from lms.config_revisions where organization_id=$1 order by revision desc limit 1",
        [organizationId],
      )
    ).rows[0];
    if (!row)
      throw new EngineError("Workspace configuration is unavailable.", 404);
    return { ...row, document: validateConfig(row.document) };
  }
  private async command(
    tx: SqlConnection,
    organizationId: string,
    operationId: string | undefined,
    request: unknown,
  ) {
    if (!operationId) return null;
    id.parse(operationId);
    const previous = (
      await tx.query<{ result: WorkspaceRecord; matches: boolean }>(
        "select result,request=$3::jsonb as matches from lms.record_operations where organization_id=$1 and operation_id=$2",
        [organizationId, operationId, request],
      )
    ).rows[0];
    if (previous) {
      if (!previous.matches)
        throw new EngineError(
          "This operation identifier already belongs to a different request.",
          409,
        );
      return previous.result;
    }
    await tx.query("select set_config('lms.record_command',$1,true)", [
      JSON.stringify({ operationId, request }),
    ]);
    return null;
  }
  async snapshot(principal: Principal, organizationId: string) {
    return this.asUser(principal, async (tx) => {
      await this.requireRole(tx, organizationId);
      const config = await this.current(tx, organizationId);
      const role = (
        await tx.query<{ role: string }>(
          "select role from lms.memberships where organization_id=$1",
          [organizationId],
        )
      ).rows[0].role;
      const entities = activeEntities(config.document).map((e) => e.id);
      const records = (
        await tx.query<WorkspaceRecord>(
          "select * from lms.records where organization_id=$1 and entity=any($2) order by created_at,id limit 251",
          [organizationId, entities],
        )
      ).rows;
      if (records.length > 250)
        throw new EngineError(
          "Demo record limit exceeded. Export and start a fresh session.",
          409,
        );
      const history = (
        await tx.query<ConfigRevision>(
          "select revision,document,restored_from from lms.config_revisions where organization_id=$1 order by revision desc",
          [organizationId],
        )
      ).rows;
      const audit = (
        await tx.query<AuditEvent>(
          "select id,entity,record_id,action,occurred_at,before_data,after_data from lms.audit_events where organization_id=$1 order by occurred_at desc,id limit 100",
          [organizationId],
        )
      ).rows;
      return { organizationId, config, role, records, history, audit };
    });
  }
  async saveRecord(
    principal: Principal,
    organizationId: string,
    entityId: string,
    data: unknown,
    existing?: { id: string; revision: number },
    operationId?: string,
  ) {
    return this.asUser(principal, async (tx) => {
      await this.requireRole(tx, organizationId, ["owner", "admin", "staff"]);
      // Serialize config publication and data validation in the same organization.
      await tx.query(
        "select id from lms.organizations where id=$1 for update",
        [organizationId],
      );
      const config = await this.current(tx, organizationId);
      const clean = validateRecord(getEntity(config.document, entityId), data);
      const replay = await this.command(tx, organizationId, operationId, {
        kind: "save",
        entity: entityId,
        data: clean,
        existing: existing ?? null,
      });
      if (replay) return replay;
      if (existing) {
        id.parse(existing.id);
        revision.parse(existing.revision);
        const row = (
          await tx.query<WorkspaceRecord>(
            "update lms.records set data=$1,config_revision=$2 where organization_id=$3 and entity=$4 and id=$5 and revision=$6 and not archived returning *",
            [
              clean,
              config.revision,
              organizationId,
              entityId,
              existing.id,
              existing.revision,
            ],
          )
        ).rows[0];
        if (!row)
          throw new EngineError(
            "Record changed or is archived. Reload before editing.",
            409,
          );
        return row;
      }
      const count = (
        await tx.query<{ count: number }>(
          "select count(*)::int as count from lms.records where organization_id=$1",
          [organizationId],
        )
      ).rows[0].count;
      if (count >= 250)
        throw new EngineError(
          "This demo is limited to 250 records per workspace.",
          409,
        );
      return (
        await tx.query<WorkspaceRecord>(
          "insert into lms.records(organization_id,entity,data,config_revision,created_by,updated_by) values($1,$2,$3,$4,$5,$5) returning *",
          [organizationId, entityId, clean, config.revision, principal.userId],
        )
      ).rows[0];
    }).catch(recordFailure);
  }
  async archiveRecord(
    principal: Principal,
    organizationId: string,
    recordId: string,
    expectedRevision: number,
    archived: boolean,
    operationId?: string,
  ) {
    id.parse(recordId);
    revision.parse(expectedRevision);
    z.boolean().parse(archived);
    return this.asUser(principal, async (tx) => {
      await this.requireRole(tx, organizationId, ["owner", "admin", "staff"]);
      await tx.query(
        "select id from lms.organizations where id=$1 for update",
        [organizationId],
      );
      const config = await this.current(tx, organizationId);
      const record = (
        await tx.query<WorkspaceRecord>(
          "select * from lms.records where organization_id=$1 and id=$2",
          [organizationId, recordId],
        )
      ).rows[0];
      if (!record) throw new EngineError("Record unavailable.", 404);
      getEntity(config.document, record.entity);
      const replay = await this.command(tx, organizationId, operationId, {
        kind: "archive",
        recordId,
        revision: expectedRevision,
        archived,
      });
      if (replay) return replay;
      const row = (
        await tx.query<WorkspaceRecord>(
          "update lms.records set archived=$1,config_revision=$2 where organization_id=$3 and id=$4 and revision=$5 returning *",
          [
            archived,
            config.revision,
            organizationId,
            recordId,
            expectedRevision,
          ],
        )
      ).rows[0];
      if (!row)
        throw new EngineError("Record changed. Reload before continuing.", 409);
      return row;
    }).catch(recordFailure);
  }
  async publishConfig(
    principal: Principal,
    organizationId: string,
    document: unknown,
    expectedRevision: number,
    restoredFrom?: number,
  ) {
    const config = validateConfig(document);
    revision.parse(expectedRevision);
    return this.asUser(principal, async (tx) => {
      await this.requireRole(tx, organizationId, ["owner", "admin"]);
      await tx.query(
        "select id from lms.organizations where id=$1 for update",
        [organizationId],
      );
      const current = await this.current(tx, organizationId);
      if (current.revision !== expectedRevision)
        throw new EngineError(
          "Configuration changed. Reload before publishing.",
          409,
        );
      if (current.revision >= 40)
        throw new EngineError("Demo configuration history limit reached.", 409);
      if (
        config.id !== current.document.id ||
        config.industry !== current.document.industry
      )
        throw new EngineError("Project identity is immutable.");
      for (const old of current.document.entities) {
        const next = config.entities.find((e) => e.id === old.id);
        const populated =
          (
            await tx.query<{ count: number }>(
              "select count(*)::int as count from lms.records where organization_id=$1 and entity=$2",
              [organizationId, old.id],
            )
          ).rows[0].count > 0;
        if (
          populated &&
          (!next ||
            next.module !== old.module ||
            JSON.stringify(next.fields) !== JSON.stringify(old.fields) ||
            next.titleField !== old.titleField)
        )
          throw new EngineError(
            "Populated entity fields require a reviewed schema migration. Disable the module to retain its records.",
          );
      }
      if (restoredFrom !== undefined) {
        revision.parse(restoredFrom);
        const target = (
          await tx.query<ConfigRevision>(
            "select revision,document,restored_from from lms.config_revisions where organization_id=$1 and revision=$2",
            [organizationId, restoredFrom],
          )
        ).rows[0];
        if (
          !target ||
          JSON.stringify(validateConfig(target.document)) !==
            JSON.stringify(config)
        )
          throw new EngineError(
            "Rollback must match a retained configuration.",
          );
      }
      await tx.query(
        "insert into lms.config_revisions(organization_id,revision,document,restored_from,created_by) values($1,$2,$3,$4,$5)",
        [
          organizationId,
          current.revision + 1,
          config,
          restoredFrom ?? null,
          principal.userId,
        ],
      );
      return current.revision + 1;
    });
  }
  async exportWorkspace(principal: Principal, organizationId: string) {
    return this.asUser(principal, async (tx) => {
      await this.requireRole(tx, organizationId, ["owner", "admin"]);
      // Include retained data from disabled modules. One transaction, no UI filtering.
      const config = await this.current(tx, organizationId);
      const records = (
        await tx.query<WorkspaceRecord>(
          "select * from lms.records where organization_id=$1 order by entity,id",
          [organizationId],
        )
      ).rows;
      const history = (
        await tx.query<ConfigRevision>(
          "select revision,document,restored_from from lms.config_revisions where organization_id=$1 order by revision",
          [organizationId],
        )
      ).rows;
      return {
        format: "lms-workspace-export",
        version: 1,
        exportedAt: new Date().toISOString(),
        organizationId,
        config,
        history,
        records,
      };
    });
  }
}
export type WorkspaceSnapshot = Awaited<ReturnType<Engine["snapshot"]>>;
