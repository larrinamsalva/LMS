import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SqlDatabase } from "../core/engine";
/** Embedded PostgreSQL: no external database or environment credentials are read. */
export async function createDatabase() {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(path.join(process.cwd(), "db/001_foundation.sql"), "utf8"),
    );
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
/** Structural adapter keeps the core independent of PGlite. */
export function sqlDatabase(db: PGlite): SqlDatabase {
  return {
    query: (sql, params) => db.query(sql, params),
    exec: (sql) => db.exec(sql),
    transaction: (fn) =>
      db.transaction((tx) =>
        fn({
          query: (sql, params) => tx.query(sql, params),
          exec: (sql) => tx.exec(sql),
        }),
      ),
  };
}
