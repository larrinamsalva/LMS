import { afterAll, beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createDatabase, sqlDatabase } from "../../src/server/database";
import { Engine } from "../../src/core/engine";
import { presets } from "../../src/presets";
import { logoFixture } from "../helpers/logo-fixtures";
import { sanitizeLogo } from "../../src/server/logo-sanitizer";
let db: Awaited<ReturnType<typeof createDatabase>>, engine: Engine;
const owner = randomUUID(),
  staff = randomUUID(),
  org = randomUUID(),
  other = randomUUID();
let instance: string, image: Buffer;
const digest = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
beforeAll(async () => {
  db = await createDatabase();
  // The public demo schema deliberately has no durable assets. Only this test applies the REAL host migrations.
  expect(
    (
      await db.query<{ asset: string | null }>(
        "select to_regclass('lms.logo_assets')::text as asset",
      )
    ).rows[0].asset,
  ).toBeNull();
  await db.exec(
    "create role lms_auth_service nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls",
  );
  for (const file of [
    "002_local_identity",
    "003_owner_memberships",
    "004_account_lifecycle",
    "005_offline_recovery",
    "006_credential_lineage",
    "013_private_logo_assets",
  ])
    await db.exec(await readFile(`db/${file}.sql`, "utf8"));
  instance = (
    await db.query<{ id: string }>(
      "select instance_id as id from lms_control.state",
    )
  ).rows[0].id;
  for (const id of [owner, staff])
    await db.query("insert into lms.users values($1,'Fictional asset test')", [
      id,
    ]);
  for (const id of [org, other]) {
    await db.query(
      "insert into lms.organizations values($1,'Fictional asset lab')",
      [id],
    );
    await db.query("insert into lms.memberships values($1,$2,'owner')", [
      id,
      owner,
    ]);
  }
  await db.query("insert into lms.memberships values($1,$2,'staff')", [
    org,
    staff,
  ]);
  engine = new Engine(sqlDatabase(db));
  image = (await sanitizeLogo(await logoFixture())).bytes;
});
afterAll(async () => {
  await db?.close();
});
async function op(
  command: object,
  actor = owner,
  group = org,
  png: Buffer | null = null,
) {
  return engine.asUser(
    { userId: actor },
    async (tx) =>
      (
        await tx.query<{ result: any }>(
          "select lms.logo_operation($1,$2,$3,$4) as result",
          [group, instance, command, png],
        )
      ).rows[0].result,
  );
}
it("uses the original PostgreSQL role, context and online controls for an immutable, unselected stored PNG", async () => {
  const command = {
    version: 1,
    action: "store",
    operationId: randomUUID(),
    expectedRevision: 0,
    display: "rectangle",
    inputSha256: digest(image),
  };
  const result = await op(command, owner, org, image);
  expect(result.action).toBe("store");
  expect(result.assetRevision).toBe(1);
  expect(result.revision).toBe(1);
  expect(await op(command, owner, org, image)).toEqual(result);
  await expect(
    op({ ...command, display: "square" }, owner, org, image),
  ).rejects.toMatchObject({ code: "40001" });
  const selected = {
    version: 1,
    action: "select",
    operationId: randomUUID(),
    expectedRevision: 1,
    assetId: result.assetId,
    assetRevision: 1,
  };
  const chosen = await op(selected);
  expect(chosen.revision).toBe(2);
  expect(await op(selected)).toEqual(chosen);
  const bytes = await engine.asUser(
    { userId: staff },
    async (tx) =>
      (
        await tx.query<{ image: Uint8Array }>(
          "select * from lms.logo_read($1,$2,$3,2)",
          [org, instance, result.assetId],
        )
      ).rows[0].image,
  );
  expect(digest(bytes)).toBe(digest(image));
  await expect(
    engine.asUser({ userId: owner }, (tx) =>
      tx.query("select content from lms.logo_assets"),
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    engine.asUser({ userId: owner }, (tx) =>
      tx.query("delete from lms.logo_assets"),
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    op({
      ...selected,
      operationId: randomUUID(),
      expectedRevision: 2,
      action: "retire",
      assetRevision: 2,
    }),
  ).rejects.toMatchObject({ code: "23514" });
});
it("refuses missing revisions, cross-organization IDs, forged state and unauthorized writes without altering histories", async () => {
  const before = (
    await db.query("select count(*)::int n from lms.logo_asset_history")
  ).rows;
  const command = {
    version: 1,
    action: "store",
    operationId: randomUUID(),
    expectedRevision: 0,
    display: "square",
    inputSha256: digest(image),
  };
  await expect(op(command, staff, org, image)).rejects.toMatchObject({
    code: "42501",
  });
  const { expectedRevision: _, ...missing } = command;
  await expect(op(missing, owner, other, image)).rejects.toMatchObject({
    code: "23514",
  });
  await expect(
    op(
      { ...command, expectedRevision: 0, action: "<script>" },
      owner,
      other,
      image,
    ),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    engine.asUser({ userId: staff }, (tx) =>
      tx.query("select * from lms.logo_read($1,$2,$3,1)", [
        other,
        instance,
        randomUUID(),
      ]),
    ),
  ).rejects.toMatchObject({ code: "42501" });
  expect(
    (await db.query("select count(*)::int n from lms.logo_asset_history")).rows,
  ).toEqual(before);
});
it("keeps restored/recovery activation blocked even through direct asset SQL entry points", async () => {
  await db.exec(
    "update lms_control.state set blocked=true,reason='recovery-pending'",
  );
  await expect(
    engine.asUser({ userId: owner }, (tx) =>
      tx.query("select lms.logo_snapshot($1,$2)", [org, instance]),
    ),
  ).rejects.toMatchObject({ code: "55000" });
});
