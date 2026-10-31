import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { OfflineRecovery } from "../../src/server/recovery/offline";
import { canonical, digest } from "../../src/server/recovery/trust";
import {
  createLocalAuth,
  provisionFictionalAccount,
} from "../../src/server/auth/host";
import { passwordCodec } from "../../src/server/auth/password";
import { replaceCredential } from "../../src/server/auth/lifecycle";
import {
  migrate,
  loadMigrations,
  provisionRuntime,
  provisionAuthRuntime,
} from "../../src/server/postgres/migrations";
import { connectPostgres } from "../../src/server/postgres/adapter";
import {
  backupDatabase,
  restoreDatabase,
} from "../../src/server/postgres/backup";
import { localTarget } from "../../src/server/postgres/targets";
import { bootstrapFictionalWorkspace } from "../../src/server/access/bootstrap";
import { Engine } from "../../src/core/engine";
import { AccessService } from "../../src/core/access";
const raw = process.env.LMS_TEST_ADMIN_URL;
if (!raw)
  throw new Error(
    "LMS_TEST_ADMIN_URL is required. Recovery tests never silently skip.",
  );
const controlName = decodeURIComponent(new URL(raw).pathname.slice(1)),
  control = localTarget(raw, controlName);
if (!controlName.startsWith("lms_test_"))
  throw new Error("Use a disposable lms_test_* control database.");
const suffix = randomBytes(5).toString("hex"),
  name = "lms_test_recovery_" + suffix,
  oldRestore = "lms_restore_old_" + suffix,
  newRestore = "lms_restore_new_" + suffix;
function url(database: string, role = "admin") {
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
const options = {
    databaseUrl: url(name, "auth"),
    databaseName: name,
    origin: "http://127.0.0.1:3200",
    secret: randomBytes(32).toString("hex"),
  },
  original = "fictional_original_offline_password",
  replacement = "fictional_recovered_offline_password";
const verifierKey = generateKeyPairSync("ed25519"),
  approverKey = generateKeyPairSync("ed25519"),
  verifierId = randomUUID(),
  approverId = randomUUID(),
  evidenceId = randomUUID();
let cluster: Client,
  admin: Client,
  owner: string,
  other: string,
  org: string,
  otherOrg: string,
  ownerHash: string,
  directory: string,
  trustFile: string,
  recovery: OfflineRecovery,
  registry: any,
  registryDigest: string;
let host: Awaited<ReturnType<typeof createLocalAuth>> | undefined,
  db: Awaited<ReturnType<typeof connectPostgres>> | undefined;
async function stop() {
  await host?.close();
  host = undefined;
  await db?.close();
  db = undefined;
}
async function snapshot() {
  const result: Record<string, unknown> = {};
  for (const table of [
    "organizations",
    "users",
    "memberships",
    "config_revisions",
    "records",
    "audit_events",
    "access_versions",
    "access_receipts",
  ])
    result[table] = (
      await admin.query(
        `select to_jsonb(t) as row from lms.${table} t order by to_jsonb(t)::text`,
      )
    ).rows;
  return result;
}
function service(database = name, file = trustFile, role = "admin") {
  return new OfflineRecovery({
    databaseUrl: url(database, role),
    databaseName: database,
    trustFile: file,
  });
}
async function open(subjectId = owner, id = evidenceId) {
  return recovery.open({
    subjectId,
    evidenceId: id,
    confirmation: "OPEN OFFLINE RECOVERY AND BLOCK ACTIVATION",
  });
}
async function attest(
  caseId: string,
  stage: "verification" | "approval",
  operatorId = stage === "verification" ? verifierId : approverId,
  key = stage === "verification"
    ? verifierKey.privateKey
    : approverKey.privateKey,
) {
  const review = await recovery.review({ caseId, stage, operatorId });
  const signature = sign(null, Buffer.from(review.message), key).toString(
    "base64",
  );
  const input = {
    caseId,
    operatorId,
    signature,
    confirmation: "I VERIFIED THE OFFLINE RECOVERY REVIEW",
  };
  await recovery.attest(stage, input);
  return input;
}
async function approved() {
  const c = await open();
  await attest(c.caseId, "verification");
  await attest(c.caseId, "approval");
  return c;
}
function apply(caseId: string, password = replacement) {
  return recovery.apply({
    caseId,
    newPassword: password,
    confirmation: "RECOVER FICTIONAL ACCOUNT AND REVOKE ALL SESSIONS",
  });
}
async function check(password: string, database = name) {
  return service(database).verifyPassword({
    subjectId: owner,
    password,
    confirmation: "VERIFY OFFLINE WITHOUT ACTIVATION",
  });
}
async function eventCount(action: string) {
  return (
    await admin.query(
      "select * from lms_private.recovery_events where action=$1",
      [action],
    )
  ).rows.length;
}
async function login(
  instance: Awaited<ReturnType<typeof createLocalAuth>>,
  email = "owner@example.test",
  password = original,
) {
  const response = await instance.handle(
    new Request(options.origin + "/api/local-auth/sign-in/email", {
      method: "POST",
      headers: { origin: options.origin, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );
  expect(response.status).toBe(200);
  return new Headers({
    cookie: response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  });
}
beforeAll(async () => {
  cluster = new Client({ connectionString: control.toString() });
  await cluster.connect();
  for (const n of [name, oldRestore, newRestore])
    await cluster.query(`create database "${n}"`);
  admin = new Client({ connectionString: url(name) });
  await admin.connect();
  await migrate(admin);
  await provisionRuntime(admin, url(name, "business"));
  await provisionAuthRuntime(admin, url(name, "auth"));
  owner = (
    await provisionFictionalAccount(options, {
      name: "Fictional owner",
      email: "owner@example.test",
      password: original,
    })
  ).userId;
  other = (
    await provisionFictionalAccount(options, {
      name: "Fictional second owner",
      email: "other@example.test",
      password: original,
    })
  ).userId;
  ownerHash = (
    await admin.query(
      'select password from lms_identity.account where "userId"=$1',
      [owner],
    )
  ).rows[0].password;
  directory = await mkdtemp(path.join(os.tmpdir(), "lms-offline-recovery-"));
  trustFile = path.join(directory, "prior-trust.json");
  registry = {
    version: 1,
    id: randomUUID(),
    createdAt: "2024-01-01T00:00:00.000Z",
    operators: [
      {
        id: verifierId,
        personId: randomUUID(),
        enrolledAt: "2020-01-01T00:00:00.000Z",
        publicKey: verifierKey.publicKey
          .export({ type: "spki", format: "pem" })
          .toString(),
        capabilities: ["verify", "approve"],
      },
      {
        id: approverId,
        personId: randomUUID(),
        enrolledAt: "2020-01-01T00:00:00.000Z",
        publicKey: approverKey.publicKey
          .export({ type: "spki", format: "pem" })
          .toString(),
        capabilities: ["verify", "approve"],
      },
    ],
    evidence: [
      {
        id: evidenceId,
        subjectId: owner,
        establishedAt: "2023-01-01T00:00:00.000Z",
        kind: "offline-identity-record",
        recordDigest: digest(
          "fictional prior independently checked enrollment record",
        ),
      },
    ],
  };
  await writeFile(trustFile, JSON.stringify(registry), { mode: 0o600 });
  registryDigest = digest(canonical(registry));
  recovery = service();
  await recovery.enroll({
    confirmation: "REGISTER PRE-EXISTING OFFLINE TRUST",
  });
});
beforeEach(async () => {
  await stop();
  // Synthetic fixtures alone adjust clocks/unquarantine. No production command can do this.
  await admin.query(
    "update lms_control.state set blocked=false,reason=null;truncate lms.organizations,lms.users cascade;truncate lms_private.recovery_cases,lms_private.recovery_events;delete from lms_identity.session;delete from lms_identity.rate_limit",
  );
  await admin.query(
    'update lms_identity.account set password=$1 where "userId"=$2',
    [ownerHash, owner],
  );
  await admin.query("truncate lms_identity.credential_events");
  await admin.query(
    "update lms_private.recovery_trust set trusted_at=clock_timestamp()-interval '25 hours' where digest=$1",
    [registryDigest],
  );
  await writeFile(trustFile, JSON.stringify(registry), { mode: 0o600 });
  org = (
    await bootstrapFictionalWorkspace(admin, {
      ownerId: owner,
      operationId: randomUUID(),
      preset: "property",
      name: "Fictional recovery property",
      confirmation: "CREATE FICTIONAL WORKSPACE",
    })
  ).organizationId;
  otherOrg = (
    await bootstrapFictionalWorkspace(admin, {
      ownerId: other,
      operationId: randomUUID(),
      preset: "cleaning",
      name: "Fictional independent cleaning",
      confirmation: "CREATE FICTIONAL WORKSPACE",
    })
  ).organizationId;
  db = await connectPostgres({ connectionString: url(name, "business") });
  const engine = new Engine(db);
  await engine.saveRecord({ userId: owner }, org, "customers", {
    name: "Fictional preserved customer",
  });
  await engine.saveRecord({ userId: other }, otherOrg, "customers", {
    name: "Fictional unrelated customer",
  });
  await db.close();
  db = undefined;
});
afterAll(async () => {
  await stop();
  await admin?.end();
  if (cluster) {
    for (const n of [name, oldRestore, newRestore])
      await cluster.query(`drop database if exists "${n}" with (force)`);
    await cluster.end();
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});
describe("controlled offline recovery with independent signed evidence", () => {
  it("requires prior trust, a cooling-off period and the correct pre-established subject evidence", async () => {
    await expect(open(owner, randomUUID())).rejects.toMatchObject({
      status: 403,
    });
    await expect(open(other, evidenceId)).rejects.toMatchObject({
      status: 403,
    });
    await admin.query(
      "update lms_private.recovery_trust set trusted_at=clock_timestamp() where digest=$1",
      [registryDigest],
    );
    await expect(open()).rejects.toMatchObject({ status: 403 });
    expect(
      (await admin.query("select * from lms_private.recovery_cases")).rows,
    ).toHaveLength(0);
    expect(await eventCount("rejected")).toBe(3);
    await expect(
      recovery.open({
        subjectId: owner,
        evidenceId,
        confirmation: "OPEN OFFLINE RECOVERY AND BLOCK ACTIVATION",
        email: "owner@example.test",
        verified: true,
      }),
    ).rejects.toThrow();
  });
  it("refuses recovery/enrollment while any identity or business runtime is attached", async () => {
    host = await createLocalAuth(options);
    await expect(open()).rejects.toMatchObject({ status: 423 });
    await stop();
    db = await connectPostgres({
      connectionString: url(name, "business"),
      maxConnections: 1,
    });
    await expect(open()).rejects.toMatchObject({ status: 423 });
    await stop();
    expect((await open()).requiredIndependentOperators).toBe(2);
  });
  it("recovers a sole owner only after two distinct signatures, revokes only its sessions/reviews and preserves all business bytes", async () => {
    host = await createLocalAuth(options);
    db = await connectPostgres({ connectionString: url(name, "business") });
    const engine = new Engine(db),
      access = new AccessService(engine, host.identity);
    const actor = await login(host),
      otherActor = await login(host, "other@example.test");
    await engine.saveRecord({ userId: owner }, org, "tasks", {
      title: "Retained historical task",
      status: "Open",
    });
    const review = await access.prepare(actor, {
      organizationId: org,
      targetUserId: other,
      action: "set-role",
      role: "staff",
      revision: 0,
      reason: "Pending fictional access review",
    });
    const otherSession = await host.identity(otherActor);
    await stop();
    const before = await snapshot();
    const c = await approved();
    expect(c.organizations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ organization_id: org, role: "owner" }),
      ]),
    );
    expect(await apply(c.caseId)).toMatchObject({
      status: "completed",
      activationBlocked: true,
    });
    expect(await snapshot()).toEqual(before);
    expect(await check(original)).toMatchObject({ valid: false });
    expect(await check(replacement)).toEqual({
      valid: true,
      activationBlocked: true,
    });
    expect(
      (
        await admin.query(
          'select * from lms_identity.session where "userId"=$1',
          [owner],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await admin.query("select id from lms_identity.session where id=$1", [
          otherSession!.sessionId,
        ])
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await admin.query(
          "select * from lms_private.membership_reviews where id=$1",
          [review.reviewId],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await admin.query(
          "select * from lms_identity.credential_events where operation_id=$1",
          [c.caseId],
        )
      ).rows,
    ).toHaveLength(1);
    expect(await eventCount("completed")).toBe(1);
    const audit = JSON.stringify(
      (await admin.query("select * from lms_private.recovery_events")).rows,
    );
    expect(audit).not.toContain(original);
    expect(audit).not.toContain(replacement);
    expect(audit).not.toMatch(/privateKey|password|signature|session/);
    await expect(createLocalAuth(options)).rejects.toThrow(
      /activation blocked/i,
    );
    await expect(
      connectPostgres({ connectionString: url(name, "business") }),
    ).rejects.toThrow(/activation blocked/i);
  });
  it("rejects forged evidence, another case signature, self approval and absent approval without changing credentials", async () => {
    const c = await open(),
      d = await open();
    const review = await recovery.review({
      caseId: c.caseId,
      stage: "verification",
      operatorId: verifierId,
    });
    const signature = sign(
      null,
      Buffer.from(review.message),
      verifierKey.privateKey,
    ).toString("base64");
    const proof = {
      caseId: d.caseId,
      operatorId: verifierId,
      signature,
      confirmation: "I VERIFIED THE OFFLINE RECOVERY REVIEW",
    };
    await expect(recovery.attest("verification", proof)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      recovery.attest("verification", {
        ...proof,
        caseId: c.caseId,
        signature: Buffer.alloc(64).toString("base64"),
      }),
    ).rejects.toMatchObject({ status: 403 });
    await attest(c.caseId, "verification");
    await expect(apply(c.caseId)).rejects.toMatchObject({ status: 409 });
    await expect(
      recovery.review({
        caseId: c.caseId,
        stage: "approval",
        operatorId: verifierId,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await check(original)).toMatchObject({ valid: true });
  });
  it("rejects expired cases and expired approvals while retaining the activation blocker", async () => {
    const c = await open();
    await admin.query(
      "update lms_private.recovery_cases set expires_at=clock_timestamp()-interval '1 second' where id=$1",
      [c.caseId],
    );
    await expect(
      recovery.review({
        caseId: c.caseId,
        stage: "verification",
        operatorId: verifierId,
      }),
    ).rejects.toMatchObject({ status: 410 });
    const d = await approved();
    await admin.query(
      "update lms_private.recovery_cases set approved_at=clock_timestamp()-interval '6 minutes' where id=$1",
      [d.caseId],
    );
    await expect(apply(d.caseId)).rejects.toMatchObject({ status: 410 });
    expect(await check(original)).toMatchObject({
      valid: true,
      activationBlocked: true,
    });
  });
  it("rejects duplicate recovery and competing approved cases after the credential version changes", async () => {
    const a = await approved(),
      b = await approved();
    await expect(apply(a.caseId, original)).rejects.toMatchObject({
      status: 400,
    });
    await apply(a.caseId);
    await expect(apply(a.caseId)).rejects.toMatchObject({ status: 409 });
    await expect(apply(b.caseId)).rejects.toMatchObject({ status: 409 });
    expect(await eventCount("completed")).toBe(1);
  });
  it("serializes concurrent recovery attempts and never changes credentials twice", async () => {
    const c = await approved();
    const results = await Promise.allSettled([
      apply(c.caseId),
      service().apply({
        caseId: c.caseId,
        newPassword: replacement + "_other",
        confirmation: "RECOVER FICTIONAL ACCOUNT AND REVOKE ALL SESSIONS",
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect([409, 423]).toContain(
      results.find((r) => r.status === "rejected")?.reason.status,
    );
    expect(await eventCount("completed")).toBe(1);
  });
  it("refuses an online password-change race and detects changed credentials or memberships at final application", async () => {
    host = await createLocalAuth(options);
    const actor = await login(host);
    const change = host.changePassword(actor, {
      operationId: randomUUID(),
      currentPassword: original,
      newPassword: replacement,
      confirmation: "CHANGE PASSWORD AND SIGN OUT",
    });
    await expect(open()).rejects.toMatchObject({ status: 423 });
    await change;
    await stop();
    const c = await approved();
    const hash = await passwordCodec.hash(original + "_later");
    await admin.query("begin");
    const a = (
      await admin.query(
        'select id from lms_identity.account where "userId"=$1 for update',
        [owner],
      )
    ).rows[0];
    await replaceCredential(admin, a.id, owner, hash, randomUUID());
    await admin.query("commit");
    await expect(apply(c.caseId)).rejects.toMatchObject({ status: 409 });
    const d = await approved();
    await admin.query(
      "update lms.access_versions set revision=revision+1 where organization_id=$1",
      [org],
    );
    await expect(apply(d.caseId)).rejects.toMatchObject({ status: 409 });
  });
  it("rolls back credentials, session revocation, approvals and case completion on an audit failure", async () => {
    const sid = randomUUID();
    await admin.query(
      'insert into lms_identity.session(id,token,"userId","expiresAt") values($1,$2,$3,clock_timestamp()+interval \'1 hour\')',
      [sid, randomUUID(), owner],
    );
    await admin.query(
      "insert into lms_private.membership_reviews(organization_id,actor_id,session_id,target_id,action,next_role,expected_revision,reason) values($1,$2,$3,$4,'set-role','staff',0,'Retain on rollback')",
      [org, owner, sid, other],
    );
    const c = await approved(),
      before = await snapshot();
    await admin.query(
      "create function lms_private.fail_recovery_audit() returns trigger language plpgsql as $$ begin if new.action='completed' then raise exception 'Synthetic recovery audit failure'; end if; return new; end; $$;create trigger synthetic_recovery_failure before insert on lms_private.recovery_events for each row execute function lms_private.fail_recovery_audit()",
    );
    try {
      await expect(apply(c.caseId)).rejects.toThrow(
        "Synthetic recovery audit failure",
      );
    } finally {
      await admin.query(
        "drop trigger synthetic_recovery_failure on lms_private.recovery_events;drop function lms_private.fail_recovery_audit()",
      );
    }
    expect(await snapshot()).toEqual(before);
    expect(await check(original)).toMatchObject({ valid: true });
    expect(
      (
        await admin.query("select * from lms_identity.session where id=$1", [
          sid,
        ])
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await admin.query(
          "select * from lms_private.membership_reviews where session_id=$1",
          [sid],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await admin.query(
          "select status from lms_private.recovery_cases where id=$1",
          [c.caseId],
        )
      ).rows[0].status,
    ).toBe("approved");
    expect(await eventCount("completed")).toBe(0);
    expect(await eventCount("rejected")).toBe(1);
  });
  it("denies ordinary runtime recovery authority and does not derive authority from organization ownership", async () => {
    await expect(
      service(name, trustFile, "auth").enroll({
        confirmation: "REGISTER PRE-EXISTING OFFLINE TRUST",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service(name, trustFile, "business").open({
        subjectId: owner,
        evidenceId,
        confirmation: "OPEN OFFLINE RECOVERY AND BLOCK ACTIVATION",
      }),
    ).rejects.toMatchObject({ status: 403 });
    const client = new Client({ connectionString: url(name, "auth") });
    await client.connect();
    try {
      await client.query("set role lms_auth_service");
      for (const sql of [
        "select * from lms_private.recovery_cases",
        "delete from lms_private.recovery_events",
        "update lms_control.state set blocked=false",
        "update lms_identity.credential_versions set version=gen_random_uuid()",
      ])
        await expect(client.query(sql)).rejects.toMatchObject({
          code: "42501",
        });
    } finally {
      await client.end();
    }
  });
  it("keeps older restored passwords inert, removes pending recovery proofs and retains secret-free history", async () => {
    const oldFile = path.join(directory, "before-recovery.dump"),
      newFile = path.join(directory, "after-recovery.dump");
    await backupDatabase(url(name), name, oldFile, process.env.LMS_PG_BIN);
    const c = await approved();
    await apply(c.caseId);
    await backupDatabase(url(name), name, newFile, process.env.LMS_PG_BIN);
    for (const [target, file, validPassword] of [
      [oldRestore, oldFile, original],
      [newRestore, newFile, replacement],
    ]) {
      await restoreDatabase(url(target), target, file, process.env.LMS_PG_BIN);
      expect(await check(validPassword, target)).toEqual({
        valid: true,
        activationBlocked: true,
      });
      await expect(
        createLocalAuth({
          ...options,
          databaseUrl: url(target, "auth"),
          databaseName: target,
        }),
      ).rejects.toThrow(/activation blocked/i);
      await expect(
        connectPostgres({ connectionString: url(target, "business") }),
      ).rejects.toThrow(/activation blocked/i);
      await expect(
        service(target).apply({
          caseId: c.caseId,
          newPassword: replacement,
          confirmation: "RECOVER FICTIONAL ACCOUNT AND REVOKE ALL SESSIONS",
        }),
      ).rejects.toMatchObject({ status: 403 });
      const inspect = new Client({ connectionString: url(target) });
      await inspect.connect();
      try {
        expect(
          (await inspect.query("select * from lms_private.recovery_cases"))
            .rows,
        ).toHaveLength(0);
        expect(
          (await inspect.query("select * from lms_identity.session")).rows,
        ).toHaveLength(0);
        await migrate(inspect);
        expect(
          (await inspect.query("select blocked from lms_control.state")).rows[0]
            .blocked,
        ).toBe(true);
        if (target === newRestore)
          expect(
            (
              await inspect.query(
                "select * from lms_private.recovery_events where action='completed'",
              )
            ).rows,
          ).toHaveLength(1);
      } finally {
        await inspect.end();
      }
    }
  });
  it("quarantines a pre-recovery-schema archive and preserves that blocker when upgraded", async () => {
    const legacy = "lms_test_legacy_" + suffix,
      target = "lms_restore_legacy_" + suffix;
    for (const n of [legacy, target])
      await cluster.query(`create database "${n}"`);
    const source = new Client({ connectionString: url(legacy) }),
      restored = new Client({ connectionString: url(target) });
    try {
      await source.connect();
      await migrate(source, (await loadMigrations()).slice(0, 4));
      const file = path.join(directory, "legacy.dump");
      await backupDatabase(url(legacy), legacy, file, process.env.LMS_PG_BIN);
      await restoreDatabase(url(target), target, file, process.env.LMS_PG_BIN);
      await expect(
        connectPostgres({ connectionString: url(target, "business") }),
      ).rejects.toThrow(/activation blocked/i);
      await restored.connect();
      await migrate(restored);
      expect(
        (await restored.query("select blocked from lms_control.state")).rows[0]
          .blocked,
      ).toBe(true);
      await expect(
        createLocalAuth({
          ...options,
          databaseUrl: url(target, "auth"),
          databaseName: target,
        }),
      ).rejects.toThrow(/activation blocked/i);
    } finally {
      await source.end();
      await restored.end();
      for (const n of [legacy, target])
        await cluster.query(`drop database if exists "${n}" with (force)`);
    }
  });
  it("keeps a durable blocker if restore cleanup fails, even when a session-local override is attempted", async () => {
    const target = "lms_restore_cleanup_" + suffix,
      file = path.join(directory, "cleanup-failure.dump");
    await cluster.query(`create database "${target}"`);
    await admin.query(
      "create function lms_private.fail_restore_cleanup() returns trigger language plpgsql as $$ begin raise exception 'Synthetic restore cleanup failure'; end; $$;create trigger synthetic_cleanup_failure before delete on lms_identity.session for each statement execute function lms_private.fail_restore_cleanup()",
    );
    try {
      await backupDatabase(url(name), name, file, process.env.LMS_PG_BIN);
    } finally {
      await admin.query(
        "drop trigger synthetic_cleanup_failure on lms_identity.session;drop function lms_private.fail_restore_cleanup()",
      );
    }
    const inspect = new Client({ connectionString: url(target) });
    const runtime = new Client({ connectionString: url(target, "auth") });
    try {
      await expect(
        restoreDatabase(url(target), target, file, process.env.LMS_PG_BIN),
      ).rejects.toThrow("Synthetic restore cleanup failure");
      await expect(
        createLocalAuth({
          ...options,
          databaseUrl: url(target, "auth"),
          databaseName: target,
        }),
      ).rejects.toThrow(/activation blocked/i);
      await expect(
        connectPostgres({ connectionString: url(target, "business") }),
      ).rejects.toThrow(/activation blocked/i);
      await inspect.connect();
      expect(
        (await inspect.query("select lms_control.is_blocked() as blocked"))
          .rows[0].blocked,
      ).toBe(true);
      await runtime.connect();
      await runtime.query(
        "set role lms_auth_service;set lms.restore_blocked='off'",
      );
      await expect(
        runtime.query(
          'insert into lms_identity.session(token,"userId","expiresAt") values($1,$2,clock_timestamp()+interval \'1 hour\')',
          [randomUUID(), owner],
        ),
      ).rejects.toMatchObject({ code: "55000" });
    } finally {
      await inspect.end();
      await runtime.end();
      await cluster.query(`drop database if exists "${target}" with (force)`);
    }
  });
  it("executes private CLI verification without printing credentials or activating a session", async () => {
    const result = await new Promise<{
      code: number | null;
      out: string;
      err: string;
    }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--import=tsx",
          "scripts/offline-recovery.ts",
          "check-password",
          "--database",
          name,
        ],
        {
          env: {
            ...process.env,
            LMS_ADMIN_DATABASE_URL: url(name),
            LMS_RECOVERY_TRUST_FILE: trustFile,
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let out = "",
        err = "";
      child.stdout.on("data", (c) => (out += c));
      child.stderr.on("data", (c) => (err += c));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, out, err }));
      child.stdin.end(
        JSON.stringify({
          subjectId: owner,
          password: original,
          confirmation: "VERIFY OFFLINE WITHOUT ACTIVATION",
        }),
      );
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toEqual({
      valid: true,
      activationBlocked: false,
    });
    expect(result.out + result.err).not.toContain(original);
    expect(
      (await admin.query("select * from lms_identity.session")).rows,
    ).toHaveLength(0);
  });
});
