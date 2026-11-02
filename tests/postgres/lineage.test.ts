import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { Client } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm, chmod } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { CredentialLineage } from "../../src/server/lineage/offline";
import { OfflineRecovery } from "../../src/server/recovery/offline";
import {
  checkpointDigest,
  verifyChain,
  type Journal,
} from "../../src/server/lineage/protocol";
import { custodians } from "../helpers/lineage";
import {
  migrate,
  loadMigrations,
  provisionRuntime,
  provisionAuthRuntime,
} from "../../src/server/postgres/migrations";
import { localTarget } from "../../src/server/postgres/targets";
import {
  backupDatabase,
  restoreDatabase,
} from "../../src/server/postgres/backup";
import {
  createLocalAuth,
  provisionFictionalAccount,
} from "../../src/server/auth/host";
import { passwordCodec } from "../../src/server/auth/password";
import { replaceCredential } from "../../src/server/auth/lifecycle";
import { connectPostgres } from "../../src/server/postgres/adapter";
import { bootstrapFictionalWorkspace } from "../../src/server/access/bootstrap";
import { Engine } from "../../src/core/engine";
import { CheckpointPublisher } from "../../src/server/publication/store";
import { signPublication } from "../helpers/publication";
const raw = process.env.LMS_TEST_ADMIN_URL;
if (!raw)
  throw new Error("LMS_TEST_ADMIN_URL is required; lineage tests never skip.");
const controlName = decodeURIComponent(new URL(raw).pathname.slice(1));
if (!controlName.startsWith("lms_test_"))
  throw new Error("Use a disposable lms_test_* database.");
const control = localTarget(raw, controlName),
  suffix = randomBytes(5).toString("hex"),
  base = "lms_test_lineage_base_" + suffix;
const original = "fictional_lineage_original_password",
  replacement = "fictional_lineage_rotated_password";
let cluster: Client,
  admin: Client,
  owner: string,
  other: string,
  account: string,
  org: string,
  directory: string,
  fixtureDir: string,
  name: string;
let authority: ReturnType<typeof custodians>,
  trustFile: string,
  keyFile: string,
  journalFile: string,
  pin: string | undefined;
let key: { protocol: string; id: string; secret: string };
let databases: string[] = [];
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
function authOptions(database = name) {
  return {
    databaseUrl: url(database, "auth"),
    databaseName: database,
    origin: "http://127.0.0.1:3200",
    secret: "fictional_lineage_auth_secret_64_characters_only_not_production",
  };
}
function service(database = name, overrides: Record<string, unknown> = {}) {
  return new CredentialLineage({
    databaseUrl: url(database),
    databaseName: database,
    trustFile,
    journalFile,
    commitmentKeyFile: keyFile,
    expectedCheckpointDigest: pin,
    ...overrides,
  });
}
function propose(mode: "genesis" | "advance" = "genesis", database = name) {
  return service(database).propose({
    mode,
    confirmation: "CAPTURE FICTIONAL LINEAGE FOR INDEPENDENT REVIEW",
  });
}
async function publish(
  proposal: Awaited<ReturnType<CredentialLineage["propose"]>>,
) {
  const signed = authority.seal(proposal.checkpoint);
  const journal: Journal = {
    ...proposal.journal,
    checkpoints: [...proposal.journal.checkpoints, signed],
  };
  await writeFile(journalFile, JSON.stringify(journal), { mode: 0o600 });
  pin = checkpointDigest(signed);
  return journal;
}
function assess(database = name, overrides: Record<string, unknown> = {}) {
  return service(database, overrides).assess({
    confirmation: "ASSESS OFFLINE LINEAGE WITHOUT ACTIVATION",
  });
}
async function block(client = admin) {
  await client.query(
    "update lms_control.state set blocked=true,reason='recovered-offline'",
  );
}
async function business(client = admin) {
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
      await client.query(
        `select to_jsonb(t) as row from lms.${table} t order by to_jsonb(t)::text`,
      )
    ).rows;
  return result;
}
async function rotation(
  client = admin,
  subject = owner,
  password = replacement,
) {
  const hash = await passwordCodec.hash(password);
  await client.query("begin");
  try {
    const row = (
      await client.query(
        'select id from lms_identity.account where "userId"=$1 for update',
        [subject],
      )
    ).rows[0];
    await replaceCredential(client, row.id, subject, hash, randomUUID());
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
async function backup(label: string) {
  const file = path.join(fixtureDir, label + ".dump");
  await backupDatabase(url(name), name, file, process.env.LMS_PG_BIN);
  return file;
}
async function restore(file: string) {
  const n = "lms_restore_lineage_" + randomBytes(5).toString("hex");
  await cluster.query(`create database "${n}"`);
  databases.push(n);
  await restoreDatabase(url(n), n, file, process.env.LMS_PG_BIN);
  return n;
}
async function inspect<T>(
  database: string,
  fn: (client: Client) => Promise<T>,
) {
  const c = new Client({ connectionString: url(database) });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
async function stillBlocked(database = name) {
  await inspect(database, async (c) =>
    expect(
      (await c.query("select lms_control.is_blocked() as blocked")).rows[0]
        .blocked,
    ).toBe(true),
  );
  await expect(createLocalAuth(authOptions(database))).rejects.toThrow(
    /activation blocked/i,
  );
  await expect(
    connectPostgres({ connectionString: url(database, "business") }),
  ).rejects.toThrow(/activation blocked/i);
}
async function publicationStore(journal: Journal) {
  const directory = path.join(fixtureDir, "custodian-store");
  const root = await new CheckpointPublisher({
    directory,
    trustFile,
  }).initialize(journal, {
    expectedCheckpointDigest: checkpointDigest(journal.checkpoints.at(-1)!),
    confirmation: "INITIALIZE FICTIONAL PUBLICATION CUSTODY",
  });
  return new CheckpointPublisher({
    directory,
    trustFile,
    expectedRootDigest: root.rootDigest,
  });
}
async function publishCheckpoint(
  store: CheckpointPublisher,
  journal: Journal,
  parent: string | null = null,
) {
  const request = await store.review(journal, {
    expectedReceiptDigest: parent,
    confirmation: "REVIEW FICTIONAL CHECKPOINT PUBLICATION",
  });
  return store.publish(journal, {
    publication: signPublication(authority, request),
    confirmation: "PUBLISH VERIFIED FICTIONAL CHECKPOINT",
  });
}
const verifyPublicationInput = (minimumReceiptDigest: string) => ({
  minimumReceiptDigest,
  confirmation: "VERIFY PUBLISHED FICTIONAL CHECKPOINT",
});
beforeAll(async () => {
  cluster = new Client({ connectionString: control.toString() });
  await cluster.connect();
  await cluster.query(`create database "${base}"`);
  const source = new Client({ connectionString: url(base) });
  await source.connect();
  try {
    await migrate(source, (await loadMigrations()).slice(0, 5));
    await provisionRuntime(source, url(base, "business"));
    await provisionAuthRuntime(source, url(base, "auth"));
    owner = (
      await provisionFictionalAccount(authOptions(base), {
        name: "Fictional lineage owner",
        email: "owner@example.test",
        password: original,
      })
    ).userId;
    other = (
      await provisionFictionalAccount(authOptions(base), {
        name: "Fictional other organization owner",
        email: "other@example.test",
        password: original,
      })
    ).userId;
    account = (
      await source.query(
        'select id from lms_identity.account where "userId"=$1',
        [owner],
      )
    ).rows[0].id;
    org = (
      await bootstrapFictionalWorkspace(source, {
        ownerId: owner,
        operationId: randomUUID(),
        preset: "property",
        name: "Fictional lineage property",
        confirmation: "CREATE FICTIONAL WORKSPACE",
      })
    ).organizationId;
    await bootstrapFictionalWorkspace(source, {
      ownerId: other,
      operationId: randomUUID(),
      preset: "cleaning",
      name: "Fictional independent cleaning",
      confirmation: "CREATE FICTIONAL WORKSPACE",
    });
    const db = await connectPostgres({
      connectionString: url(base, "business"),
    });
    try {
      await new Engine(db).saveRecord({ userId: owner }, org, "customers", {
        name: "Fictional preserved customer",
      });
    } finally {
      await db.close();
    }
    directory = await mkdtemp(path.join(os.tmpdir(), "lms-lineage-"));
    trustFile = path.join(directory, "trust.json");
    authority = custodians(owner);
    await writeFile(trustFile, JSON.stringify(authority.registry), {
      mode: 0o600,
    });
    await new OfflineRecovery({
      databaseUrl: url(base),
      databaseName: base,
      trustFile,
    }).enroll({ confirmation: "REGISTER PRE-EXISTING OFFLINE TRUST" });
    // Synthetic fixture only. Public commands cannot shorten the existing cooling-off period.
    await source.query(
      "update lms_private.recovery_trust set trusted_at=clock_timestamp()-interval '25 hours'",
    );
    const before = await business(source);
    const lease = await connectPostgres({
      connectionString: url(base, "business"),
    });
    try {
      await expect(migrate(source)).rejects.toThrow(/stop runtime hosts/i);
    } finally {
      await lease.close();
    }
    expect(
      (
        await source.query(
          "select count(*)::int as count from lms_meta.migrations",
        )
      ).rows[0].count,
    ).toBe(5);
    expect(await migrate(source)).toEqual([
      "006_credential_lineage",
      "007_relationship_scheduling",
      "008_workforce_availability",
      "009_service_estimates",
      "010_inventory_ledger",
      "011_build_plan_studio",
      "012_business_branding",
      "013_private_logo_assets",
    ]);
    expect(await business(source)).toEqual(before);
  } finally {
    await source.end();
  }
});
beforeEach(async () => {
  name = "lms_test_lineage_" + randomBytes(5).toString("hex");
  await cluster.query(`create database "${name}" template "${base}"`);
  databases = [name];
  admin = new Client({ connectionString: url(name) });
  await admin.connect();
  fixtureDir = await mkdtemp(path.join(directory, "case-"));
  keyFile = path.join(fixtureDir, "commitment-key.json");
  journalFile = path.join(fixtureDir, "external-journal.json");
  key = {
    protocol: "lms-lineage-key-v1",
    id: randomUUID(),
    secret: randomBytes(32).toString("hex"),
  };
  await writeFile(keyFile, JSON.stringify(key), { mode: 0o600 });
  pin = undefined;
});
afterEach(async () => {
  await admin?.end();
  for (const n of databases)
    await cluster.query(`drop database if exists "${n}" with(force)`);
});
afterAll(async () => {
  if (cluster) {
    await cluster.query(`drop database if exists "${base}" with(force)`);
    await cluster.end();
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});
describe("external credential lineage with native PostgreSQL and offline witness fixtures", () => {
  it("adopts a metadata baseline, matches the SQL hash preimage and denies runtime access to lineage", async () => {
    const p = await propose();
    expect(p.activationAllowed).toBe(false);
    expect(
      verifyChain(p.journal.streamId, p.journal.entries).payloads.filter(
        (e) => e.kind === "credential-baseline",
      ),
    ).toHaveLength(2);
    expect(JSON.stringify(p)).not.toMatch(
      /fictional_lineage_original_password|material|password|privateKey|token/,
    );
    expect(JSON.stringify(p)).not.toContain(key.secret);
    const runtime = new Client({ connectionString: url(name, "auth") });
    await runtime.connect();
    try {
      await runtime.query("set role lms_auth_service");
      for (const sql of [
        "select * from lms_private.lineage_entries",
        "select lms_private.append_lineage('{}'::jsonb)",
      ]) {
        await expect(runtime.query(sql)).rejects.toMatchObject({
          code: "42501",
        });
      }
    } finally {
      await runtime.end();
    }
    await expect(
      service().propose({
        mode: "genesis",
        confirmation: "CAPTURE FICTIONAL LINEAGE FOR INDEPENDENT REVIEW",
        force: true,
      }),
    ).rejects.toThrow();
  });
  it("restores a witnessed fictional archive, verifies credentials and history, revokes transient state and leaves activation blocked", async () => {
    const before = await business();
    await publish(await propose());
    const sid = randomUUID();
    await admin.query(
      'insert into lms_identity.session(id,token,"userId","expiresAt") values($1,$2,$3,clock_timestamp()+interval \'1 hour\')',
      [sid, randomUUID(), owner],
    );
    await admin.query(
      "insert into lms_private.membership_reviews(organization_id,actor_id,session_id,target_id,action,next_role,expected_revision,reason) values($1,$2,$3,$4,'set-role','staff',0,'Fictional pending review')",
      [org, owner, sid, other],
    );
    await admin.query(
      "insert into lms_identity.verification(identifier,value,\"expiresAt\") values($1,$2,clock_timestamp()+interval '1 hour')",
      [randomUUID(), "fictional pending verification"],
    );
    const restored = await restore(await backup("current"));
    const result = await assess(restored);
    expect(result).toMatchObject({
      lineageVerified: true,
      credentialStateVerified: true,
      restoredSnapshot: true,
      activationAllowed: false,
      epoch: 1,
    });
    await inspect(restored, async (c) => {
      expect(await business(c)).toEqual(before);
      expect(
        (await c.query("select count(*)::int as n from lms_identity.session"))
          .rows[0].n,
      ).toBe(0);
      expect(
        (
          await c.query(
            "select count(*)::int as n from lms_private.membership_reviews",
          )
        ).rows[0].n,
      ).toBe(0);
    });
    await stillBlocked(restored);
  });
  it("rejects backup rollback against the latest independent pin and accepts a newly witnessed credential rotation without activation", async () => {
    await publish(await propose());
    const older = await backup("older");
    await rotation();
    const journal = await publish(await propose("advance"));
    expect(journal.checkpoints).toHaveLength(2);
    const rollback = await restore(older);
    await expect(assess(rollback)).rejects.toThrow(/older|mismatched/);
    await expect(propose("advance", rollback)).rejects.toThrow(
      /older snapshot/,
    );
    await stillBlocked(rollback);
    const current = await restore(await backup("rotated"));
    expect(await assess(current)).toMatchObject({
      epoch: 2,
      activationAllowed: false,
    });
    await stillBlocked(current);
  });
  it("captures a supported Better Auth password change and invalidates its old cookie before external review", async () => {
    await publish(await propose());
    const host = await createLocalAuth(authOptions());
    try {
      const response = await host.handle(
        new Request(authOptions().origin + "/api/local-auth/sign-in/email", {
          method: "POST",
          headers: {
            origin: authOptions().origin,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            email: "owner@example.test",
            password: original,
          }),
        }),
      );
      expect(response.status).toBe(200);
      const headers = new Headers({
        cookie: response.headers
          .getSetCookie()
          .map((c) => c.split(";")[0])
          .join("; "),
      });
      const operationId = randomUUID();
      expect(
        await host.changePassword(headers, {
          operationId,
          currentPassword: original,
          newPassword: replacement,
          confirmation: "CHANGE PASSWORD AND SIGN OUT",
        }),
      ).toMatchObject({ success: true });
      expect(await host.identity(headers)).toBeNull();
      await expect(propose("advance")).rejects.toMatchObject({ status: 423 });
    } finally {
      await host.close();
    }
    const p = await propose("advance");
    expect(
      verifyChain(p.journal.streamId, p.journal.entries).payloads.filter(
        (e) => e.kind === "credential-event",
      ),
    ).toHaveLength(1);
    await publish(p);
    await block();
    expect(await assess()).toMatchObject({
      credentialStateVerified: true,
      activationAllowed: false,
    });
    await stillBlocked();
  });
  it("refuses an unwitnessed database tail, stale journal replay, and a missing independent latest pin", async () => {
    const older = await publish(await propose());
    await rotation();
    await block();
    await expect(assess()).rejects.toThrow(/ahead|mismatched/);
    const newer = await publish(await propose("advance"));
    expect(await assess()).toMatchObject({ epoch: 2 });
    await writeFile(journalFile, JSON.stringify(older));
    await expect(assess()).rejects.toThrow(/pinned/);
    await writeFile(journalFile, JSON.stringify(newer));
    await expect(
      assess(name, { expectedCheckpointDigest: undefined }),
    ).rejects.toMatchObject({ status: 403 });
    await stillBlocked();
  });
  it("rejects missing, truncated, corrupted or insecure external evidence without altering database history", async () => {
    const journal = await publish(await propose());
    await block();
    const before = await business();
    for (const value of [
      "not-json",
      JSON.stringify({ ...journal, entries: journal.entries.slice(1) }),
      JSON.stringify({
        ...journal,
        entries: journal.entries.map((e, i) =>
          i ? e : { ...e, payload: e.payload + " " },
        ),
      }),
    ]) {
      await writeFile(journalFile, value);
      await expect(assess()).rejects.toThrow();
    }
    await writeFile(journalFile, JSON.stringify(journal));
    await chmod(journalFile, 0o644);
    await expect(assess()).rejects.toMatchObject({ status: 403 });
    await chmod(journalFile, 0o600);
    await rm(journalFile);
    await expect(assess()).rejects.toMatchObject({ status: 403 });
    expect(await business()).toEqual(before);
    await stillBlocked();
  });
  it("rejects forged, expired and future witness approvals and prevents checkpoint replay at another epoch", async () => {
    const journal = await publish(await propose());
    await block();
    const forged = structuredClone(journal);
    forged.checkpoints[0].approval.signature =
      Buffer.alloc(64).toString("base64");
    await writeFile(journalFile, JSON.stringify(forged));
    await expect(assess()).rejects.toMatchObject({ status: 403 });
    for (const delta of [-1200000, 60000]) {
      const cp = {
        ...journal.checkpoints[0].checkpoint,
        issuedAt: new Date(Date.now() + delta).toISOString(),
        expiresAt: new Date(Date.now() + delta + 600000).toISOString(),
      };
      const signed = authority.seal(cp);
      await writeFile(
        journalFile,
        JSON.stringify({ ...journal, checkpoints: [signed] }),
      );
      pin = checkpointDigest(signed);
      await expect(assess()).rejects.toThrow(/stale|history/);
    }
    const replay = structuredClone(journal);
    replay.checkpoints.push({
      ...journal.checkpoints[0],
      checkpoint: {
        ...journal.checkpoints[0].checkpoint,
        epoch: 2,
        previousCheckpointDigest: checkpointDigest(journal.checkpoints[0]),
      },
    });
    await writeFile(journalFile, JSON.stringify(replay));
    pin = checkpointDigest(replay.checkpoints[1]);
    await expect(assess()).rejects.toMatchObject({ status: 403 });
    await stillBlocked();
  });
  it("rejects missing or substituted commitment keys and unsupported instance histories", async () => {
    await publish(await propose());
    await block();
    await writeFile(
      keyFile,
      JSON.stringify({ ...key, secret: randomBytes(32).toString("hex") }),
    );
    await expect(assess()).rejects.toThrow(/credential state|commitment key/i);
    await expect(propose("advance")).rejects.toThrow(/key rotation/);
    await rm(keyFile);
    await expect(assess()).rejects.toMatchObject({ status: 403 });
    await writeFile(keyFile, JSON.stringify(key), { mode: 0o600 });
    await admin.query(
      "update lms_control.state set instance_id=gen_random_uuid()",
    );
    await expect(assess()).rejects.toThrow(/Unsupported database instance/);
    await expect(propose("advance")).rejects.toThrow(
      /Unsupported database instance/,
    );
    await stillBlocked();
  });
  it("detects hash-only tampering, credential-version mismatches and missing database lineage or source audits", async () => {
    await publish(await propose());
    await block();
    // A malicious superuser can defeat DB-only controls; the separately held commitment detects this snapshot change.
    await admin.query("alter table lms_identity.account disable trigger user");
    try {
      await admin.query(
        "update lms_identity.account set password=$1 where id=$2",
        [await passwordCodec.hash(replacement), account],
      );
    } finally {
      await admin.query("alter table lms_identity.account enable trigger user");
    }
    await expect(assess()).rejects.toThrow(/credential state/i);
    await expect(propose("advance")).rejects.toThrow(
      /without a recorded version/,
    );
    await admin.query(
      "alter table lms_identity.credential_versions disable trigger user",
    );
    try {
      await admin.query(
        "update lms_identity.credential_versions set version=gen_random_uuid() where account_id=$1",
        [account],
      );
    } finally {
      await admin.query(
        "alter table lms_identity.credential_versions enable trigger user",
      );
    }
    await expect(assess()).rejects.toThrow(/versions/);
    await admin.query(
      "delete from lms_private.lineage_entries where sequence=1",
    );
    await expect(assess()).rejects.toThrow(/missing|corrupted/);
    await stillBlocked();
  });
  it("rejects deleted source audit history even when the remaining database hash chain is valid", async () => {
    await publish(await propose());
    await block();
    await admin.query("delete from lms_private.recovery_events");
    await expect(assess()).rejects.toThrow(/audit history/);
    await stillBlocked();
  });
  it("serializes concurrent credential rotations, atomically rolls back a failed outbox append, and rejects live runtimes", async () => {
    const host = await createLocalAuth(authOptions());
    try {
      await expect(propose()).rejects.toMatchObject({ status: 423 });
    } finally {
      await host.close();
    }
    const second = new Client({ connectionString: url(name) });
    await second.connect();
    try {
      await Promise.all([
        rotation(),
        rotation(second, other, replacement + "_other"),
      ]);
    } finally {
      await second.end();
    }
    const p = await propose();
    expect(
      verifyChain(p.journal.streamId, p.journal.entries).payloads.filter(
        (e) => e.kind === "credential-event",
      ),
    ).toHaveLength(2);
    const before = (
      await admin.query(
        "select sequence,head_digest from lms_private.lineage_stream",
      )
    ).rows;
    const version = (
      await admin.query(
        "select version from lms_identity.credential_versions where account_id=$1",
        [account],
      )
    ).rows;
    await admin.query(
      "create function lms_private.synthetic_lineage_failure() returns trigger language plpgsql as $$ begin raise exception 'Synthetic lineage append failure';end;$$;create trigger synthetic_failure before insert on lms_private.lineage_entries for each row execute function lms_private.synthetic_lineage_failure()",
    );
    try {
      await expect(
        rotation(admin, owner, replacement + "_failed"),
      ).rejects.toThrow("Synthetic lineage append failure");
    } finally {
      await admin.query(
        "drop trigger synthetic_failure on lms_private.lineage_entries;drop function lms_private.synthetic_lineage_failure()",
      );
    }
    expect(
      (
        await admin.query(
          "select sequence,head_digest from lms_private.lineage_stream",
        )
      ).rows,
    ).toEqual(before);
    expect(
      (
        await admin.query(
          "select version from lms_identity.credential_versions where account_id=$1",
          [account],
        )
      ).rows,
    ).toEqual(version);
    await publish(await propose());
    await block();
    expect(await assess()).toMatchObject({ activationAllowed: false });
  });
  it("captures completed recovery and rejected replay without bypassing existing identity evidence or independent approval", async () => {
    const baseline = await publish(await propose());
    const store = await publicationStore(baseline);
    const firstReceipt = await publishCheckpoint(store, baseline);
    const r = new OfflineRecovery({
      databaseUrl: url(name),
      databaseName: name,
      trustFile,
    });
    await expect(
      r.open({
        subjectId: other,
        evidenceId: authority.registry.evidence[0].id,
        confirmation: "OPEN OFFLINE RECOVERY AND BLOCK ACTIVATION",
      }),
    ).rejects.toMatchObject({ status: 403 });
    const c = await r.open({
      subjectId: owner,
      evidenceId: authority.registry.evidence[0].id,
      confirmation: "OPEN OFFLINE RECOVERY AND BLOCK ACTIVATION",
    });
    for (const [index, stage] of ["verification", "approval"].entries()) {
      const phase = stage as "verification" | "approval",
        operatorId = authority.registry.operators[index].id;
      const review = await r.review({
        caseId: c.caseId,
        stage: phase,
        operatorId,
      });
      const { sign } = await import("node:crypto");
      await r.attest(phase, {
        caseId: c.caseId,
        operatorId,
        signature: sign(
          null,
          Buffer.from(review.message),
          authority.keys[index].privateKey,
        ).toString("base64"),
        confirmation: "I VERIFIED THE OFFLINE RECOVERY REVIEW",
      });
    }
    const input = {
      caseId: c.caseId,
      newPassword: replacement,
      confirmation: "RECOVER FICTIONAL ACCOUNT AND REVOKE ALL SESSIONS",
    };
    await r.apply(input);
    await expect(r.apply(input)).rejects.toMatchObject({ status: 409 });
    const p = await propose("advance");
    expect(
      verifyChain(p.journal.streamId, p.journal.entries)
        .payloads.filter((e) => e.kind === "recovery-event")
        .map((e) => e.action),
    ).toEqual(
      expect.arrayContaining(["completed", "rejected", "verified", "approved"]),
    );
    const recovered = await publish(p);
    const completed = await publishCheckpoint(
      store,
      recovered,
      firstReceipt.receiptDigest,
    );
    expect(
      (await store.verify(verifyPublicationInput(completed.receiptDigest)))
        .activationAllowed,
    ).toBe(false);
    expect(await assess()).toMatchObject({ activationAllowed: false });
    await stillBlocked();
  });
  it("refuses residual sessions or pending approvals and never treats an assessment as revocation or activation", async () => {
    await publish(await propose());
    await block();
    await admin.query(
      'insert into lms_identity.session(token,"userId","expiresAt") values($1,$2,clock_timestamp()+interval \'1 hour\')',
      [randomUUID(), owner],
    );
    await expect(assess()).rejects.toThrow(/pending approvals/);
    expect(
      (await admin.query("select count(*)::int as n from lms_identity.session"))
        .rows[0].n,
    ).toBe(1);
    await stillBlocked();
  });
  it("refuses genesis adoption of a legacy restored database with no external lineage", async () => {
    const legacy = "lms_test_lineage_legacy_" + randomBytes(5).toString("hex");
    await cluster.query(`create database "${legacy}"`);
    databases.push(legacy);
    await inspect(legacy, async (c) => {
      await migrate(c, (await loadMigrations()).slice(0, 5));
    });
    const file = path.join(fixtureDir, "unwitnessed.dump");
    await backupDatabase(url(legacy), legacy, file, process.env.LMS_PG_BIN);
    const target = await restore(file);
    await inspect(target, async (c) => {
      expect(await migrate(c)).toEqual([
        "006_credential_lineage",
        "007_relationship_scheduling",
        "008_workforce_availability",
        "009_service_estimates",
        "010_inventory_ledger",
        "011_build_plan_studio",
        "012_business_branding",
        "013_private_logo_assets",
      ]);
      expect(
        (
          await c.query(
            "select genesis_eligible from lms_private.lineage_stream",
          )
        ).rows[0].genesis_eligible,
      ).toBe(false);
    });
    await new OfflineRecovery({
      databaseUrl: url(target),
      databaseName: target,
      trustFile,
    }).enroll({ confirmation: "REGISTER PRE-EXISTING OFFLINE TRUST" });
    await inspect(target, (c) =>
      c.query(
        "update lms_private.recovery_trust set trusted_at=clock_timestamp()-interval '25 hours'",
      ),
    );
    await expect(propose("genesis", target)).rejects.toThrow(
      /quarantined|history/,
    );
    await stillBlocked(target);
  });
  it("uses independently published receipts to detect a rolled-back PostgreSQL archive and verify a current restore without activation", async () => {
    const before = await business(),
      baseline = await publish(await propose());
    const store = await publicationStore(baseline),
      first = await publishCheckpoint(store, baseline);
    const oldArchive = await backup("before-publication-rotation");
    await rotation();
    const updated = await publish(await propose("advance"));
    const latest = await publishCheckpoint(store, updated, first.receiptDigest);
    const verified = await store.verify(
      verifyPublicationInput(latest.receiptDigest),
    );
    await writeFile(journalFile, JSON.stringify(verified.journal), {
      mode: 0o600,
    });
    pin = verified.checkpointDigest;
    const old = await restore(oldArchive);
    await expect(assess(old)).rejects.toThrow(/older|mismatched/);
    await stillBlocked(old);
    const current = await restore(await backup("after-publication-rotation"));
    expect(await assess(current)).toMatchObject({
      credentialStateVerified: true,
      activationAllowed: false,
    });
    await stillBlocked(current);
    await inspect(current, async (c) =>
      expect(await business(c)).toEqual(before),
    );
  });
  it("refuses an interrupted publication and an unapproved successor while PostgreSQL business data and activation blockers stay intact", async () => {
    const baseline = await publish(await propose());
    const directory = path.join(fixtureDir, "custodian-store");
    const root = await new CheckpointPublisher({
      directory,
      trustFile,
    }).initialize(baseline, {
      expectedCheckpointDigest: checkpointDigest(baseline.checkpoints.at(-1)!),
      confirmation: "INITIALIZE FICTIONAL PUBLICATION CUSTODY",
    });
    const opts = { directory, trustFile, expectedRootDigest: root.rootDigest };
    const store = new CheckpointPublisher(opts);
    const first = await publishCheckpoint(store, baseline);
    await rotation();
    await block();
    const before = await business(),
      updated = await publish(await propose("advance"));
    const request = await store.review(updated, {
      expectedReceiptDigest: first.receiptDigest,
      confirmation: "REVIEW FICTIONAL CHECKPOINT PUBLICATION",
    });
    const publication = signPublication(authority, request),
      forged = structuredClone(publication);
    forged.approval.signature = Buffer.alloc(64).toString("base64");
    await expect(
      store.publish(updated, {
        publication: forged,
        confirmation: "PUBLISH VERIFIED FICTIONAL CHECKPOINT",
      }),
    ).rejects.toMatchObject({ status: 403 });
    class InterruptedPublisher extends CheckpointPublisher {
      protected override async afterDurabilityStep(stage: string) {
        if (stage === "intent-directory-synced")
          throw new Error("Synthetic publication interruption");
      }
    }
    await expect(
      new InterruptedPublisher(opts).publish(updated, {
        publication,
        confirmation: "PUBLISH VERIFIED FICTIONAL CHECKPOINT",
      }),
    ).rejects.toThrow("Synthetic publication interruption");
    await expect(
      store.verify(verifyPublicationInput(first.receiptDigest)),
    ).rejects.toMatchObject({ status: 423 });
    await stillBlocked();
    expect(await business()).toEqual(before);
    const { receiptDigest } = await import(
      "../../src/server/publication/protocol"
    );
    await store.resume({
      expectedPublicationDigest: receiptDigest(publication),
      confirmation: "RESUME THE EXACT APPROVED PUBLICATION",
    });
    const verified = await store.verify(
      verifyPublicationInput(receiptDigest(publication)),
    );
    pin = verified.checkpointDigest;
    await writeFile(journalFile, JSON.stringify(verified.journal), {
      mode: 0o600,
    });
    expect(await assess()).toMatchObject({
      lineageVerified: true,
      activationAllowed: false,
    });
    await stillBlocked();
    expect(await business()).toEqual(before);
  });
  it("runs the host-only CLI without printing secrets and rejects unsupported activation commands", async () => {
    const run = async (action: string, input: unknown) =>
      new Promise<{ code: number | null; out: string; err: string }>(
        (resolve, reject) => {
          const child = spawn(
            process.execPath,
            [
              "--import=tsx",
              "scripts/credential-lineage.ts",
              action,
              "--database",
              name,
            ],
            {
              env: {
                ...process.env,
                LMS_ADMIN_DATABASE_URL: url(name),
                LMS_RECOVERY_TRUST_FILE: trustFile,
                LMS_LINEAGE_JOURNAL_FILE: journalFile,
                LMS_LINEAGE_COMMITMENT_KEY_FILE: keyFile,
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
          child.stdin.end(JSON.stringify(input));
        },
      );
    const result = await run("propose", {
      mode: "genesis",
      confirmation: "CAPTURE FICTIONAL LINEAGE FOR INDEPENDENT REVIEW",
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out).activationAllowed).toBe(false);
    for (const secret of [original, key.secret])
      expect(result.out + result.err).not.toContain(secret);
    expect((await run("activate", {})).code).toBe(1);
  });
});
