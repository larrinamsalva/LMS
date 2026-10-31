import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Client } from "pg";
export interface Migration {
  version: number;
  name: string;
  sql: string;
}
export const checksum = (sql: string) =>
  createHash("sha256").update(sql).digest("hex");
/** Reuses the original SQL, removing only its transaction/cluster-role scaffolding. */
export async function loadMigrations(): Promise<Migration[]> {
  return Promise.all(
    [
      "001_foundation",
      "002_local_identity",
      "003_owner_memberships",
      "004_account_lifecycle",
      "005_offline_recovery",
    ].map(async (name, index) => ({
      version: index + 1,
      name,
      sql: await readFile(
        path.join(process.cwd(), "db", name + ".sql"),
        "utf8",
      ),
    })),
  );
}
async function ensureNoLoginRole(
  client: Client,
  name: "lms_app" | "lms_auth_service",
) {
  const role = await client.query(
    "select rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolbypassrls from pg_roles where rolname=$1",
    [name],
  );
  if (!role.rows.length)
    await client.query(
      `create role ${name} nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls`,
    );
  else if (Object.values(role.rows[0]).some(Boolean))
    throw new Error(
      `Existing ${name} role has unsafe attributes. No changes applied.`,
    );
  const parents = await client.query(
    "select 1 from pg_auth_members m join pg_roles r on r.oid=m.member where r.rolname=$1",
    [name],
  );
  if (parents.rows.length)
    throw new Error(`${name} must not inherit or assume other roles.`);
}
export async function ensureApplicationRole(client: Client) {
  await ensureNoLoginRole(client, "lms_app");
}
export async function ensureIdentityRole(client: Client) {
  await ensureNoLoginRole(client, "lms_auth_service");
}
export async function provisionAuthRuntime(client: Client, runtimeUrl: string) {
  const url = new URL(runtimeUrl);
  const password = decodeURIComponent(url.password);
  if (
    url.username !== "lms_auth_runtime" ||
    password.length < 24 ||
    password.includes("REPLACE_WITH")
  )
    throw new Error("Use lms_auth_runtime and a generated, separate password.");
  await client.query("BEGIN");
  try {
    await client.query("select pg_advisory_xact_lock(74021903)");
    await ensureIdentityRole(client);
    if (
      !(
        await client.query(
          "select 1 from pg_roles where rolname='lms_auth_runtime'",
        )
      ).rows.length
    ) {
      const literal = (
        await client.query<{ value: string }>(
          "select quote_literal($1) as value",
          [password],
        )
      ).rows[0].value;
      await client.query(
        `create role lms_auth_runtime login nosuperuser nocreatedb nocreaterole noinherit nobypassrls password ${literal}`,
      );
      await client.query("grant lms_auth_service to lms_auth_runtime");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
export async function provisionRuntime(client: Client, runtimeUrl: string) {
  const url = new URL(runtimeUrl);
  const password = decodeURIComponent(url.password);
  if (
    url.username !== "lms_runtime" ||
    password.length < 24 ||
    password.includes("REPLACE_WITH")
  )
    throw new Error(
      "Use lms_runtime and a generated password of at least 24 characters.",
    );
  await client.query("BEGIN");
  try {
    await client.query("select pg_advisory_xact_lock(74021902)");
    await ensureApplicationRole(client);
    const present = await client.query(
      `select 1 from pg_roles where rolname='lms_runtime'`,
    );
    if (!present.rows.length) {
      const literal = (
        await client.query<{ value: string }>(
          "select quote_literal($1) as value",
          [password],
        )
      ).rows[0].value;
      await client.query(
        `create role lms_runtime login nosuperuser nocreatedb nocreaterole noinherit nobypassrls password ${literal}`,
      );
      await client.query("grant lms_app to lms_runtime");
    }
    // Never reset an existing password or silently repair an unsafe role.
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
function migrationBody(migration: Migration) {
  if (migration.version !== 1 || migration.name !== "001_foundation") {
    if (/^\s*(begin|commit|rollback)\s*;/im.test(migration.sql))
      throw new Error("Migrations must not control their own transactions.");
    return migration.sql;
  }
  const role =
    "create role lms_app nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;";
  if (
    migration.sql.split(role).length !== 2 ||
    migration.sql.match(/^begin;$/gim)?.length !== 1 ||
    migration.sql.match(/^commit;$/gim)?.length !== 1
  )
    throw new Error(
      "Unrecognized foundation scaffolding. Review the migration loader.",
    );
  return migration.sql
    .replace(role, "")
    .replace(/^begin;$/im, "")
    .replace(/^commit;$/im, "");
}
/** All pending migrations + ledger entries commit together; failure leaves no partial schema. */
export async function migrate(client: Client, migrations: Migration[] = []) {
  const files = migrations.length ? migrations : await loadMigrations();
  if (
    files.some(
      (m, i) =>
        !Number.isSafeInteger(m.version) ||
        m.version < 1 ||
        (i > 0 && m.version <= files[i - 1].version),
    )
  )
    throw new Error("Migration versions must be unique and ordered.");
  await client.query("BEGIN");
  try {
    await client.query("select pg_advisory_xact_lock(74021901)");
    const tracked = (
      await client.query(
        "select to_regclass('lms_meta.migrations') as ledger,to_regclass('lms.organizations') as foundation",
      )
    ).rows[0];
    if (!tracked.ledger && tracked.foundation)
      throw new Error(
        "Untracked existing LMS schema. Refusing automatic adoption. Back up and review manually.",
      );
    await client.query(`create schema if not exists lms_meta;
      revoke all on schema lms_meta from public;
      create table if not exists lms_meta.migrations(version integer primary key,name text not null,checksum text not null,applied_at timestamptz not null default now());
      alter table lms_meta.migrations enable row level security;
      alter table lms_meta.migrations force row level security;
      revoke all on lms_meta.migrations from public;`);
    const applied = (
      await client.query<{ version: number; name: string; checksum: string }>(
        "select version,name,checksum from lms_meta.migrations order by version",
      )
    ).rows;
    for (const row of applied) {
      const file = files.find((f) => f.version === row.version);
      if (
        !file ||
        file.name !== row.name ||
        checksum(file.sql) !== row.checksum
      )
        throw new Error(
          "Migration history mismatch. Refusing changed or unknown migrations.",
        );
    }
    await ensureApplicationRole(client);
    await ensureIdentityRole(client);
    const pending = files.filter(
      (f) => !applied.some((a) => a.version === f.version),
    );
    for (const file of pending) {
      await client.query(migrationBody(file));
      await client.query(
        "insert into lms_meta.migrations(version,name,checksum) values($1,$2,$3)",
        [file.version, file.name, checksum(file.sql)],
      );
    }
    await client.query("COMMIT");
    return pending.map((m) => m.name);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
