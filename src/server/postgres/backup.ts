import { spawn } from "node:child_process";
import { open, unlink } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { ensureApplicationRole, ensureIdentityRole } from "./migrations";
import { localTarget } from "./targets";
function pgEnvironment(url: URL) {
  // Remove inherited libpq settings entirely; an empty PGSERVICE is still a service selection.
  const environment = { ...process.env };
  for (const name of Object.keys(environment))
    if (name.startsWith("PG")) delete environment[name];
  return {
    ...environment,
    PGHOST: url.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGCONNECT_TIMEOUT: "5",
    PGSSLMODE: "disable",
  };
}
async function runTool(
  name: string,
  args: string[],
  url: URL,
  input: number | "ignore",
  output: number | "ignore",
  binDirectory?: string,
) {
  const executable = binDirectory ? path.join(binDirectory, name) : name;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      env: pgEnvironment(url),
      stdio: [input, output, "pipe"],
    });
    // Do not echo database credentials, archive SQL, or subprocess diagnostics to public logs.
    child.stderr?.resume();
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${name} timed out.`));
    }, 60000);
    child.once("error", () => {
      clearTimeout(timer);
      reject(
        new Error(
          `Unable to start ${name}. Install compatible PostgreSQL client tools.`,
        ),
      );
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve()
        : reject(
            new Error(
              `${name} failed (exit ${code}). Inspect the local target and client/server versions.`,
            ),
          );
    });
  });
}
export async function backupDatabase(
  databaseUrl: string,
  databaseName: string,
  file: string,
  binDirectory?: string,
) {
  const target = localTarget(databaseUrl, databaseName);
  const handle = await open(file, "wx", 0o600);
  let success = false;
  try {
    await runTool(
      "pg_dump",
      [
        "--format=custom",
        "--no-owner",
        "--no-password",
        "--exclude-table-data=lms_identity.session",
        "--exclude-table-data=lms_identity.verification",
        "--exclude-table-data=lms_private.membership_reviews",
        "--exclude-table-data=lms_private.recovery_cases",
      ],
      target,
      "ignore",
      handle.fd,
      binDirectory,
    );
    success = true;
  } finally {
    await handle.close();
    if (!success) await unlink(file);
  }
}
/** Trusted local archives only. Never drops or overwrites an existing workspace. */
export async function restoreDatabase(
  databaseUrl: string,
  databaseName: string,
  file: string,
  binDirectory?: string,
) {
  const target = localTarget(databaseUrl, databaseName);
  if (
    !databaseName.startsWith("lms_restore_") &&
    !databaseName.startsWith("lms_test_")
  )
    throw new Error(
      "Restore requires a separate fictional restore/test database.",
    );
  const client = new Client({
    connectionString: target.toString(),
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  try {
    if (
      !(await client.query("select pg_try_advisory_lock(74021906) as held"))
        .rows[0].held
    )
      throw new Error("Stop runtime hosts before restoring.");
    const tables = await client.query(
      "select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and c.relkind in ('r','p','v','m','S') limit 1",
    );
    if (tables.rows.length)
      throw new Error("Restore target is not empty. Refusing to overwrite it.");
    await ensureApplicationRole(client);
    await ensureIdentityRole(client);
    // Durable outside the archive/cleanup transaction: even a failed restore cannot activate.
    const quarantine = (
      await client.query(
        "select format('alter database %I set lms.restore_blocked to %L',current_database(),'on') as command",
      )
    ).rows[0].command;
    await client.query(quarantine);
    const handle = await open(file, "r");
    try {
      await runTool(
        "pg_restore",
        [
          "--single-transaction",
          "--exit-on-error",
          "--no-owner",
          "--no-password",
          "--dbname",
          databaseName,
        ],
        target,
        handle.fd,
        "ignore",
        binDirectory,
      );
      // Every supported archive is quarantined, including those predating the recovery schema.
      // Keep the target offline if any cleanup step fails; never report successful activation.
      await client.query("BEGIN");
      try {
        if (
          (
            await client.query(
              "select to_regclass('lms_identity.session') as sessions",
            )
          ).rows[0].sessions
        )
          await client.query(
            "delete from lms_identity.session; delete from lms_identity.verification",
          );
        if (
          (
            await client.query(
              "select to_regclass('lms_private.recovery_cases') as cases",
            )
          ).rows[0].cases
        )
          await client.query("delete from lms_private.recovery_cases");
        await client.query(`create schema if not exists lms_control;
          revoke all on schema lms_control from public;
          grant usage on schema lms_control to lms_app,lms_auth_service;
          create table if not exists lms_control.restore_blocker(singleton boolean primary key default true check(singleton));
          alter table lms_control.restore_blocker enable row level security;
          alter table lms_control.restore_blocker force row level security;
          revoke all on lms_control.restore_blocker from public,lms_app,lms_auth_service;`);
        if (
          (
            await client.query(
              "select to_regclass('lms_control.state') as state",
            )
          ).rows[0].state
        )
          await client.query(
            "update lms_control.state set blocked=true,reason='restored-archive',instance_id=gen_random_uuid()",
          );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      await handle.close();
    }
  } finally {
    await client.end();
  }
}
