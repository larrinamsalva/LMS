import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Client } from "pg";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Engine } from "../../src/core/engine";
import { presets } from "../../src/presets";
import { defaultBranding } from "../../src/core/branding";
import { openPrivateLogoStore } from "../../src/server/postgres/logo-assets";
import {
  createLocalAuth,
  provisionFictionalAccount,
} from "../../src/server/auth/host";
import { connectPostgres } from "../../src/server/postgres/adapter";
import {
  migrate,
  provisionRuntime,
  provisionAuthRuntime,
} from "../../src/server/postgres/migrations";
import {
  nativeReadiness,
  nativeRehearsalConfirmation,
} from "../../src/server/postgres/native-readiness";
import { localTarget } from "../../src/server/postgres/targets";
import { fictionalBrandedBundle } from "../helpers/branded-logo";
import { logoFixture } from "../helpers/logo-fixtures";
import { seedFictional } from "../../scripts/postgres/fixture";
import * as sanitizer from "../../src/server/logo-sanitizer";
import { createBrandedBlueprintBundle } from "../../src/core/branded-bundle";
import { createLogoCompanion } from "../../src/core/logo-companion";
import { crc32 } from "../../src/core/stored-archive";
import { inspectAuthenticatedBrandedBundle } from "../../src/core/branded-bundle-provenance";
import { testPublisher } from "../helpers/blueprint-provenance";
import { testBundleAttestation } from "../helpers/branded-bundle-provenance";

const raw = process.env.LMS_TEST_ADMIN_URL;
if (!raw)
  throw new Error(
    "LMS_TEST_ADMIN_URL is required; native transfer tests never silently skip.",
  );
const controlName = decodeURIComponent(new URL(raw).pathname.slice(1)),
  control = localTarget(raw, controlName);
if (!controlName.startsWith("lms_test_"))
  throw new Error("Use an explicitly disposable fictional control database.");
const suffix = randomBytes(5).toString("hex"),
  name = "lms_test_transfers_" + suffix;
const restoredName = "lms_restore_transfers_" + suffix;
function url(database = name, role = "admin") {
  const u = new URL(control);
  u.pathname = "/" + database;
  if (role !== "admin") {
    u.username = role === "auth" ? "lms_auth_runtime" : "lms_runtime";
    u.password =
      role === "auth"
        ? "fictional_identity_runtime_password"
        : (process.env.LMS_TEST_RUNTIME_PASSWORD ??
          "fictional_test_password_24_characters");
  }
  return u.toString();
}
const exec = promisify(execFile),
  hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const password = "fictional_transfer_account_password";
const authOptions = {
  databaseUrl: url(name, "auth"),
  databaseName: name,
  origin: "http://127.0.0.1:3200",
  secret: randomBytes(32).toString("hex"),
};
let cluster: Client, admin: Client;
let db: Awaited<ReturnType<typeof connectPostgres>> | undefined;
let store: Awaited<ReturnType<typeof openPrivateLogoStore>> | undefined;
let host: Awaited<ReturnType<typeof createLocalAuth>> | undefined,
  engine: Engine;
let fixture: Awaited<ReturnType<typeof seedFictional>>;
let sample: Awaited<ReturnType<typeof fictionalBrandedBundle>>;
let directory: string,
  trustFile: string,
  instance: string,
  operator: string,
  headers: Headers,
  sourceAsset: string;
const processOrg = randomUUID(),
  quotaOrg = randomUUID(),
  damageOrg = randomUUID(),
  legacyOrg = randomUUID();
const api = () => store!,
  resolve = () => host!.identity(headers),
  actor = () => ({ userId: operator });
const command = (review: unknown) => ({
  format: "lms-private-logo-transfer-command",
  version: 1,
  operationId: randomUUID(),
  review,
  confirmed: true,
});
async function fresh() {
  return openPrivateLogoStore({
    databaseUrl: url(name, "business"),
    trustFile,
  });
}
async function login() {
  // Fixture-only reset; existing auth regression suite separately tests the unchanged rate limiter.
  await admin.query("delete from lms_identity.rate_limit");
  const response = await host!.handle(
    new Request(authOptions.origin + "/api/local-auth/sign-in/email", {
      method: "POST",
      headers: {
        origin: authOptions.origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: "transfer-operator@example.test",
        password,
      }),
    }),
  );
  expect(response.status).toBe(200);
  headers = new Headers({
    cookie: response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  });
}
async function review(org = fixture.property) {
  return (await api().transfers.review(resolve, org, sample.bundle)).review;
}
async function accept(org = fixture.property) {
  return api().transfers.accept(
    resolve,
    org,
    sample.bundle,
    command(await review(org)),
  );
}
async function protectedRows() {
  return (
    await admin.query(
      "select * from (select 'records' k,to_jsonb(r) d from lms.records r union all select 'configs',to_jsonb(c) from lms.config_revisions c union all select 'audit',to_jsonb(a) from lms.audit_events a where entity not in ('private-logo-transfer','private-logo-association')) x order by k,d::text",
    )
  ).rows;
}
async function change(assetId: string, action: string, org = fixture.property) {
  const state = await api().snapshot(actor(), org),
    a = state.assets.find((a) => a.id === assetId)!;
  return api().change(actor(), org, {
    version: 1,
    operationId: randomUUID(),
    expectedRevision: state.revision,
    assetId,
    assetRevision: a.revision,
    action,
  });
}
async function counts() {
  return (
    await admin.query(
      "select (select count(*) from lms.logo_assets)::int assets,(select count(*) from lms.logo_asset_history)::int history,(select count(*) from lms.logo_asset_receipts)::int receipts,(select count(*) from lms.logo_transfer_receipts)::int transfers,(select count(*) from lms.audit_events)::int audits",
    )
  ).rows[0];
}
function fixtureConfig() {
  return {
    ...presets.property,
    schemaVersion: 2 as const,
    branding: defaultBranding("property"),
  };
}
beforeAll(async () => {
  cluster = new Client({ connectionString: control.toString() });
  await cluster.connect();
  for (const n of [name, restoredName])
    await cluster.query('create database "' + n + '"');
  admin = new Client({ connectionString: url() });
  await admin.connect();
  await migrate(admin);
  await provisionRuntime(admin, url(name, "business"));
  await provisionAuthRuntime(admin, url(name, "auth"));
  fixture = await seedFictional(admin, url(name, "business"));
  operator = (
    await provisionFictionalAccount(authOptions, {
      name: "Fictional transfer operator",
      email: "transfer-operator@example.test",
      password,
    })
  ).userId;
  await admin.query("select set_config('lms.user_id',$1,false)", [
    fixture.owner,
  ]);
  await admin.query(
    "insert into lms.users values($1,'Fictional transfer operator')",
    [operator],
  );
  await admin.query("insert into lms.memberships values($1,$2,'admin')", [
    fixture.property,
    operator,
  ]);
  for (const group of [processOrg, quotaOrg, damageOrg, legacyOrg]) {
    await admin.query(
      "insert into lms.organizations values($1,'Fictional transfer lab')",
      [group],
    );
    await admin.query(
      "insert into lms.memberships values($1,$2,'owner'),($1,$3,'admin')",
      [group, fixture.owner, operator],
    );
    await admin.query(
      "insert into lms.config_revisions(organization_id,revision,document,created_by) values($1,1,$2,$3)",
      [
        group,
        group === legacyOrg ? presets.property : fixtureConfig(),
        fixture.owner,
      ],
    );
  }
  instance = (await admin.query("select instance_id from lms_control.state"))
    .rows[0].instance_id;
  directory = await mkdtemp(path.join(os.tmpdir(), "lms-transfer-"));
  await chmod(directory, 0o700);
  trustFile = path.join(directory, "trust.json");
  await writeFile(
    trustFile,
    JSON.stringify({
      format: "lms-native-readiness-trust",
      version: 1,
      environment: "logo-transfer-lab",
      fictionalOnly: true,
      maintenanceRole: decodeURIComponent(control.username),
      source: {
        database: name,
        instanceId: instance,
        organizations: [
          fixture.property,
          fixture.cleaning,
          processOrg,
          quotaOrg,
          damageOrg,
          legacyOrg,
        ],
      },
      target: { database: restoredName },
    }),
    { mode: 0o600 },
  );
  db = await connectPostgres({ connectionString: url(name, "business") });
  engine = new Engine(db);
  store = await fresh();
  host = await createLocalAuth(authOptions);
  await login();
  // Export uses a separate source owner's explicit authorized read, never an implicit cross-org lookup.
  const a = await api().store(
    { userId: fixture.other },
    fixture.cleaning,
    await logoFixture(),
    {
      version: 1,
      operationId: randomUUID(),
      expectedRevision: 0,
      display: "rectangle",
    },
  );
  sourceAsset = a.assetId;
  const read = await api().read(
    { userId: fixture.other },
    fixture.cleaning,
    a.assetId,
    a.assetRevision,
  );
  sample = await fictionalBrandedBundle(2, read.bytes);
  read.bytes.fill(0);
  await engine.publishConfig(
    { userId: fixture.owner },
    fixture.property,
    fixtureConfig(),
    1,
  );
});
afterAll(async () => {
  vi.restoreAllMocks();
  await store?.close();
  await host?.close();
  await db?.close();
  await admin?.end();
  if (cluster) {
    for (const n of [name, restoredName])
      await cluster.query('drop database if exists "' + n + '" with (force)');
    await cluster.end();
  }
  if (directory) await rm(directory, { recursive: true, force: true });
  sample?.image.fill(0);
});

it("keeps a complete-bundle signature separate from current durable authority and preserves private assets/publication", async () => {
  const publisher = testPublisher(),
    before = await counts(),
    business = await protectedRows(),
    state = await api().snapshot(actor(), fixture.property),
    history = await api().associations.history(actor(), fixture.property),
    attestation = await testBundleAttestation(sample.bundle, publisher),
    verified = await inspectAuthenticatedBrandedBundle(
      sample.bundle,
      { attestation },
      publisher.registry,
    );
  expect(verified.publisher.status).toBe("verified");
  expect(await counts()).toEqual(before);
  const cmd = command(await review());
  await admin.query(
    "delete from lms.memberships where organization_id=$1 and user_id=$2",
    [fixture.property, operator],
  );
  try {
    await expect(
      api().transfers.accept(resolve, fixture.property, sample.bundle, cmd),
    ).rejects.toMatchObject({ status: 403 });
  } finally {
    await admin.query("insert into lms.memberships values($1,$2,'admin')", [
      fixture.property,
      operator,
    ]);
  }
  await expect(
    api().transfers.accept(resolve, fixture.property, sample.bundle, {
      ...cmd,
      publisherAttestation: "not an authorization token",
    }),
  ).rejects.toThrow();
  expect(await counts()).toEqual(before);
  expect(await protectedRows()).toEqual(business);
  expect(await api().snapshot(actor(), fixture.property)).toEqual(state);
  expect(await api().associations.history(actor(), fixture.property)).toEqual(
    history,
  );
});
it("uses actual Better Auth and creates a new stored/unselected destination asset without source or publication changes", async () => {
  const before = await protectedRows(),
    source = await api().snapshot({ userId: fixture.other }, fixture.cleaning);
  const associations = await api().associations.history(
      actor(),
      fixture.property,
    ),
    state = await api().snapshot(actor(), fixture.property);
  const r = await review(),
    receipt = await api().transfers.accept(
      resolve,
      fixture.property,
      sample.bundle,
      command(r),
    );
  expect(receipt.review.actorId).toBe(operator);
  expect(receipt.review.instanceId).toBe(instance);
  expect(receipt.review.source.bundleSha256).toBe(hash(sample.bundle));
  expect(receipt.review.source.blueprintSha256).toBe(hash(sample.zip));
  expect(receipt.review.source.companionSha256).toBe(hash(sample.companion));
  expect(receipt.review.source.imageSha256).toBe(hash(sample.image));
  expect(receipt.asset.id).not.toBe(sourceAsset);
  expect(receipt.asset).toMatchObject({
    state: "stored",
    revision: 1,
    sha256: hash(sample.image),
  });
  expect((await api().snapshot(actor(), fixture.property)).selectedId).toBe(
    state.selectedId,
  );
  expect(await api().associations.history(actor(), fixture.property)).toEqual(
    associations,
  );
  expect(
    await api().snapshot({ userId: fixture.other }, fixture.cleaning),
  ).toEqual(source);
  expect(await protectedRows()).toEqual(before);
  const image = await api().read(
    actor(),
    fixture.property,
    receipt.asset.id,
    1,
  );
  expect(hash(image.bytes)).toBe(receipt.asset.sha256);
  image.bytes.fill(0);
  expect(
    await api().transfers.history(resolve, fixture.property),
  ).toContainEqual(receipt);
});
it("preserves exact map and image across independent application exit/restart and PostgreSQL reconnection", async () => {
  const env = {
    ...process.env,
    LMS_TEST_RUNTIME_URL: url(name, "business"),
    LMS_TEST_LOGO_TRUST: trustFile,
    LMS_TEST_AUTH_URL: url(name, "auth"),
    LMS_TEST_DATABASE: name,
    LMS_TEST_AUTH_SECRET: authOptions.secret,
  };
  const written = JSON.parse(
    (
      await exec(
        process.execPath,
        [
          "--import=tsx",
          "scripts/postgres/logo-transfer-probe.ts",
          "write",
          processOrg,
        ],
        { env },
      )
    ).stdout,
  );
  const reread = JSON.parse(
    (
      await exec(
        process.execPath,
        [
          "--import=tsx",
          "scripts/postgres/logo-transfer-probe.ts",
          "read",
          processOrg,
          written.receipt.operationId,
        ],
        { env },
      )
    ).stdout,
  );
  expect(reread).toEqual(written);
  await store!.close();
  store = await fresh();
  expect(await api().transfers.history(resolve, processOrg)).toEqual([
    written.receipt,
  ]);
  expect((await api().snapshot(actor(), processOrg)).selectedId).toBeNull();
});
it("refuses absent/expired sessions, revoked authority and foreign/unallowlisted destinations", async () => {
  const r = await review(),
    cmd = command(r),
    before = await counts();
  await expect(
    api().transfers.accept(
      async () => null,
      fixture.property,
      sample.bundle,
      cmd,
    ),
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    api().transfers.accept(
      resolve,
      fixture.cleaning,
      sample.bundle,
      command({ ...r, organizationId: fixture.cleaning }),
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    api().transfers.review(resolve, randomUUID(), sample.bundle),
  ).rejects.toMatchObject({ status: 403 });
  await admin.query(
    "delete from lms.memberships where organization_id=$1 and user_id=$2",
    [fixture.property, operator],
  );
  await expect(
    api().transfers.accept(resolve, fixture.property, sample.bundle, cmd),
  ).rejects.toMatchObject({ status: 403 });
  await admin.query("insert into lms.memberships values($1,$2,'admin')", [
    fixture.property,
    operator,
  ]);
  const identity = await resolve();
  await admin.query(
    "update lms_identity.session set \"expiresAt\"=clock_timestamp()-interval '1 second' where id=$1",
    [identity!.sessionId],
  );
  await expect(
    api().transfers.accept(resolve, fixture.property, sample.bundle, cmd),
  ).rejects.toMatchObject({ status: 401 });
  await login();
  expect(await counts()).toEqual(before);
});
it("rejects session revocation or membership removal during native decoding using current commit guards", async () => {
  const decode = sanitizer.sanitizeLogo,
    r = await review(),
    before = await counts();
  let spy = vi
    .spyOn(sanitizer, "sanitizeLogo")
    .mockImplementationOnce(async (bytes) => {
      const clean = await decode(bytes),
        identity = await resolve();
      await admin.query("delete from lms_identity.session where id=$1", [
        identity!.sessionId,
      ]);
      return clean;
    });
  try {
    await expect(
      api().transfers.accept(
        resolve,
        fixture.property,
        sample.bundle,
        command(r),
      ),
    ).rejects.toMatchObject({ status: 401 });
  } finally {
    spy.mockRestore();
    await login();
  }
  spy = vi
    .spyOn(sanitizer, "sanitizeLogo")
    .mockImplementationOnce(async (bytes) => {
      const clean = await decode(bytes);
      await admin.query(
        "delete from lms.memberships where organization_id=$1 and user_id=$2",
        [fixture.property, operator],
      );
      return clean;
    });
  try {
    await expect(
      api().transfers.accept(
        resolve,
        fixture.property,
        sample.bundle,
        command(r),
      ),
    ).rejects.toMatchObject({ status: 403 });
  } finally {
    spy.mockRestore();
    await admin.query("insert into lms.memberships values($1,$2,'admin')", [
      fixture.property,
      operator,
    ]);
  }
  expect(await counts()).toEqual(before);
});
it("returns one asset/receipt for exact concurrent retries and refuses conflicting or legacy-operation reuse", async () => {
  const cmd = command(await review()),
    before = await counts();
  const results = await Promise.all([
    api().transfers.accept(resolve, fixture.property, sample.bundle, cmd),
    api().transfers.accept(resolve, fixture.property, sample.bundle, cmd),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect((await counts()).assets).toBe(before.assets + 1);
  const decoder = vi.spyOn(sanitizer, "sanitizeLogo");
  expect(
    await api().transfers.accept(resolve, fixture.property, sample.bundle, cmd),
  ).toEqual(results[0]);
  expect(decoder).not.toHaveBeenCalled();
  decoder.mockRestore();
  await expect(
    api().transfers.accept(resolve, fixture.property, sample.bundle, {
      ...cmd,
      review: {
        ...(cmd.review as object),
        reviewedAt: "2020-01-01T00:00:00.000Z",
        expiresAt: "2020-01-01T00:10:00.000Z",
      },
    }),
  ).rejects.toMatchObject({ status: 409 });
  const state = await api().snapshot(actor(), fixture.property),
    op = randomUUID();
  await api().store(actor(), fixture.property, sample.image, {
    version: 1,
    operationId: op,
    expectedRevision: state.revision,
    display: "rectangle",
  });
  await expect(
    api().transfers.accept(resolve, fixture.property, sample.bundle, {
      ...command(await review()),
      operationId: op,
    }),
  ).rejects.toMatchObject({ status: 409 });
});
it("refuses stale publication, asset selection and association revisions without implicit rebinding", async () => {
  let r = await review();
  const current = (await engine.snapshot(actor(), fixture.property)).config;
  await engine.publishConfig(
    actor(),
    fixture.property,
    { ...current.document, name: "Fictional reviewed destination" },
    current.revision,
  );
  await expect(
    api().transfers.accept(
      resolve,
      fixture.property,
      sample.bundle,
      command(r),
    ),
  ).rejects.toMatchObject({ status: 409 });
  r = await review();
  const a = (await api().snapshot(actor(), fixture.property)).assets.find(
    (a) => a.state === "stored",
  )!;
  await change(a.id, "select");
  await expect(
    api().transfers.accept(
      resolve,
      fixture.property,
      sample.bundle,
      command(r),
    ),
  ).rejects.toMatchObject({ status: 409 });
  r = await review();
  const associationReview = await api().associations.review(
    actor(),
    fixture.property,
    { mode: "image", display: "rectangle", historyRevision: null },
  );
  const associated = await api().associations.apply(actor(), fixture.property, {
    format: "lms-private-logo-association-command",
    version: 1,
    operationId: randomUUID(),
    review: associationReview,
    confirmed: true,
  });
  await expect(
    api().transfers.accept(
      resolve,
      fixture.property,
      sample.bundle,
      command(r),
    ),
  ).rejects.toMatchObject({ status: 409 });
  const receipt = await accept();
  expect(
    (await api().associations.inspect(actor(), fixture.property)).association,
  ).toEqual(associated);
  expect((await api().snapshot(actor(), fixture.property)).selectedId).toBe(
    a.id,
  );
  expect(receipt.asset.id).not.toBe(a.id);
});
it("allows one competing store/transfer and refuses a repeatable-read snapshot predating the first asset cursor", async () => {
  const r = await review(),
    s = await api().snapshot(actor(), fixture.property);
  const outcomes = await Promise.allSettled([
    api().transfers.accept(
      resolve,
      fixture.property,
      sample.bundle,
      command(r),
    ),
    api().store(actor(), fixture.property, sample.image, {
      version: 1,
      operationId: randomUUID(),
      expectedRevision: s.revision,
      display: "square",
    }),
  ]);
  expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((x) => x.status === "rejected")).toHaveLength(1);
  // Obtain the review in its normal short transaction. Holding its organization lock
  // inside the old snapshot would prevent the competing first store instead of testing it.
  const rawReview = await review(damageOrg),
    verified = await resolve();
  const c = new Client({ connectionString: url(name, "business") });
  await c.connect();
  try {
    await c.query(
      "begin isolation level repeatable read;set local role lms_app",
    );
    await c.query("select set_config('lms.user_id',$1,true)", [operator]);
    expect(
      (
        await c.query(
          "select * from lms.logo_asset_states where organization_id=$1",
          [damageOrg],
        )
      ).rows,
    ).toEqual([]);
    await accept(damageOrg);
    await expect(
      c.query("select lms.logo_transfer_operation($1,$2,$3,$4,$5)", [
        damageOrg,
        instance,
        verified!.sessionId,
        command(rawReview),
        sample.image,
      ]),
    ).rejects.toMatchObject({ code: "40001" });
  } finally {
    await c.query("rollback");
    await c.end();
  }
});
it("checks exact nested bytes and re-decodes even a correctly checksummed hostile image", async () => {
  const before = await counts(),
    r = await review(),
    bad = new Uint8Array(sample.bundle);
  bad[100] ^= 1;
  await expect(
    api().transfers.accept(resolve, fixture.property, bad, command(r)),
  ).rejects.toMatchObject({ status: 400 });
  const data = Buffer.alloc(8);
  data.writeUInt32BE(2);
  const kind = Buffer.from("acTL"),
    chunk = Buffer.alloc(20);
  chunk.writeUInt32BE(8);
  kind.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([kind, data])), 16);
  const animated = Buffer.concat([
    sample.image.subarray(0, 33),
    chunk,
    sample.image.subarray(33),
  ]);
  const companion = await createLogoCompanion(animated, {
    width: 128,
    height: 64,
    display: "rectangle",
  });
  const bundle = await createBrandedBlueprintBundle(sample.zip, companion);
  const reviewed = await api().transfers.review(
    resolve,
    fixture.property,
    bundle,
  );
  await expect(
    api().transfers.accept(
      resolve,
      fixture.property,
      bundle,
      command(reviewed.review),
    ),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    api().transfers.accept(resolve, fixture.property, sample.bundle, {
      ...command(r),
      review: { ...r, sanitizer: "unknown-profile" },
    }),
  ).rejects.toThrow();
  expect(await counts()).toEqual(before);
});
it("rolls back partial writes and resolves a lost committed response only through the exact retry", async () => {
  const r = await review(),
    cmd = command(r),
    before = await counts();
  const state = await api().snapshot(actor(), fixture.property);
  await admin.query(
    "create function lms_private.test_transfer_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic disk failure' using errcode='53100';end;$$;create trigger test_transfer_failure before insert on lms.logo_transfer_receipts for each row execute function lms_private.test_transfer_failure()",
  );
  try {
    await expect(
      api().transfers.accept(resolve, fixture.property, sample.bundle, cmd),
    ).rejects.toMatchObject({ status: 503 });
  } finally {
    await admin.query(
      "drop trigger test_transfer_failure on lms.logo_transfer_receipts;drop function lms_private.test_transfer_failure()",
    );
  }
  expect(await counts()).toEqual(before);
  expect(await api().snapshot(actor(), fixture.property)).toEqual(state);
  // Actual commit followed by a simulated loss of the caller's result, not a physical power-cut claim.
  const lostReply = async () => {
    await api().transfers.accept(resolve, fixture.property, sample.bundle, cmd);
    throw new Error("synthetic transport interruption after commit");
  };
  await expect(lostReply()).rejects.toThrow("synthetic transport interruption");
  const recovered = await api().transfers.accept(
    resolve,
    fixture.property,
    sample.bundle,
    cmd,
  );
  expect(recovered.operationId).toBe(cmd.operationId);
  expect((await counts()).assets).toBe(before.assets + 1);
});
it("retains count/storage quotas without refunds after repeated imports and retirement", async () => {
  for (let i = 0; i < 16; i++) await accept(quotaOrg);
  const before = await counts();
  await expect(review(quotaOrg)).rejects.toMatchObject({ status: 409 });
  const state = await api().snapshot(actor(), quotaOrg),
    a = state.assets[0];
  await change(a.id, "release", quotaOrg);
  await change(a.id, "retire", quotaOrg);
  await expect(review(quotaOrg)).rejects.toMatchObject({ status: 409 });
  expect((await counts()).assets).toBe(before.assets);
  expect(await api().transfers.history(resolve, quotaOrg)).toHaveLength(16);
});
it("does not upgrade legacy configuration or treat immutable history as current image availability", async () => {
  const old = (await engine.snapshot(actor(), legacyOrg)).config,
    r = await accept(legacyOrg);
  expect((await engine.snapshot(actor(), legacyOrg)).config).toEqual(old);
  expect(old.document.schemaVersion).toBe(1);
  await expect(
    api().associations.review(actor(), legacyOrg, {
      mode: "image",
      display: "rectangle",
      historyRevision: null,
    }),
  ).rejects.toThrow();
  const history = await api().transfers.history(resolve, legacyOrg);
  await change(r.asset.id, "block", legacyOrg);
  await expect(
    api().read(actor(), legacyOrg, r.asset.id, 2),
  ).rejects.toMatchObject({ status: 403 });
  expect(await api().transfers.history(resolve, legacyOrg)).toEqual(history);
  expect(
    (
      await engine.asUser({ userId: fixture.other }, (tx) =>
        tx.query("select * from lms.logo_transfer_receipts"),
      )
    ).rows,
  ).toEqual([]);
  for (const sql of [
    "delete from lms.logo_transfer_receipts",
    "update lms.logo_transfer_receipts set result='{}'",
    "truncate lms.logo_transfer_receipts",
  ])
    await expect(
      engine.asUser(actor(), (tx) => tx.exec(sql)),
    ).rejects.toMatchObject({ code: "42501" });
  await expect(
    admin.query("delete from lms.logo_transfer_receipts"),
  ).rejects.toMatchObject({ code: "23514" });
});
it("serializes a competing selection against transfer and refuses expired first-use reviews", async () => {
  const r = await review(),
    state = await api().snapshot(actor(), fixture.property);
  const a = state.assets.find((a) => a.state === "stored")!;
  const results = await Promise.allSettled([
    api().transfers.accept(
      resolve,
      fixture.property,
      sample.bundle,
      command(r),
    ),
    api().change(actor(), fixture.property, {
      version: 1,
      operationId: randomUUID(),
      expectedRevision: state.revision,
      assetId: a.id,
      assetRevision: a.revision,
      action: "select",
    }),
  ]);
  expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((x) => x.status === "rejected")).toHaveLength(1);
  const current = await review();
  await expect(
    api().transfers.accept(
      resolve,
      fixture.property,
      sample.bundle,
      command({
        ...current,
        reviewedAt: "2020-01-01T00:00:00.000Z",
        expiresAt: "2020-01-01T00:10:00.000Z",
      }),
    ),
  ).rejects.toMatchObject({ status: 409 });
});
it("refuses damaged/missing mapped images and requires independent selection and association for display", async () => {
  const r = (await api().transfers.history(resolve, damageOrg))[0];
  const history = await api().transfers.history(resolve, damageOrg),
    original = Buffer.from(sample.image);
  const damaged = Buffer.from(sample.image);
  damaged[damaged.length - 1] ^= 1;
  await admin.query("alter table lms.logo_assets disable trigger user");
  try {
    await admin.query(
      "update lms.logo_assets set content=$1,sha256=$2 where organization_id=$3 and id=$4",
      [damaged, hash(damaged), damageOrg, r.asset.id],
    );
    await expect(
      api().read(actor(), damageOrg, r.asset.id, 1),
    ).rejects.toThrow();
  } finally {
    await admin.query(
      "update lms.logo_assets set content=$1,sha256=$2 where organization_id=$3 and id=$4",
      [original, hash(original), damageOrg, r.asset.id],
    );
    await admin.query("alter table lms.logo_assets enable trigger user");
    original.fill(0);
    damaged.fill(0);
  }
  await expect(
    api().read(actor(), damageOrg, randomUUID(), 1),
  ).rejects.toMatchObject({ status: 403 });
  expect(await api().transfers.history(resolve, damageOrg)).toEqual(history);
  await change(r.asset.id, "select", damageOrg);
  expect((await api().associations.inspect(actor(), damageOrg)).status).toBe(
    "builtin",
  );
  const review = await api().associations.review(actor(), damageOrg, {
    mode: "image",
    display: "rectangle",
    historyRevision: null,
  });
  await api().associations.apply(actor(), damageOrg, {
    format: "lms-private-logo-association-command",
    version: 1,
    operationId: randomUUID(),
    review,
    confirmed: true,
  });
  const read = await api().associations.read(actor(), damageOrg);
  expect(hash(read.logo!.bytes)).toBe(r.asset.sha256);
  read.logo!.bytes.fill(0);
  expect(await api().transfers.history(resolve, damageOrg)).toEqual(history);
});
it("preserves exact private rows and source data in a native quarantined restore while activation refuses", async () => {
  const queries = [
    "select * from lms.logo_transfer_receipts order by organization_id,operation_id",
    "select organization_id,id,revision,state,bytes,sha256,encode(sha256(content),'hex') actual from lms.logo_assets order by organization_id,id",
    "select * from lms.logo_asset_history order by organization_id,asset_id,revision",
    "select * from lms.logo_asset_receipts order by organization_id,operation_id",
    "select * from lms.logo_associations order by organization_id,revision",
  ];
  const expected = await Promise.all(
    queries.map(async (q) => (await admin.query(q)).rows),
  );
  const before = await protectedRows();
  await store!.close();
  store = undefined;
  await host!.close();
  host = undefined;
  await db!.close();
  db = undefined;
  await admin.end();
  const result = await nativeReadiness({
    mode: "rehearse",
    trustFile,
    sourceUrl: url(),
    targetUrl: url(restoredName),
    workDirectory: directory,
    confirmation: nativeRehearsalConfirmation,
    binDirectory: process.env.LMS_PG_BIN,
  });
  expect(result.result).toBe("rehearsal-complete");
  expect(result.backupReadiness).toBe("verified-fictional-round-trip");
  expect(result.versions.source.migration).toBe(18);
  for (const sensitive of [
    sourceAsset,
    hash(sample.image),
    sample.image.toString("base64"),
    "Durable Fictional Customer",
    operator,
  ])
    expect(JSON.stringify(result)).not.toContain(sensitive);
  const copy = new Client({ connectionString: url(restoredName) });
  await copy.connect();
  try {
    for (let i = 0; i < queries.length; i++)
      expect((await copy.query(queries[i])).rows).toEqual(expected[i]);
    expect(
      (await copy.query("select blocked from lms_control.state")).rows[0]
        .blocked,
    ).toBe(true);
    expect(
      (await copy.query("select count(*)::int n from lms_identity.session"))
        .rows[0].n,
    ).toBe(0);
    await copy.query("begin;set local role lms_app");
    await copy.query("select set_config('lms.user_id',$1,true)", [operator]);
    await expect(
      copy.query("select lms.logo_transfer_history($1,$2,$3)", [
        fixture.property,
        instance,
        randomUUID(),
      ]),
    ).rejects.toMatchObject({ code: "55000" });
    await copy.query("rollback");
  } finally {
    await copy.end();
  }
  await expect(
    connectPostgres({ connectionString: url(restoredName, "business") }),
  ).rejects.toThrow(/blocked|quarantine/i);
  await expect(
    openPrivateLogoStore({
      databaseUrl: url(restoredName, "business"),
      trustFile,
    }),
  ).rejects.toThrow();
  admin = new Client({ connectionString: url() });
  await admin.connect();
  for (let i = 0; i < queries.length; i++)
    expect((await admin.query(queries[i])).rows).toEqual(expected[i]);
  expect(await protectedRows()).toEqual(before);
  store = await fresh();
  host = await createLocalAuth(authOptions);
  await login();
  expect(
    (await api().transfers.history(resolve, fixture.property)).length,
  ).toBeGreaterThan(0);
});
