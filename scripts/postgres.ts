import { Client } from "pg";
import { migrate, provisionRuntime } from "../src/server/postgres/migrations";
import { connectPostgres } from "../src/server/postgres/adapter";
import { backupDatabase, restoreDatabase } from "../src/server/postgres/backup";
import { localTarget, sameDatabase } from "../src/server/postgres/targets";
const [action, ...args] = process.argv.slice(2);
function argument(key: string) {
  const index = args.indexOf(key);
  return index < 0 ? undefined : args[index + 1];
}
async function main() {
  if (!["init", "migrate", "backup", "restore"].includes(action))
    throw new Error("Choose init, migrate, backup or restore.");
  const database = argument("--database");
  if (!database)
    throw new Error("Pass --database with the exact fictional database name.");
  const raw =
    action === "restore"
      ? process.env.LMS_RESTORE_DATABASE_URL
      : process.env.LMS_ADMIN_DATABASE_URL;
  const target = localTarget(raw, database);
  if (action === "backup" || action === "restore") {
    const file = argument("--file");
    if (!file) throw new Error("Pass --file with a local archive path.");
    if (action === "backup")
      await backupDatabase(
        target.toString(),
        database,
        file,
        process.env.LMS_PG_BIN,
      );
    else
      await restoreDatabase(
        target.toString(),
        database,
        file,
        process.env.LMS_PG_BIN,
      );
    console.log(`${action} completed for fictional database ${database}.`);
    return;
  }
  const client = new Client({
    connectionString: target.toString(),
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  try {
    const administrator = (
      await client.query(
        "select rolsuper from pg_roles where rolname=current_user",
      )
    ).rows[0];
    if (!administrator?.rolsuper)
      throw new Error(
        "Initialization/migrations require the separate local PostgreSQL administrator.",
      );
    const runtime =
      action === "init"
        ? localTarget(process.env.LMS_POSTGRES_URL, database)
        : undefined;
    if (runtime) {
      sameDatabase(target, runtime);
      if (target.password === runtime.password)
        throw new Error("Use different administrator and runtime passwords.");
    }
    const applied = await migrate(client);
    if (runtime) {
      await provisionRuntime(client, runtime.toString());
      const adapter = await connectPostgres({
        connectionString: runtime.toString(),
      });
      await adapter.close();
    }
    console.log(
      `Fictional database ${database}: ${applied.length ? applied.join(", ") : "migrations already current"}${runtime ? "; restricted runtime verified" : ""}.`,
    );
  } finally {
    await client.end();
  }
}
void main().catch((error) => {
  console.error(
    error instanceof Error && !("code" in error)
      ? error.message
      : "PostgreSQL maintenance failed. Check the local configuration and migration state.",
  );
  process.exitCode = 1;
});
