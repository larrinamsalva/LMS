import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { Engine } from "../../src/core/engine";
import { presets } from "../../src/presets";
import { connectPostgres } from "../../src/server/postgres/adapter";
/** Trusted test fixture only: never imported by app routes or used to provision real users. */
export async function seedFictional(client: Client, runtimeUrl: string) {
  const owner = randomUUID(),
    other = randomUUID(),
    viewer = randomUUID(),
    staff = randomUUID();
  const property = randomUUID(),
    cleaning = randomUUID();
  await client.query("BEGIN");
  try {
    for (const user of [owner, other, viewer, staff])
      await client.query(
        "insert into lms.users values($1,'Fictional test identity')",
        [user],
      );
    for (const [org, user, config] of [
      [property, owner, presets.property],
      [cleaning, other, presets.cleaning],
    ] as const) {
      await client.query("select set_config('lms.user_id',$1,true)", [user]);
      await client.query("insert into lms.organizations values($1,$2)", [
        org,
        config.name,
      ]);
      await client.query("insert into lms.memberships values($1,$2,'owner')", [
        org,
        user,
      ]);
      await client.query(
        "insert into lms.config_revisions(organization_id,revision,document,created_by) values($1,1,$2,$3)",
        [org, config, user],
      );
    }
    await client.query(
      "insert into lms.memberships values($1,$2,'viewer'),($1,$3,'staff')",
      [property, viewer, staff],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  const db = await connectPostgres({ connectionString: runtimeUrl });
  try {
    await new Engine(db).saveRecord({ userId: owner }, property, "customers", {
      name: "Durable Fictional Customer",
      email: "durable@example.test",
    });
  } finally {
    await db.close();
  }
  return { owner, other, viewer, staff, property, cleaning };
}
