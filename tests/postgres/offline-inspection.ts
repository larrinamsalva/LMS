// Test-only administrator inspection. This deliberately bypasses runtime factories to
// verify restored bytes/RLS while activation stays blocked. Never mount or export it.
import type { Client } from "pg";
import {
  Engine,
  type SqlDatabase,
  type SqlConnection,
} from "../../src/core/engine";
import { passwordCodec } from "../../src/server/auth/password";
export function offlineEngine(client: Client) {
  const connection: SqlConnection = {
    async query<T>(sql: string, parameters?: unknown[]) {
      return { rows: (await client.query(sql, parameters)).rows as T[] };
    },
    exec: (sql) => client.query(sql),
  };
  const db: SqlDatabase = {
    ...connection,
    async transaction<T>(fn: (tx: SqlConnection) => Promise<T>) {
      await client.query("begin");
      try {
        const result = await fn(connection);
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    },
  };
  return new Engine(db);
}
export async function offlinePassword(
  client: Client,
  user: string,
  password: string,
) {
  const row = (
    await client.query(
      'select password from lms_identity.account where "userId"=$1 and "providerId"=\'credential\'',
      [user],
    )
  ).rows[0];
  return (
    !!row?.password && passwordCodec.verify({ hash: row.password, password })
  );
}
