import { z } from "zod";
import { blueprintJson, sha256 } from "./blueprint";
import {
  explainMigrationImpact,
  impactReviewInput,
  type MigrationReview,
} from "./migration-review";
import {
  validateBuildPlan,
  publishPlanConfirmation,
  type BuildPlanRevision,
} from "./buildplan";
import { TimeError } from "./time";
import { workforceEntities, type StaffAssignment } from "./workforce";
import {
  InventoryError,
  type StockBalance,
  type StockMovement,
} from "./inventory";
import { recordWriteRoles, movementWriteRoles } from "./permissions";
import { PricingError, pricingEntities, type EstimateVersion } from "./pricing";
import {
  activeEntities,
  configurationImpact,
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
  if (
    error instanceof TimeError ||
    error instanceof PricingError ||
    error instanceof InventoryError
  )
    throw new EngineError(error.message, 400);
  const e = error as { code?: string; message?: string; constraint?: string };
  if (e.code === "42501")
    throw new EngineError("This operation is unavailable for your role.", 403);
  if (e.code === "23P01" && e.constraint === "exclusive_service_rate")
    throw new EngineError(
      "An active rate already covers this service, area and date range. Adjust its effective dates or archive it first.",
      409,
    );
  if (e.code === "23P01" && e.constraint === "one_worker_identity")
    throw new EngineError(
      "This Worker resource already has an effective employee during that period.",
      409,
    );
  if (e.code === "23P01" && e.constraint === "unique_crew_membership")
    throw new EngineError(
      "This employee already has an overlapping membership in this resource.",
      409,
    );
  if (e.code === "23P01" && e.constraint === "exclusive_employee_time")
    throw new EngineError(
      "An employee is already assigned during that time, including through another crew or worker resource.",
      409,
    );
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
  private async hasWorkforce(tx: SqlConnection) {
    return (
      await tx.query<{ present: boolean }>(
        "select to_regclass('lms.appointment_staff') is not null as present",
      )
    ).rows[0].present;
  }
  private async requireWorkforce(tx: SqlConnection) {
    if (!(await this.hasWorkforce(tx)))
      throw new EngineError(
        "Stop hosts and apply migration 8 before enabling or writing workforce records.",
        409,
      );
  }
  private async staffHistory(tx: SqlConnection, organizationId: string) {
    // Older, deliberately partial migration rehearsals remain readable; new workforce writes refuse.
    return (await this.hasWorkforce(tx))
      ? (
          await tx.query<StaffAssignment>(
            "select * from lms.appointment_staff where organization_id=$1 order by appointment_id,appointment_revision,employee_id",
            [organizationId],
          )
        ).rows
      : [];
  }
  private async requirePricing(tx: SqlConnection) {
    if (
      !(
        await tx.query<{ present: boolean }>(
          "select to_regclass('lms.service_rates') is not null as present",
        )
      ).rows[0].present
    )
      throw new EngineError(
        "Stop hosts and apply migration 9 before enabling or writing service pricing and estimates.",
        409,
      );
  }
  private async estimateHistory(tx: SqlConnection, organizationId: string) {
    const exists = (
      await tx.query<{ present: boolean }>(
        "select to_regclass('lms.estimate_versions') is not null as present",
      )
    ).rows[0].present;
    return exists
      ? (
          await tx.query<EstimateVersion>(
            "select * from lms.estimate_versions where organization_id=$1 order by record_id,revision",
            [organizationId],
          )
        ).rows
      : [];
  }
  private async hasInventory(tx: SqlConnection) {
    return (
      await tx.query<{ present: boolean }>(
        "select to_regclass('lms.stock_movements') is not null as present",
      )
    ).rows[0].present;
  }
  private async requireInventory(tx: SqlConnection) {
    if (!(await this.hasInventory(tx)))
      throw new EngineError(
        "Stop hosts and apply migration 10 before enabling or writing the stock ledger.",
        409,
      );
  }
  private async inventoryHistory(tx: SqlConnection, organizationId: string) {
    if (!(await this.hasInventory(tx)))
      return {
        stockBalances: [] as StockBalance[],
        stockMovements: [] as StockMovement[],
      };
    return {
      stockBalances: (
        await tx.query<StockBalance>(
          "select organization_id,product_id,location_id,units::text from lms.stock_balances where organization_id=$1 order by product_id,location_id",
          [organizationId],
        )
      ).rows,
      stockMovements: (
        await tx.query<StockMovement>(
          "select *,quantity::text as quantity,case_size::text as case_size,units::text as units,to_char(occurred_on,'YYYY-MM-DD') as occurred_on from lms.stock_movements where organization_id=$1 order by recorded_at desc,record_id desc",
          [organizationId],
        )
      ).rows,
    };
  }
  private async hasBuildPlans(tx: SqlConnection) {
    return (
      await tx.query<{ present: boolean }>(
        "select to_regclass('lms.build_plan_revisions') is not null as present",
      )
    ).rows[0].present;
  }
  private async requireBuildPlans(tx: SqlConnection) {
    if (!(await this.hasBuildPlans(tx)))
      throw new EngineError(
        "Stop hosts and apply migration 11 before saving BuildPlans.",
        409,
      );
  }
  private async requireBranding(tx: SqlConnection) {
    const result = await tx.query<{ present: boolean }>(
      "select exists(select 1 from pg_catalog.pg_trigger where tgrelid='lms.config_revisions'::regclass and tgname='configuration_branding_guard' and tgenabled='O') as present",
    );
    if (!result.rows[0].present)
      throw new EngineError(
        "Stop hosts and apply migration 12 before using branded configurations.",
        409,
      );
  }
  private async buildPlanHistory(tx: SqlConnection, organizationId: string) {
    return (await this.hasBuildPlans(tx))
      ? (
          await tx.query<BuildPlanRevision>(
            "select id,revision,base_revision,document,created_by,created_at from lms.build_plan_revisions where organization_id=$1 order by created_at desc,id,revision desc",
            [organizationId],
          )
        ).rows
      : [];
  }
  /** Metadata-only, single-statement MVCC observation. No approval, lock or mutation is created. */
  async reviewBuildPlanImpact(
    principal: Principal,
    organizationId: string,
    input: unknown,
  ): Promise<MigrationReview> {
    return this.asUser(principal, async (tx) => {
      await this.requireRole(tx, organizationId, ["owner", "admin"]);
      const request = impactReviewInput.parse(input),
        plan = validateBuildPlan(request.document);
      await this.requireBuildPlans(tx);
      await this.requireConfigurationStorage(tx, plan.configuration);
      const observation = (
        await tx.query<{
          config: ConfigRevision;
          role: string;
          isolation: string;
          records: [string, string, number, boolean][];
          drafts: [string, number, number][];
        }>(
          `select
        current_setting('transaction_isolation') as isolation,
        (select jsonb_build_object('revision',revision,'document',document,'restored_from',restored_from) from lms.config_revisions where organization_id=$1 order by revision desc limit 1) as config,
        (select role from lms.memberships where organization_id=$1) as role,
        (select coalesce(jsonb_agg(jsonb_build_array(entity,id,revision,archived) order by entity,id),'[]'::jsonb) from lms.records where organization_id=$1) as records,
        (select coalesce(jsonb_agg(jsonb_build_array(id,revision,base_revision) order by id,revision),'[]'::jsonb) from lms.build_plan_revisions where organization_id=$1) as drafts
        where lms.has_role($1,array['owner','admin'])`,
          [organizationId],
        )
      ).rows[0];
      if (!observation?.config)
        throw new EngineError(
          "This workspace is unavailable for your role.",
          403,
        );
      if (observation.isolation !== "read committed")
        throw new EngineError(
          "Data-impact planning requires fresh READ COMMITTED observations. No review was accepted.",
          409,
        );
      if (request.draft) {
        const latest = Math.max(
          0,
          ...observation.drafts
            .filter((d) => d[0] === request.draft!.id)
            .map((d) => d[1]),
        );
        if (latest !== request.draft.revision)
          throw new EngineError(
            "The saved BuildPlan changed or is unavailable. Reopen its latest revision before reviewing.",
            409,
          );
      }
      const digest = (value: unknown) =>
        sha256(new TextEncoder().encode(blueprintJson(value)));
      const state = {
        stateDigest: await digest({
          organizationId,
          actor: principal.userId,
          ...observation,
        }),
        proposalDigest: await digest(plan),
      };
      if (
        request.expected &&
        (request.expected.stateDigest !== state.stateDigest ||
          request.expected.proposalDigest !== state.proposalDigest)
      )
        throw new EngineError(
          "This data-impact review is stale. Configuration, drafts, records or access changed. Refresh the review before previewing or exporting.",
          409,
        );
      const populations = new Map<
        string,
        { entity: string; active: number; archived: number }
      >();
      for (const [entity, , , archived] of observation.records) {
        const count = populations.get(entity) ?? {
          entity,
          active: 0,
          archived: 0,
        };
        if (archived) count.archived++;
        else count.active++;
        populations.set(entity, count);
      }
      return {
        format: "lms-migration-review" as const,
        version: 1 as const,
        configurationRevision: observation.config.revision,
        ...explainMigrationImpact(observation.config.document, plan, [
          ...populations.values(),
        ]),
        state,
        ...(request.draft ? { draft: request.draft } : {}),
      };
    }).catch(recordFailure);
  }
  async saveBuildPlan(
    principal: Principal,
    organizationId: string,
    document: unknown,
    draftId: string,
    expectedRevision: number,
    baseRevision: number,
  ) {
    const clean = validateBuildPlan(document);
    id.parse(draftId);
    z.number().int().min(0).max(19).parse(expectedRevision);
    revision.parse(baseRevision);
    return this.asUser(principal, async (tx) => {
      await this.requireRole(tx, organizationId, ["owner", "admin"]);
      await this.requireBuildPlans(tx);
      if (clean.version === 2) await this.requireBranding(tx);
      await tx.query(
        "select id from lms.organizations where id=$1 for update",
        [organizationId],
      );
      const replay = (
        await tx.query<BuildPlanRevision & { matches: boolean }>(
          "select *,document=$4::jsonb and base_revision=$5 and created_by=lms.current_user_id() as matches from lms.build_plan_revisions where organization_id=$1 and id=$2 and revision=$3",
          [organizationId, draftId, expectedRevision + 1, clean, baseRevision],
        )
      ).rows[0];
      if (replay) {
        if (!replay.matches)
          throw new EngineError(
            "BuildPlan changed or this revision belongs to another request.",
            409,
          );
        return replay;
      }
      const latest = (
        await tx.query<{ revision: number }>(
          "select coalesce(max(revision),0)::int as revision from lms.build_plan_revisions where organization_id=$1 and id=$2",
          [organizationId, draftId],
        )
      ).rows[0].revision;
      if (latest !== expectedRevision)
        throw new EngineError(
          "BuildPlan changed; reopen the latest revision before saving.",
          409,
        );
      return (
        await tx.query<BuildPlanRevision>(
          "insert into lms.build_plan_revisions(organization_id,id,revision,base_revision,document,created_by)values($1,$2,$3,$4,$5,$6)returning *",
          [
            organizationId,
            draftId,
            expectedRevision + 1,
            baseRevision,
            clean,
            principal.userId,
          ],
        )
      ).rows[0];
    }).catch(recordFailure);
  }
  async publishBuildPlan(
    principal: Principal,
    organizationId: string,
    input: unknown,
  ) {
    const selected = z
      .object({
        id: z.uuid(),
        revision: z.number().int().min(1).max(20),
        configRevision: revision,
        confirmation: z.literal(publishPlanConfirmation),
      })
      .strict()
      .parse(input);
    return this.asUser(principal, async (tx) => {
      await this.requireRole(tx, organizationId, ["owner", "admin"]);
      await this.requireBuildPlans(tx);
      await tx.query(
        "select id from lms.organizations where id=$1 for update",
        [organizationId],
      );
      const latest = (
        await tx.query<BuildPlanRevision>(
          "select * from lms.build_plan_revisions where organization_id=$1 and id=$2 order by revision desc limit 1",
          [organizationId, selected.id],
        )
      ).rows[0];
      if (
        !latest ||
        latest.revision !== selected.revision ||
        latest.base_revision !== selected.configRevision
      )
        throw new EngineError(
          "Review and save the latest BuildPlan against the current configuration before publishing.",
          409,
        );
      const plan = validateBuildPlan(latest.document);
      return this.publishInTransaction(
        tx,
        principal,
        organizationId,
        plan.configuration,
        selected.configRevision,
      );
    }).catch(recordFailure);
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
      return {
        organizationId,
        config,
        role,
        records,
        history,
        audit,
        populatedEntities: (
          await tx.query<{ entity: string }>(
            "select distinct entity from lms.records where organization_id=$1 order by entity",
            [organizationId],
          )
        ).rows.map((r) => r.entity),
        buildPlans: await this.buildPlanHistory(tx, organizationId),
        staffAssignments: await this.staffHistory(tx, organizationId),
        estimateVersions: await this.estimateHistory(tx, organizationId),
        ...(await this.inventoryHistory(tx, organizationId)),
      };
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
      await this.requireRole(tx, organizationId, recordWriteRoles(entityId));
      // Serialize config publication and data validation in the same organization.
      await tx.query(
        "select id from lms.organizations where id=$1 for update",
        [organizationId],
      );
      const config = await this.current(tx, organizationId);
      if (
        workforceEntities.includes(entityId) ||
        (entityId === "appointments" &&
          config.document.modules.some((m) => m.id === "workforce"))
      )
        await this.requireWorkforce(tx);
      if (pricingEntities.includes(entityId)) await this.requirePricing(tx);
      if (entityId === "stock-locations" || entityId === "stock-movements")
        await this.requireInventory(tx);
      const clean = validateRecord(getEntity(config.document, entityId), data);
      if (entityId === "stock-movements") {
        await this.requireRole(tx, organizationId, movementWriteRoles(clean));
        if (!operationId)
          throw new EngineError(
            "Stock movements require an operation identifier.",
          );
      }
      const replay = await this.command(tx, organizationId, operationId, {
        kind: "save",
        entity: entityId,
        data: clean,
        existing: existing ?? null,
      });
      if (replay) return replay;
      if (entityId === "stock-movements" && existing)
        throw new EngineError(
          "Stock movements are immutable. Post a compensating movement.",
          409,
        );
      if (existing) {
        id.parse(existing.id);
        revision.parse(existing.revision);
      }
      const stored =
        entityId === "estimates"
          ? (
              await tx.query<{ data: RecordData }>(
                "select lms.prepare_estimate($1,$2::jsonb,$3::uuid,$4::integer) as data",
                [
                  organizationId,
                  clean,
                  existing?.id ?? null,
                  existing?.revision ?? null,
                ],
              )
            ).rows[0].data
          : clean;
      if (existing) {
        const row = (
          await tx.query<WorkspaceRecord>(
            "update lms.records set data=$1,config_revision=$2 where organization_id=$3 and entity=$4 and id=$5 and revision=$6 and not archived returning *",
            [
              stored,
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
          [organizationId, entityId, stored, config.revision, principal.userId],
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
      await this.requireRole(
        tx,
        organizationId,
        recordWriteRoles(record.entity),
      );
      if (
        workforceEntities.includes(record.entity) ||
        (record.entity === "appointments" &&
          config.document.modules.some((m) => m.id === "workforce"))
      )
        await this.requireWorkforce(tx);
      if (pricingEntities.includes(record.entity))
        await this.requirePricing(tx);
      if (record.entity === "stock-movements")
        throw new EngineError(
          "Stock movements cannot be archived or restored.",
          409,
        );
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
    return this.asUser(principal, (tx) =>
      this.publishInTransaction(
        tx,
        principal,
        organizationId,
        config,
        expectedRevision,
        restoredFrom,
      ),
    );
  }
  private async publishInTransaction(
    tx: SqlConnection,
    principal: Principal,
    organizationId: string,
    config: BusinessConfig,
    expectedRevision: number,
    restoredFrom?: number,
  ) {
    await this.requireRole(tx, organizationId, ["owner", "admin"]);
    await tx.query("select id from lms.organizations where id=$1 for update", [
      organizationId,
    ]);
    const current = await this.current(tx, organizationId);
    await this.requireConfigurationStorage(tx, config);
    if (current.revision !== expectedRevision)
      throw new EngineError(
        "Configuration changed. Reload before publishing.",
        409,
      );
    if (current.revision >= 40)
      throw new EngineError("Demo configuration history limit reached.", 409);
    const populated = (
      await tx.query<{ entity: string }>(
        "select distinct entity from lms.records where organization_id=$1",
        [organizationId],
      )
    ).rows.map((r) => r.entity);
    const impact = configurationImpact(current.document, config, populated);
    if (impact.identityChanged)
      throw new EngineError("Project identity is immutable.");
    if (impact.migrationEntities.length)
      throw new EngineError(
        "Populated entity fields require a reviewed schema migration. Disable the module to retain its records.",
      );
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
        throw new EngineError("Rollback must match a retained configuration.");
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
  }
  private async requireConfigurationStorage(
    tx: SqlConnection,
    config: BusinessConfig,
  ) {
    if (config.schemaVersion === 2) await this.requireBranding(tx);
    if (config.modules.some((m) => m.id === "workforce"))
      await this.requireWorkforce(tx);
    if (config.modules.some((m) => m.id === "estimates"))
      await this.requirePricing(tx);
    if (
      config.entities.some((e) =>
        ["stock-locations", "stock-movements"].includes(e.id),
      ) &&
      config.modules.some((m) => m.id === "inventory")
    )
      await this.requireInventory(tx);
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
        staffAssignments: await this.staffHistory(tx, organizationId),
        estimateVersions: await this.estimateHistory(tx, organizationId),
        buildPlans: await this.buildPlanHistory(tx, organizationId),
        ...(await this.inventoryHistory(tx, organizationId)),
      };
    });
  }
}
export type WorkspaceSnapshot = Awaited<ReturnType<Engine["snapshot"]>>;
