import { spawn } from "node:child_process";
import { open, unlink } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { ensureApplicationRole } from "./migrations";
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
      ["--format=custom", "--no-owner", "--no-password"],
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
    const tables = await client.query(
      "select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and c.relkind in ('r','p','v','m','S') limit 1",
    );
    if (tables.rows.length)
      throw new Error("Restore target is not empty. Refusing to overwrite it.");
    await ensureApplicationRole(client);
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
    } finally {
      await handle.close();
    }
  } finally {
    await client.end();
  }
}
