import { afterAll, beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createDatabase, sqlDatabase } from "../../src/server/database";
import { Engine } from "../../src/core/engine";
import { defaultBranding } from "../../src/core/branding";
import {
  logoAssociation,
  logoAssociationReview,
} from "../../src/core/logo-associations";
import { presets } from "../../src/presets";
import { logoFixture } from "../helpers/logo-fixtures";
import { sanitizeLogo } from "../../src/server/logo-sanitizer";
import { privateLogoAssociations } from "../../src/server/postgres/logo-associations";
import { readVerifiedStoredLogo } from "../../src/server/stored-logo-reader";
let db: Awaited<ReturnType<typeof createDatabase>>, engine: Engine;
const owner = randomUUID(),
  staff = randomUUID(),
  org = randomUUID(),
  other = randomUUID();
let instance: string, image: Buffer;
const hash = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
async function call(
  fn: string,
  params: unknown[] = [],
  actor = owner,
  group = org,
) {
  return engine.asUser(
    { userId: actor },
    async (tx) =>
      (
        await tx.query<{ document: any }>(
          `select lms.${fn}($1,$2${params.map((_, i) => `,$${i + 3}`).join("")}) as document`,
          [group, instance, ...params],
        )
      ).rows[0].document,
  );
}
async function selectImage() {
  let state = await call("logo_snapshot");
  const stored = await call("logo_operation", [
    {
      version: 1,
      operationId: randomUUID(),
      expectedRevision: state.revision,
      action: "store",
      display: "square",
      inputSha256: hash(image),
    },
    image,
  ]);
  state = await call("logo_snapshot");
  return call("logo_operation", [
    {
      version: 1,
      operationId: randomUUID(),
      expectedRevision: state.revision,
      action: "select",
      assetId: stored.assetId,
      assetRevision: stored.assetRevision,
    },
    null,
  ]);
}
async function review(mode = "image", previous: number | null = null) {
  return logoAssociationReview.parse(
    await call("logo_association_review", [
      mode,
      mode === "image" ? "rectangle" : null,
      previous,
    ]),
  );
}
const command = (review: unknown) => ({
  format: "lms-private-logo-association-command",
  version: 1,
  operationId: randomUUID(),
  review,
  confirmed: true,
});
beforeAll(async () => {
  db = await createDatabase();
  expect(
    (
      await db.query<{ t: string | null }>(
        "select to_regclass('lms.logo_associations')::text t",
      )
    ).rows[0].t,
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
    "014_private_logo_associations",
  ])
    await db.exec(await readFile(`db/${file}.sql`, "utf8"));
  instance = (
    await db.query<{ id: string }>(
      "select instance_id as id from lms_control.state",
    )
  ).rows[0].id;
  for (const id of [owner, staff])
    await db.query(
      "insert into lms.users values($1,'Fictional association test')",
      [id],
    );
  await db.query("select set_config('lms.user_id',$1,false)", [owner]);
  for (const id of [org, other]) {
    await db.query(
      "insert into lms.organizations values($1,'Fictional association lab')",
      [id],
    );
    await db.query("insert into lms.memberships values($1,$2,'owner')", [
      id,
      owner,
    ]);
    await db.query(
      "insert into lms.config_revisions(organization_id,revision,document,created_by) values($1,1,$2,$3)",
      [
        id,
        {
          ...presets.property,
          schemaVersion: 2,
          branding: defaultBranding("property"),
        },
        owner,
      ],
    );
  }
  await db.query("insert into lms.memberships values($1,$2,'staff')", [
    org,
    staff,
  ]);
  engine = new Engine(sqlDatabase(db));
  image = (await sanitizeLogo(await logoFixture())).bytes;
});
afterAll(async () => {
  image?.fill(0);
  await db?.close();
});
it("binds only explicitly reviewed current selections, atomically records receipts and secret-free audit history", async () => {
  const chosen = await selectImage();
  expect((await call("logo_association_inspect")).status).toBe("builtin");
  const r = await review(),
    cmd = command(r);
  const a = logoAssociation.parse(
    await call("logo_association_operation", [cmd]),
  );
  expect(a.asset).toMatchObject({
    id: chosen.assetId,
    revision: chosen.assetRevision,
    sha256: hash(image),
  });
  expect(a.configurationRevision).toBe(1);
  expect(a.display).toBe("rectangle");
  expect(await call("logo_association_operation", [cmd])).toEqual(a);
  await expect(
    call("logo_association_operation", [
      { ...cmd, review: { ...r, display: "square" } },
    ]),
  ).rejects.toMatchObject({ code: "40001" });
  expect((await call("logo_association_history")).length).toBe(1);
  const audit = (
    await db.query<{ after_data: unknown }>(
      "select after_data from lms.audit_events where entity='private-logo-association'",
    )
  ).rows;
  expect(audit).toHaveLength(1);
  expect(JSON.stringify(audit)).not.toContain(hash(image));
  expect(JSON.stringify(audit)).not.toContain(image.toString("base64"));
  const bytes = await engine.asUser({ userId: staff }, (tx) =>
    tx.query<{ image: Uint8Array }>(
      "select * from lms.logo_association_read($1,$2,1,1)",
      [org, instance],
    ),
  );
  expect(hash(bytes.rows[0].image)).toBe(hash(image));
});
it("keeps the old associated image when a different asset is merely selected, then requires a new review for replacement", async () => {
  const old = await call("logo_association_inspect"),
    stale = await review();
  await selectImage();
  expect((await call("logo_association_inspect")).association).toEqual(
    old.association,
  );
  expect((await call("logo_association_inspect")).status).toBe("active");
  await expect(
    call("logo_association_operation", [command(stale)]),
  ).rejects.toMatchObject({ code: "40001" });
  await expect(review("image", 1)).rejects.toMatchObject({ code: "23514" });
  await call("logo_association_operation", [command(await review())]);
  expect((await call("logo_association_history")).length).toBe(2);
});
it("configuration publication and rollback each require explicit rebinding, even when returning to identical branding", async () => {
  const previous = await review();
  const original = (await engine.snapshot({ userId: owner }, org)).config;
  const next = { ...original.document, name: "Fictional renamed lab" };
  expect(await engine.publishConfig({ userId: owner }, org, next, 1)).toBe(2);
  expect((await call("logo_association_inspect")).status).toBe(
    "configuration-changed",
  );
  await expect(
    call("logo_association_operation", [command(previous)]),
  ).rejects.toMatchObject({ code: "40001" });
  await expect(
    engine.asUser({ userId: staff }, (tx) =>
      tx.query("select * from lms.logo_association_read($1,$2,2,1)", [
        org,
        instance,
      ]),
    ),
  ).rejects.toMatchObject({ code: "40001" });
  await call("logo_association_operation", [command(await review())]);
  expect(
    await engine.publishConfig({ userId: owner }, org, original.document, 2, 1),
  ).toBe(3);
  expect((await call("logo_association_inspect")).status).toBe(
    "configuration-changed",
  );
  const renewed = await call("logo_association_operation", [
    command(await review("image", 2)),
  ]);
  expect(renewed.configurationRevision).toBe(3);
  expect(renewed.restoredFrom).toBe(2);
});
it("explicit fallback preserves references and prevents retirement; historical restoration requires deliberate current selection", async () => {
  const imageAssociation = (await call("logo_association_inspect")).association;
  await call("logo_association_operation", [command(await review("builtin"))]);
  expect((await call("logo_association_inspect")).status).toBe("builtin");
  const snapshot = await call("logo_snapshot"),
    a = snapshot.assets.find((a: any) => a.id === imageAssociation.asset.id);
  await call("logo_operation", [
    {
      version: 1,
      operationId: randomUUID(),
      expectedRevision: snapshot.revision,
      action: "unselect",
      assetId: a.id,
      assetRevision: a.revision,
    },
    null,
  ]);
  const state = await call("logo_snapshot"),
    asset = state.assets.find((a: any) => a.id === imageAssociation.asset.id);
  await expect(
    call("logo_operation", [
      {
        version: 1,
        operationId: randomUUID(),
        expectedRevision: state.revision,
        action: "retire",
        assetId: asset.id,
        assetRevision: asset.revision,
      },
      null,
    ]),
  ).rejects.toMatchObject({ code: "23514" });
  expect((await call("logo_association_history")).length).toBe(5);
  await expect(
    review("image", imageAssociation.revision),
  ).rejects.toMatchObject({ code: "23514" });
});
it("rejects unauthorized, foreign, malformed and unconfirmed commands and protects history through forced RLS", async () => {
  const r = await review("builtin");
  await expect(
    call("logo_association_review", ["image", "square", null], staff),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    call("logo_association_operation", [command(r)], staff),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    call("logo_association_operation", [command(r)], owner, other),
  ).rejects.toMatchObject({ code: "40001" });
  await expect(
    call("logo_association_operation", [{ ...command(r), format: undefined }]),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    call("logo_association_operation", [{ ...command(r), confirmed: false }]),
  ).rejects.toMatchObject({ code: "23514" });
  for (const sql of [
    "delete from lms.logo_associations",
    "update lms.logo_association_states set revision=0",
    "delete from lms.logo_association_receipts",
    "truncate lms.logo_associations",
  ])
    await expect(
      engine.asUser({ userId: owner }, (tx) => tx.exec(sql)),
    ).rejects.toMatchObject({ code: "42501" });
  expect(
    (
      await engine.asUser({ userId: staff }, (tx) =>
        tx.query("select * from lms.logo_associations"),
      )
    ).rows,
  ).toHaveLength(0);
  await db.query(
    "delete from lms.memberships where organization_id=$1 and user_id=$2",
    [org, staff],
  );
  await expect(
    call("logo_association_inspect", [], staff),
  ).rejects.toMatchObject({ code: "42501" });
});
it("revalidates complete configuration inside commit and rolls back effects even when host review data bypasses the reader", async () => {
  const group = randomUUID();
  await db.query(
    "insert into lms.organizations values($1,'Fictional unsupported configuration')",
    [group],
  );
  await db.query("insert into lms.memberships values($1,$2,'owner')", [
    group,
    owner,
  ]);
  // Existing SQL branding checks are deliberately not a second complete module validator.
  const unsupported = {
    ...presets.property,
    schemaVersion: 2,
    branding: defaultBranding("property"),
    modules: presets.property.modules.map((m) => ({ ...m, version: "99.0.0" })),
  };
  await db.query(
    "insert into lms.config_revisions(organization_id,revision,document,created_by) values($1,1,$2,$3)",
    [group, unsupported, owner],
  );
  const stored = await call(
    "logo_operation",
    [
      {
        version: 1,
        operationId: randomUUID(),
        expectedRevision: 0,
        action: "store",
        display: "square",
        inputSha256: hash(image),
      },
      image,
    ],
    owner,
    group,
  );
  await call(
    "logo_operation",
    [
      {
        version: 1,
        operationId: randomUUID(),
        expectedRevision: stored.revision,
        action: "select",
        assetId: stored.assetId,
        assetRevision: stored.assetRevision,
      },
      null,
    ],
    owner,
    group,
  );
  const rawReview = await call(
      "logo_association_review",
      ["image", "square", null],
      owner,
      group,
    ),
    request = command(rawReview);
  const sdk = privateLogoAssociations(
    (principal, _org, fn) => engine.asUser(principal, fn),
    instance,
    (principal, organization, id, revision) =>
      readVerifiedStoredLogo(
        () =>
          engine.asUser(
            principal,
            async (tx) =>
              (
                await tx.query<{ image: Buffer; metadata: unknown }>(
                  "select * from lms.logo_read($1,$2,$3,$4)",
                  [organization, instance, id, revision],
                )
              ).rows[0],
          ),
        organization,
        { id, revision },
      ),
    (error) => {
      throw error;
    },
  );
  await expect(
    sdk.review({ userId: owner }, group, {
      mode: "image",
      display: "square",
      historyRevision: null,
    }),
  ).rejects.toThrow();
  await expect(
    sdk.apply({ userId: owner }, group, request),
  ).rejects.toMatchObject({
    name: "ZodError",
    issues: expect.arrayContaining([
      expect.objectContaining({ path: ["modules", 0, "version"] }),
    ]),
  });
  expect(await call("logo_association_history", [], owner, group)).toEqual([]);
  for (const table of [
    "lms.logo_associations",
    "lms.logo_association_states",
    "lms.logo_association_receipts",
  ])
    expect(
      (
        await db.query(`select 1 from ${table} where organization_id=$1`, [
          group,
        ])
      ).rows,
    ).toHaveLength(0);
  expect(
    (
      await db.query(
        "select 1 from lms.audit_events where organization_id=$1 and entity='private-logo-association'",
        [group],
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query<{ document: unknown }>(
        "select document from lms.config_revisions where organization_id=$1",
        [group],
      )
    ).rows[0].document,
  ).toEqual(unsupported);
});
it("does not turn associations or their histories into activation tokens", async () => {
  await db.exec(
    "update lms_control.state set blocked=true,reason='recovery-pending'",
  );
  await expect(call("logo_association_inspect")).rejects.toMatchObject({
    code: "55000",
  });
  await expect(call("logo_association_history")).rejects.toMatchObject({
    code: "55000",
  });
});
