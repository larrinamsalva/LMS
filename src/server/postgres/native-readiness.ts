import { randomBytes } from "node:crypto";
import { lstat, mkdtemp, unlink, rmdir } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { z } from "zod";
import { readPrivateText } from "../recovery/private-file";
import { backupDatabase, backupToolVersions, restoreDatabase } from "./backup";
import { localTarget } from "./targets";
import { runtimeLease } from "./runtime-lease";
import {
  inspectIsolation,
  inspectSchema,
  observeNative,
  quotedTable,
  readinessTables,
  sameNative,
  type NativeObservation,
} from "./readiness-inspection";

export const nativeRehearsalConfirmation = "REHEARSE FICTIONAL NATIVE BACKUP";
export const nativeTrustSchema = z
  .object({
    format: z.literal("lms-native-readiness-trust"),
    version: z.literal(1),
    environment: z.string().regex(/^[a-z0-9-]{1,48}$/),
    fictionalOnly: z.literal(true),
    maintenanceRole: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
    source: z
      .object({
        database: z.string().regex(/^lms_test_[a-z0-9_]{1,48}$/),
        instanceId: z.uuid(),
        organizations: z
          .array(z.uuid())
          .min(1)
          .max(10)
          .refine((a) => new Set(a).size === a.length),
      })
      .strict(),
    target: z
      .object({ database: z.string().regex(/^lms_restore_[a-z0-9_]{1,45}$/) })
      .strict(),
  })
  .strict();
type Trust = z.infer<typeof nativeTrustSchema>;
export type NativePin = { oid: string; cluster: string; locale: string };
export interface NativeSourceEvidence {
  source: Client;
  observation: NativeObservation;
  sourcePin: NativePin;
  targetPin: NativePin;
  trust: Trust;
}
export function nativeTargets(
  input: unknown,
  sourceUrl: string,
  targetUrl: string,
) {
  const trust = nativeTrustSchema.parse(input),
    source = localTarget(sourceUrl, trust.source.database),
    target = localTarget(targetUrl, trust.target.database);
  if (
    [source, target].some(
      (u) =>
        u.hostname === "localhost" ||
        u.hash ||
        !u.password ||
        decodeURIComponent(u.username) !== trust.maintenanceRole,
    ) ||
    source.hostname !== target.hostname ||
    (source.port || "5432") !== (target.port || "5432")
  )
    throw new Error(
      "Use approved maintenance credentials on one exact literal loopback endpoint.",
    );
  return { trust, source, target };
}
const steps = {
  authorization:
    "Private fictional allowlist and separate maintenance authority",
  offline: "Required hosts stopped and exclusive maintenance lease acquired",
  schema: "Current immutable migration checksums and reviewed table inventory",
  configuration: "Supported v1/v2 configurations and saved BuildPlans",
  isolation: "Forced RLS, scoped records and unavailable-identity refusal",
  target: "Separate empty restore database with no other connections",
  tooling: "PostgreSQL 16 native dump and restore tools",
  archive: "New private native archive completed",
  restore: "Native restore and transient-state purge completed",
  integrity:
    "Scoped records, projections, revisions, receipts and audit history retained",
  quarantine: "Both runtime lease paths still refuse restored activation",
  source: "Source data, credentials, configuration and history unchanged",
  cleanup: "Temporary private archive removed",
} as const;
export const nativeReadinessChecks = Object.keys(steps);
type Step = keyof typeof steps;
interface NativeVersions {
  postgresMajor: number | null;
  migration: number | null;
  configurationSchemas: number[];
  buildPlanVersions: number[];
}
export interface NativeReadinessReport {
  format: "lms-native-readiness-report";
  version: 1;
  environment: string;
  mode: "preflight" | "rehearse";
  result: "blocked" | "preflight-complete" | "rehearsal-complete";
  backupReadiness: "not-verified" | "verified-fictional-round-trip";
  versions: {
    source: NativeVersions;
    target: NativeVersions;
    destination: "same-schema-copy-only";
  };
  checks: {
    id: Step;
    label: string;
    status: "passed" | "blocked" | "not-run";
  }[];
  remainingBlockers: string[];
  notice: string;
}
export interface NativeReadinessOptions {
  mode: "preflight" | "rehearse";
  trustFile: string;
  sourceUrl: string;
  targetUrl: string;
  workDirectory: string;
  confirmation?: string;
  binDirectory?: string;
  signal?: AbortSignal;
  /** Internal host integration only; never read from JSON, CLI flags or HTTP. */
  observationKey?: Buffer;
  onSource?: (evidence: NativeSourceEvidence) => Promise<void>;
  onCopy?: (observation: NativeObservation) => Promise<void>;
}
function report(mode: NativeReadinessReport["mode"]): NativeReadinessReport {
  return {
    format: "lms-native-readiness-report",
    version: 1,
    environment: "unverified",
    mode,
    result: "blocked",
    backupReadiness: "not-verified",
    versions: {
      source: {
        postgresMajor: null,
        migration: null,
        configurationSchemas: [],
        buildPlanVersions: [],
      },
      target: {
        postgresMajor: null,
        migration: null,
        configurationSchemas: [],
        buildPlanVersions: [],
      },
      destination: "same-schema-copy-only",
    },
    checks: Object.entries(steps).map(([id, label]) => ({
      id: id as Step,
      label,
      status: "not-run",
    })),
    remainingBlockers: [
      "No schema transformation or migration execution is implemented or authorized.",
      "Fictional operator attestation is not proof of real-person identity or production-data classification.",
      "Independent credential lineage, latest checkpoint custody, recovery identity/approval and restored-password acceptance are not verified; activation remains blocked.",
      "Production security acceptance, encryption/off-device retention, crash recovery, cluster/key recovery and actual business migration/rollback remain separate requirements.",
    ],
    notice:
      "Host-only bounded fictional native copy evidence. No operational values, credentials, archive bytes, fingerprints or executable commands. This report is not a backup, signed approval, activation token or public Studio readiness input.",
  };
}
const assert = (truth: unknown) => {
  if (!truth) throw new Error("Native readiness refused.");
};
function client(url: URL) {
  return new Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    lock_timeout: 1000,
    options: "-c timezone=UTC -c datestyle=ISO,MDY",
    application_name: "lms-native-readiness",
  });
}
async function authority(c: Client, trust: Trust, database: string) {
  const row = (
    await c.query(`select current_database() as database,current_user as role,session_user as login,r.rolsuper,
    pg_get_userbyid(d.datdba)=current_user as owned,d.oid::text as oid,current_setting('server_version_num')::int/10000 as major,
    pg_is_in_recovery() as recovering,(select system_identifier::text from pg_control_system()) as cluster,
    jsonb_build_array(d.encoding,d.datlocprovider,d.datcollate,d.datctype,d.daticulocale,d.datcollversion)::text as locale
    from pg_roles r join pg_database d on d.datname=current_database() where r.rolname=current_user`)
  ).rows[0];
  assert(
    row &&
      row.database === database &&
      row.role === trust.maintenanceRole &&
      row.login === trust.maintenanceRole &&
      row.rolsuper &&
      row.owned &&
      !row.recovering &&
      row.major === 16,
  );
  return {
    oid: row.oid as string,
    cluster: row.cluster as string,
    locale: row.locale as string,
  };
}
async function alone(c: Client) {
  assert(
    !(
      await c.query(
        "select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and backend_type='client backend' limit 1",
      )
    ).rows.length,
  );
}
async function maintenance(c: Client) {
  assert(
    (await c.query("select pg_try_advisory_xact_lock(74021906) as held"))
      .rows[0].held,
  );
  // Also fence old/current migration runners which might not take the offline lease.
  assert(
    (await c.query("select pg_try_advisory_xact_lock(74021901) as held"))
      .rows[0].held,
  );
  await alone(c);
}
async function empty(c: Client) {
  assert(
    !(
      await c.query(
        `select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname !~ '^pg_' and n.nspname<>'information_schema' and c.relkind in ('r','p','v','m','f','S') limit 1`,
      )
    ).rows.length,
  );
  assert(
    !(
      await c.query(
        "select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname !~ '^pg_' and n.nspname<>'information_schema' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') limit 1",
      )
    ).rows.length,
  );
  assert(
    !(
      await c.query(
        "select 1 from pg_db_role_setting where setdatabase=(select oid from pg_database where datname=current_database())",
      )
    ).rows.length,
  );
}
async function sourceIdentity(c: Client, trust: Trust) {
  const state = (
    await c.query(
      "select instance_id,blocked from lms_control.state where singleton",
    )
  ).rows[0];
  assert(state?.instance_id === trust.source.instanceId && !state.blocked);
  assert(
    !(await c.query("select lms_control.is_blocked() as blocked")).rows[0]
      .blocked,
  );
  const orgs = (
    await c.query("select id from lms.organizations order by id")
  ).rows.map((r) => r.id);
  assert(
    JSON.stringify(orgs) ===
      JSON.stringify([...trust.source.organizations].sort()),
  );
  // A trusted fictional attestation is still required; domain spelling alone proves no identity.
  assert(
    !(
      await c.query(
        "select 1 from lms_identity.\"user\" where email not like '%@example.test' limit 1",
      )
    ).rows.length,
  );
}
async function privateDirectory(directory: string) {
  const s = await lstat(directory);
  assert(
    !!process.getuid &&
      s.isDirectory() &&
      !s.isSymbolicLink() &&
      s.uid === process.getuid() &&
      (s.mode & 0o077) === 0,
  );
}
async function quarantined(c: Client, sourceInstance: string) {
  assert(
    (
      await c.query(
        "select blocked and reason='restored-archive' and instance_id<>$1::uuid as blocked from lms_control.state where singleton",
        [sourceInstance],
      )
    ).rows[0]?.blocked,
  );
  assert(
    (await c.query("select lms_control.is_blocked() as blocked")).rows[0]
      .blocked,
  );
  assert(
    (
      await c.query(
        "select exists(select 1 from pg_db_role_setting s where s.setdatabase=(select oid from pg_database where datname=current_database()) and s.setrole=0 and 'lms.restore_blocked=on'=any(s.setconfig)) as quarantined",
      )
    ).rows[0].quarantined,
  );
}
async function blockedLeases(url: URL) {
  for (const role of ["lms_app", "lms_auth_service"] as const) {
    let refused = false;
    try {
      const lease = await runtimeLease(
        {
          connectionString: url.toString(),
          connectionTimeoutMillis: 5000,
          options: "",
        },
        role,
      );
      await lease.close();
    } catch (e) {
      refused = e instanceof Error && /activation blocked/i.test(e.message);
    }
    assert(refused);
  }
}
/** Read-only host inspection of an existing quarantined copy; same trust/lease/schema guards as native readiness. */
export async function withNativeCopyInspection<T>(
  options: NativeReadinessOptions,
  key: Buffer,
  fn: (e: NativeSourceEvidence, copy: NativeObservation) => Promise<T>,
  expectedPins?: { source: NativePin; target: NativePin },
): Promise<T> {
  assert(key.length === 32);
  options.signal?.throwIfAborted();
  const {
    trust,
    source: sourceUrl,
    target: targetUrl,
  } = nativeTargets(
    JSON.parse(await readPrivateText(options.trustFile, 8192)),
    options.sourceUrl,
    options.targetUrl,
  );
  await privateDirectory(options.workDirectory);
  const source = client(sourceUrl),
    target = client(targetUrl);
  let value: T,
    sourceConnected = false,
    targetConnected = false;
  try {
    await source.connect();
    sourceConnected = true;
    const sourcePin = await authority(source, trust, trust.source.database);
    if (expectedPins)
      assert(JSON.stringify(sourcePin) === JSON.stringify(expectedPins.source));
    await source.query("begin");
    await maintenance(source);
    await inspectSchema(source, false);
    await source.query(
      "lock table " +
        readinessTables.map(quotedTable).join(",") +
        " in share mode nowait",
    );
    await sourceIdentity(source, trust);
    const observation = await observeNative(source, key);
    await inspectIsolation(source);
    await target.connect();
    targetConnected = true;
    const targetPin = await authority(target, trust, trust.target.database);
    if (expectedPins)
      assert(JSON.stringify(targetPin) === JSON.stringify(expectedPins.target));
    assert(
      targetPin.cluster === sourcePin.cluster &&
        targetPin.locale === sourcePin.locale,
    );
    await target.query("begin read only");
    await maintenance(target);
    await inspectSchema(target, true);
    await quarantined(target, trust.source.instanceId);
    const copy = await observeNative(target, key);
    sameNative(observation, copy, true);
    await inspectIsolation(target);
    value = await fn(
      { source, observation, sourcePin, targetPin, trust },
      copy,
    );
    sameNative(observation, await observeNative(source, key), false);
    sameNative(copy, await observeNative(target, key), false);
    options.signal?.throwIfAborted();
  } finally {
    try {
      if (targetConnected) {
        await target.query("rollback").catch(() => {});
        await target.end();
      }
    } finally {
      if (sourceConnected) {
        await source.query("rollback").catch(() => {});
        await source.end();
      }
    }
  }
  await blockedLeases(targetUrl);
  return value!;
}

/** Trusted local operator only. No HTTP import, arbitrary archive, SQL, target creation/drop or activation. */
export async function nativeReadiness(
  options: NativeReadinessOptions,
): Promise<NativeReadinessReport> {
  const out = report(options.mode),
    key = options.observationKey
      ? Buffer.from(options.observationKey)
      : randomBytes(32);
  let step: Step = "authorization",
    source: Client | undefined,
    directory: string | undefined,
    archive: string | undefined;
  let sourceBefore: NativeObservation | undefined;
  const pass = (id: Step) => {
    out.checks.find((c) => c.id === id)!.status = "passed";
  };
  try {
    assert(["preflight", "rehearse"].includes(options.mode));
    assert(key.length === 32);
    options.signal?.throwIfAborted();
    const {
      trust,
      source: sourceUrl,
      target: targetUrl,
    } = nativeTargets(
      JSON.parse(await readPrivateText(options.trustFile, 8192)),
      options.sourceUrl,
      options.targetUrl,
    );
    out.environment = trust.environment;
    if (options.mode === "rehearse")
      assert(options.confirmation === nativeRehearsalConfirmation);
    await privateDirectory(options.workDirectory);
    source = client(sourceUrl);
    await source.connect();
    const sourceIdentityPin = await authority(
      source,
      trust,
      trust.source.database,
    );
    pass("authorization");
    // No DML/DDL is issued. SHARE locks need a read-write transaction; it always rolls back.
    await source.query(
      options.mode === "preflight" ? "begin read only" : "begin",
    );
    step = "offline";
    await maintenance(source);
    pass(step);
    step = "schema";
    out.versions.source.migration = await inspectSchema(source, false);
    out.versions.source.postgresMajor = 16;
    if (options.mode === "rehearse")
      await source.query(
        "lock table " +
          readinessTables.map(quotedTable).join(",") +
          " in share mode nowait",
      );
    pass(step);
    step = "configuration";
    await sourceIdentity(source, trust);
    sourceBefore = await observeNative(source, key);
    out.versions.source.configurationSchemas =
      sourceBefore.configurationSchemas;
    out.versions.source.buildPlanVersions = sourceBefore.buildPlanVersions;
    pass(step);
    step = "isolation";
    await inspectIsolation(source);
    pass(step);
    step = "target";
    const target = client(targetUrl);
    let targetOid: string;
    let targetPin: NativePin;
    try {
      await target.connect();
      const pin = await authority(target, trust, trust.target.database);
      targetOid = pin.oid;
      targetPin = pin;
      assert(pin.cluster === sourceIdentityPin.cluster);
      assert(pin.locale === sourceIdentityPin.locale);
      out.versions.target.postgresMajor = 16;
      await target.query("begin read only");
      await maintenance(target);
      await empty(target);
      await target.query("rollback");
    } finally {
      await target.end();
    }
    pass(step);
    step = "tooling";
    const tools = await backupToolVersions(
      sourceUrl.toString(),
      trust.source.database,
      options.binDirectory,
      options.signal,
    );
    assert(tools.pg_dump === 16 && tools.pg_restore === 16);
    pass(step);
    options.signal?.throwIfAborted();
    await options.onSource?.({
      source,
      observation: sourceBefore,
      sourcePin: sourceIdentityPin,
      targetPin: targetPin!,
      trust,
    });
    if (options.mode === "rehearse") {
      step = "archive";
      directory = await mkdtemp(
        path.join(options.workDirectory, "lms-native-rehearsal-"),
      );
      archive = path.join(directory, "fictional.dump");
      await backupDatabase(
        sourceUrl.toString(),
        trust.source.database,
        archive,
        options.binDirectory,
        { signal: options.signal },
      );
      pass(step);
      step = "restore";
      await restoreDatabase(
        targetUrl.toString(),
        trust.target.database,
        archive,
        options.binDirectory,
        {
          signal: options.signal,
          beforeRestore: async (c) => {
            const pin = await authority(c, trust, trust.target.database);
            assert(
              pin.oid === targetOid &&
                pin.cluster === sourceIdentityPin.cluster &&
                pin.locale === sourceIdentityPin.locale,
            );
            await alone(c);
            await empty(c);
          },
          verify: async (c) => {
            pass("restore");
            step = "integrity";
            await c.query(
              "set time zone 'UTC'; set datestyle='ISO, MDY'; begin read only",
            );
            try {
              out.versions.target.migration = await inspectSchema(c, true);
              const restored = await observeNative(c, key);
              out.versions.target.configurationSchemas =
                restored.configurationSchemas;
              out.versions.target.buildPlanVersions =
                restored.buildPlanVersions;
              sameNative(sourceBefore!, restored, true);
              await quarantined(c, trust.source.instanceId);
              await inspectIsolation(c);
              await options.onCopy?.(restored);
              pass("integrity");
            } finally {
              await c.query("rollback");
            }
          },
        },
      );
      step = "quarantine";
      await blockedLeases(targetUrl);
      pass(step);
    }
    step = "source";
    await alone(source);
    await sourceIdentity(source, trust);
    sameNative(sourceBefore, await observeNative(source, key), false);
    pass(step);
    options.signal?.throwIfAborted();
    out.result =
      options.mode === "rehearse" ? "rehearsal-complete" : "preflight-complete";
  } catch {
    out.checks.find((c) => c.id === step)!.status = "blocked";
    out.remainingBlockers.unshift(
      "Incomplete or refused " +
        steps[step] +
        ". Stop, inspect private local state and obtain fresh evidence; no success or automatic retry is authorized.",
    );
  } finally {
    if (source) {
      try {
        await source.query("rollback");
        await source.end();
      } catch {
        out.result = "blocked";
        out.checks.find((c) => c.id === "source")!.status = "blocked";
      }
    }
    if (directory) {
      try {
        if (archive)
          await unlink(archive).catch((e) => {
            if (e.code !== "ENOENT") throw e;
          });
        await rmdir(directory);
        pass("cleanup");
      } catch {
        out.result = "blocked";
        out.checks.find((c) => c.id === "cleanup")!.status = "blocked";
        out.remainingBlockers.unshift(
          "Private temporary cleanup failed. Retain quarantine and inspect the approved work directory locally.",
        );
      }
    }
    key.fill(0);
  }
  if (out.checks.some((c) => c.status === "blocked")) out.result = "blocked";
  if (options.signal?.aborted) {
    out.result = "blocked";
    out.remainingBlockers.unshift(
      "Operation interrupted. Partial observations grant no readiness or automatic retry.",
    );
  }
  if (out.result === "rehearsal-complete")
    out.backupReadiness = "verified-fictional-round-trip";
  return out;
}
