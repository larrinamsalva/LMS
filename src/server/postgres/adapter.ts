import { Pool, type PoolClient } from "pg";
import type { SqlConnection, SqlDatabase } from "../../core/engine";
export interface PostgresOptions {
  connectionString: string;
  maxConnections?: number;
  /** Remote connections require verified TLS. Supply a private CA when necessary. */
  ca?: string;
  onIdleError?: (error: Error) => void;
}
export function connectionOptions(options: PostgresOptions) {
  const url = new URL(options.connectionString);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    url.pathname.length < 2 ||
    url.search
  )
    throw new Error(
      "Use an explicit PostgreSQL URL without query parameters. TLS is configured separately.",
    );
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const max = options.maxConnections ?? 5;
  if (!Number.isInteger(max) || max < 1 || max > 20)
    throw new Error("Pool size must be between 1 and 20.");
  return {
    connectionString: options.connectionString,
    max,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    statement_timeout: 10000,
    lock_timeout: 5000,
    idle_in_transaction_session_timeout: 15000,
    ssl:
      local && !options.ca
        ? false
        : {
            rejectUnauthorized: true,
            ...(options.ca ? { ca: options.ca } : {}),
          },
    application_name: "lms-storage-experimental",
  };
}
async function verifyRuntime(client: PoolClient) {
  const { rows } = await client.query<{ safe: boolean }>(`select
    not r.rolsuper and not r.rolbypassrls and not r.rolcreaterole and not r.rolcreatedb
    and not r.rolinherit and r.rolcanlogin
    and pg_has_role(session_user,'lms_app','MEMBER')
    and not exists(select 1 from pg_namespace n where n.nspname in ('lms','lms_private','lms_meta','lms_identity') and pg_has_role(session_user,n.nspowner,'MEMBER'))
    and not exists(select 1 from pg_database d where d.datname=current_database() and pg_has_role(session_user,d.datdba,'MEMBER')) as safe
    from pg_roles r where r.rolname=session_user`);
  if (!rows[0]?.safe)
    throw new Error(
      "Refusing unsafe PostgreSQL runtime credentials. Use a non-owner NOINHERIT login with only lms_app membership.",
    );
  const grants = await client.query<{
    rolname: string;
  }>(`select r.rolname from pg_roles r
    where r.rolname<>session_user and pg_has_role(session_user,r.oid,'MEMBER') and r.rolname<>'lms_app'`);
  if (grants.rows.length)
    throw new Error("Runtime login has unexpected role memberships.");
}
function connection(client: PoolClient): SqlConnection {
  return {
    async query<T>(sql: string, parameters?: unknown[]) {
      return { rows: (await client.query(sql, parameters)).rows as T[] };
    },
    exec: (sql) => client.query(sql),
  };
}
/** Host-only adapter. No web route or demo module imports it. Never accepts a client identity. */
export async function connectPostgres(
  options: PostgresOptions,
): Promise<SqlDatabase & { close(): Promise<void> }> {
  const pool = new Pool(connectionOptions(options));
  pool.on(
    "error",
    options.onIdleError ??
      (() => console.error("An idle LMS PostgreSQL connection failed.")),
  );
  try {
    const client = await pool.connect();
    try {
      await verifyRuntime(client);
    } finally {
      client.release();
    }
  } catch (error) {
    await pool.end();
    throw error;
  }
  return {
    async query<T>(sql: string, parameters?: unknown[]) {
      return { rows: (await pool.query(sql, parameters)).rows as T[] };
    },
    exec: (sql) => pool.query(sql),
    async transaction<T>(fn: (tx: SqlConnection) => Promise<T>) {
      const client = await pool.connect();
      let discard = false;
      try {
        await verifyRuntime(client);
        await client.query("BEGIN");
        const value = await fn(connection(client));
        await client.query("COMMIT");
        return value;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          discard = true;
        }
        throw error;
      } finally {
        client.release(discard);
      }
    },
    close: () => pool.end(),
  };
}
