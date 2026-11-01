import { offlineEngine, offlinePassword } from "./offline-inspection";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Engine } from "../../src/core/engine";
import { AccessService, type AccessReview } from "../../src/core/access";
import {
  createLocalAuth,
  provisionFictionalAccount,
} from "../../src/server/auth/host";
import { bootstrapFictionalWorkspace } from "../../src/server/access/bootstrap";
import { connectPostgres } from "../../src/server/postgres/adapter";
import {
  loadMigrations,
  migrate,
  provisionAuthRuntime,
  provisionRuntime,
} from "../../src/server/postgres/migrations";
import { localTarget } from "../../src/server/postgres/targets";
import {
  backupDatabase,
  restoreDatabase,
} from "../../src/server/postgres/backup";
import { presets } from "../../src/presets";

const raw = process.env.LMS_TEST_ADMIN_URL;
if (!raw)
  throw new Error(
    "LMS_TEST_ADMIN_URL is required. Access tests never silently skip.",
  );
const controlName = decodeURIComponent(new URL(raw).pathname.slice(1));
const control = localTarget(raw, controlName);
if (!controlName.startsWith("lms_test_"))
  throw new Error("Use a disposable lms_test_* control database.");
const suffix = randomBytes(5).toString("hex");
const name = `lms_test_access_${suffix}`,
  restoreName = `lms_restore_access_${suffix}`;
function url(database: string, role = "admin") {
  const value = new URL(control);
  value.pathname = "/" + database;
  if (role !== "admin") {
    value.username = role === "auth" ? "lms_auth_runtime" : "lms_runtime";
    value.password =
      role === "auth"
        ? "fictional_identity_runtime_password"
        : (process.env.LMS_TEST_RUNTIME_PASSWORD ??
          "fictional_test_password_24_characters");
  }
  return value.toString();
}
const options = {
  databaseUrl: url(name, "auth"),
  databaseName: name,
  origin: "http://127.0.0.1:3200",
  secret: randomBytes(32).toString("hex"),
};
const password = "fictional_test_password_for_access";
const accounts = ["owner", "other", "member", "outsider"] as const;
type Account = (typeof accounts)[number];
const users = {} as Record<Account, string>,
  headers = {} as Record<Account, Headers>;
let cluster: Client, admin: Client;
let host: Awaited<ReturnType<typeof createLocalAuth>>,
  business: Awaited<ReturnType<typeof connectPostgres>>;
let engine: Engine, access: AccessService, org: string, otherOrg: string;
function request(route: string, body: unknown, cookie = "") {
  return new Request(options.origin + "/api/local-auth" + route, {
    method: "POST",
    headers: {
      origin: options.origin,
      "content-type": "application/json",
      cookie,
    },
    body: JSON.stringify(body),
  });
}
async function login(account: Account, instance = host) {
  const response = await instance.handle(
    request("/sign-in/email", { email: account + "@example.test", password }),
  );
  expect(response.status).toBe(200);
  return new Headers({
    cookie: response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  });
}
function bootstrap(
  ownerId: string,
  preset: "property" | "cleaning" = "property",
  operationId = randomUUID(),
) {
  return {
    operationId,
    ownerId,
    preset,
    name: `Fictional ${preset} workspace`,
    confirmation: "CREATE FICTIONAL WORKSPACE",
  };
}
async function prepare(
  targetUserId = users.member,
  action: "set-role" | "remove" | "transfer" = "set-role",
  role = "staff",
  organizationId = org,
  actor = headers.owner,
) {
  const snapshot = await access.snapshot(actor, organizationId);
  return access.prepare(actor, {
    organizationId,
    targetUserId,
    action,
    revision: snapshot.revision,
    reason: "Fictional reviewed staff change",
    ...(action === "set-role" ? { role } : {}),
  });
}
function confirm(review: AccessReview, actor = headers.owner) {
  return access.confirm(actor, {
    reviewId: review.reviewId,
    confirmation: "CONFIRM ACCESS CHANGE",
  });
}
async function grant(
  targetUserId: string,
  role: string,
  organizationId = org,
  actor = headers.owner,
) {
  return confirm(
    await prepare(targetUserId, "set-role", role, organizationId, actor),
    actor,
  );
}
async function membershipAudits(organizationId = org) {
  return (
    await admin.query(
      "select * from lms.audit_events where organization_id=$1 and entity='membership' order by occurred_at,id",
      [organizationId],
    )
  ).rows;
}
// Observable lock waits, rather than arbitrary sleeps, establish the race ordering.
async function waitForLock(pattern: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (
      (
        await admin.query(
          "select 1 from pg_stat_activity where datname=$1 and wait_event_type='Lock' and query like $2",
          [name, pattern],
        )
      ).rows.length
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Expected database lock was not observed.");
}

beforeAll(async () => {
  cluster = new Client({ connectionString: control.toString() });
  await cluster.connect();
  for (const db of [name, restoreName])
    await cluster.query(`create database "${db}"`);
  admin = new Client({ connectionString: url(name) });
  await admin.connect();
  const migrations = await loadMigrations();
  await migrate(admin, migrations.slice(0, 2));
  await provisionRuntime(admin, url(name, "business"));
  await provisionAuthRuntime(admin, url(name, "auth"));
  for (const account of accounts)
    users[account] = (
      await provisionFictionalAccount(options, {
        name: `Fictional ${account}`,
        email: account + "@example.test",
        password,
      })
    ).userId;
  // Upgrade an existing PR #3 workspace without rewriting its record, owner, or immutable migrations.
  const oldOrg = randomUUID();
  await admin.query("insert into lms.users values($1,'Fictional owner')", [
    users.owner,
  ]);
  await admin.query(
    "insert into lms.organizations values($1,'Existing fictional workspace')",
    [oldOrg],
  );
  await admin.query("insert into lms.memberships values($1,$2,'owner')", [
    oldOrg,
    users.owner,
  ]);
  await admin.query("select set_config('lms.user_id',$1,false)", [users.owner]);
  await admin.query(
    "insert into lms.config_revisions(organization_id,revision,document,created_by) values($1,1,$2,$3)",
    [oldOrg, presets.property, users.owner],
  );
  business = await connectPostgres({
    connectionString: url(name, "business"),
    maxConnections: 4,
  });
  engine = new Engine(business);
  const retained = await engine.saveRecord(
    { userId: users.owner },
    oldOrg,
    "customers",
    { name: "Fictional record before membership migration" },
  );
  expect(await migrate(admin)).toEqual([
    "003_owner_memberships",
    "004_account_lifecycle",
    "005_offline_recovery",
    "006_credential_lineage",
    "007_relationship_scheduling",
    "008_workforce_availability",
    "009_service_estimates",
    "010_inventory_ledger",
    "011_build_plan_studio",
  ]);
  expect(
    (await engine.snapshot({ userId: users.owner }, oldOrg)).records[0],
  ).toEqual(retained);
  expect(
    (
      await admin.query(
        "select revision from lms.access_versions where organization_id=$1",
        [oldOrg],
      )
    ).rows[0].revision,
  ).toBe(0);
  host = await createLocalAuth(options);
  access = new AccessService(engine, host.identity);
});
beforeEach(async () => {
  await admin.query(
    "truncate lms.organizations,lms.users cascade; delete from lms_identity.session; delete from lms_identity.rate_limit",
  );
  org = (await bootstrapFictionalWorkspace(admin, bootstrap(users.owner)))
    .organizationId;
  otherOrg = (
    await bootstrapFictionalWorkspace(admin, bootstrap(users.other, "cleaning"))
  ).organizationId;
  for (const account of accounts) headers[account] = await login(account);
  await grant(users.member, "viewer");
  await grant(users.member, "staff", otherOrg, headers.other);
});
afterAll(async () => {
  await host?.close();
  await business?.close();
  await admin?.end();
  if (cluster) {
    for (const db of [name, restoreName])
      await cluster.query(`drop database if exists "${db}" with (force)`);
    await cluster.end();
  }
});

describe("session-bound owner membership commands", () => {
  it("bootstraps only provisioned fictional identities, atomically and idempotently", async () => {
    const input = bootstrap(users.owner, "cleaning");
    const first = await bootstrapFictionalWorkspace(admin, input);
    expect(await bootstrapFictionalWorkspace(admin, input)).toEqual({
      ...first,
      replayed: true,
    });
    expect(await membershipAudits(first.organizationId)).toHaveLength(1);
    expect(
      (await engine.snapshot({ userId: users.owner }, first.organizationId))
        .config.document.industry,
    ).toBe("cleaning");
    await expect(
      bootstrapFictionalWorkspace(admin, { ...input, name: "Changed input" }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      bootstrapFictionalWorkspace(admin, bootstrap(randomUUID())),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      (await admin.query("select count(*)::int as n from lms.organizations"))
        .rows[0].n,
    ).toBe(3);
    const runtime = new Client({ connectionString: url(name, "business") });
    await runtime.connect();
    try {
      await expect(
        bootstrapFictionalWorkspace(runtime, bootstrap(users.owner)),
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      await runtime.end();
    }
  });
  it("requires current owner permission, restricts rosters to one organization and keeps raw DML denied", async () => {
    const snapshot = await access.snapshot(headers.owner, org);
    expect(snapshot.members.map((m) => m.userId).sort()).toEqual(
      [users.owner, users.member].sort(),
    );
    for (const who of [headers.member, headers.other, headers.outsider]) {
      await expect(access.snapshot(who, org)).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        access.prepare(who, {
          organizationId: org,
          targetUserId: users.outsider,
          action: "set-role",
          role: "admin",
          revision: 1,
          reason: "Unauthorized change",
        }),
      ).rejects.toMatchObject({ status: 403 });
    }
    for (const role of ["staff", "admin"]) {
      await grant(users.member, role);
      await expect(access.snapshot(headers.member, org)).rejects.toMatchObject({
        status: 403,
      });
    }
    await engine.asUser({ userId: users.owner }, async (tx) => {
      expect(
        (
          await tx.query<{ user_id: string }>(
            "select user_id from lms.memberships where organization_id=$1",
            [org],
          )
        ).rows,
      ).toEqual([{ user_id: users.owner }]);
    });
    for (const sql of [
      "delete from lms.memberships",
      "insert into lms.users values(gen_random_uuid(),'Escalation')",
      "select * from lms_private.membership_reviews",
      "select session_id from lms.access_receipts",
      "select lms_private.require_access_session(gen_random_uuid())",
      "delete from lms.audit_events",
    ]) {
      await expect(
        engine.asUser({ userId: users.owner }, (tx) => tx.exec(sql)),
      ).rejects.toMatchObject({ code: "42501" });
    }
    const auth = new Client({ connectionString: url(name, "auth") });
    await auth.connect();
    try {
      await auth.query("set role lms_auth_service");
      await expect(
        auth.query("select lms.owner_access_snapshot($1,$2)", [
          org,
          randomUUID(),
        ]),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await auth.end();
    }
  });
  it("applies only an explicitly confirmed review and audits effective role changes", async () => {
    const before = await membershipAudits();
    const review = await prepare();
    expect(review).toMatchObject({
      previousRole: "viewer",
      role: "staff",
      revision: 1,
      targetName: "Fictional member",
    });
    await expect(
      engine.saveRecord({ userId: users.member }, org, "customers", {
        name: "Must reject before confirmation",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      access.confirm(headers.owner, { reviewId: review.reviewId }),
    ).rejects.toThrow();
    expect(await membershipAudits()).toHaveLength(before.length);
    expect(await confirm(review)).toMatchObject({ revision: 2, role: "staff" });
    await engine.saveRecord({ userId: users.member }, org, "customers", {
      name: "Fictional authorized staff record",
    });
    const audit = await membershipAudits();
    expect(audit).toHaveLength(before.length + 1);
    expect(audit.at(-1)).toMatchObject({
      actor_id: users.owner,
      before_data: { role: "viewer" },
      after_data: { role: "staff", reason: "Fictional reviewed staff change" },
    });
    expect(JSON.stringify(audit)).not.toMatch(
      /session_id|sessionId|token|password/,
    );
  });
  it("removes one organization's access while preserving another organization's membership and records", async () => {
    await engine.saveRecord({ userId: users.member }, otherOrg, "customers", {
      name: "Fictional cleaning customer",
    });
    await confirm(await prepare(users.member, "remove"));
    await expect(
      engine.snapshot({ userId: users.member }, org),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (await engine.snapshot({ userId: users.member }, otherOrg)).records[0]
        .data.name,
    ).toBe("Fictional cleaning customer");
    expect(
      (await access.snapshot(headers.other, otherOrg)).members.find(
        (m) => m.userId === users.member,
      )?.role,
    ).toBe("staff");
    expect(await host.principal(headers.member)).toEqual({
      userId: users.member,
    });
  });
  it("rejects self-demotion, owner removal, unprovisioned targets and unknown inputs in SQL as well as host code", async () => {
    const ownerSession = await host.identity(headers.owner);
    for (const [action, target, role] of [
      ["remove", users.owner, null],
      ["set-role", users.owner, "viewer"],
      ["set-role", users.outsider, "owner"],
      ["set-role", randomUUID(), "staff"],
      ["transfer", users.outsider, null],
    ] as const) {
      await expect(
        engine.asUser({ userId: users.owner }, (tx) =>
          tx.query("select lms.prepare_membership($1,$2,$3,$4,$5,$6,$7)", [
            org,
            ownerSession!.sessionId,
            action,
            target,
            role,
            1,
            "Invalid access request",
          ]),
        ),
      ).rejects.toMatchObject({ code: "22023" });
    }
    expect(
      (await access.snapshot(headers.owner, org)).members.filter(
        (m) => m.role === "owner",
      ),
    ).toHaveLength(1);
    await expect(
      access.prepare(headers.owner, {
        organizationId: org,
        targetUserId: users.outsider,
        action: "set-role",
        role: "admin",
        revision: 1,
        reason: "Forged principal",
        userId: users.owner,
      }),
    ).rejects.toThrow();
  });
  it("atomically hands ownership to an existing member and never lets bootstrap retries undo the handover", async () => {
    const initial = bootstrap(users.owner);
    const isolated = (await bootstrapFictionalWorkspace(admin, initial))
      .organizationId;
    await grant(users.member, "admin", isolated);
    const stale = await prepare(users.outsider, "set-role", "viewer", isolated);
    const handover = await prepare(users.member, "transfer", "", isolated);
    expect(handover).toMatchObject({ role: "owner", actorRoleAfter: "admin" });
    const receipt = await confirm(handover);
    expect(await confirm(handover)).toEqual(receipt);
    await expect(
      access.snapshot(headers.owner, isolated),
    ).rejects.toMatchObject({ status: 403 });
    await expect(confirm(stale)).rejects.toMatchObject({ status: 403 });
    expect((await access.snapshot(headers.member, isolated)).members).toEqual(
      expect.arrayContaining([
        { userId: users.owner, name: "Fictional owner", role: "admin" },
        { userId: users.member, name: "Fictional member", role: "owner" },
      ]),
    );
    await bootstrapFictionalWorkspace(admin, initial);
    expect(
      (await access.snapshot(headers.member, isolated)).members
        .filter((m) => m.role === "owner")
        .map((m) => m.userId),
    ).toEqual([users.member]);
    const audit = (await membershipAudits(isolated)).filter(
      (row) => row.action === "transfer",
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].after_data.actorRoleAfter).toBe("admin");
  });
  it("serializes concurrent confirmations and rejects competing stale reviews without duplicate audits", async () => {
    const review = await prepare();
    const before = (await membershipAudits()).length;
    const repeated = await Promise.all([confirm(review), confirm(review)]);
    expect(repeated[0]).toEqual(repeated[1]);
    expect(await membershipAudits()).toHaveLength(before + 1);
    const a = await prepare(users.member, "set-role", "admin"),
      b = await prepare(users.outsider, "set-role", "staff");
    const results = await Promise.allSettled([confirm(a), confirm(b)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { status: 409 },
    });
    expect(await membershipAudits()).toHaveLength(before + 2);
  });
  it("binds approval to the preparing session, rejects expiration and purges approvals on sign-out", async () => {
    const review = await prepare();
    await expect(confirm(review, headers.other)).rejects.toMatchObject({
      status: 403,
    });
    const second = await login("owner");
    await expect(confirm(review, second)).rejects.toMatchObject({
      status: 403,
    });
    await admin.query(
      "update lms_private.membership_reviews set expires_at=now()-interval '1 second' where id=$1",
      [review.reviewId],
    );
    await expect(confirm(review)).rejects.toMatchObject({ status: 409 });
    const pending = await prepare();
    const cached = await host.identity(headers.owner);
    expect(
      (
        await host.handle(
          request("/sign-out", {}, headers.owner.get("cookie")!),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await admin.query(
          "select * from lms_private.membership_reviews where id=$1",
          [pending.reviewId],
        )
      ).rows,
    ).toHaveLength(0);
    const cachedService = new AccessService(engine, async () => cached);
    await expect(
      cachedService.confirm(new Headers(), {
        reviewId: pending.reviewId,
        confirmation: "CONFIRM ACCESS CHANGE",
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect((await access.snapshot(second, org)).revision).toBe(1);
  });
  it("independently rejects missing, mismatched and expired database sessions after host validation", async () => {
    const verified = await host.identity(headers.owner);
    const outsider = await host.identity(headers.outsider);
    for (const sid of [randomUUID(), outsider!.sessionId]) {
      await expect(
        engine.asUser({ userId: users.owner }, (tx) =>
          tx.query("select lms.owner_access_snapshot($1,$2)", [org, sid]),
        ),
      ).rejects.toMatchObject({ code: "28000" });
    }
    await admin.query(
      "update lms_identity.session set \"expiresAt\"=now()-interval '1 second' where id=$1",
      [verified!.sessionId],
    );
    const staleHost = new AccessService(engine, async () => verified);
    await expect(staleHost.snapshot(new Headers(), org)).rejects.toMatchObject({
      status: 401,
    });
    await expect(access.snapshot(new Headers(), org)).rejects.toMatchObject({
      status: 401,
    });
  });
  it("orders an in-flight access commit before session deletion and rejects subsequent commands", async () => {
    const review = await prepare();
    const blocker = new Client({ connectionString: url(name) });
    await blocker.connect();
    let applying: Promise<unknown> | undefined,
      signingOut: Promise<Response> | undefined;
    try {
      await blocker.query("begin");
      await blocker.query(
        "select id from lms.organizations where id=$1 for update",
        [org],
      );
      applying = confirm(review);
      applying.catch(() => {});
      await waitForLock("%select lms.confirm_membership%");
      signingOut = host.handle(
        request("/sign-out", {}, headers.owner.get("cookie")!),
      );
      signingOut.catch(() => {});
      await waitForLock("%delete%session%");
      await blocker.query("commit");
      await expect(applying).resolves.toMatchObject({ revision: 2 });
      expect((await signingOut).status).toBe(200);
      await expect(confirm(review)).rejects.toMatchObject({ status: 401 });
      expect(
        (await access.snapshot(headers.member, org).catch((e) => e)).status,
      ).toBe(403);
      expect(
        (await membershipAudits()).filter((row) => row.action === "set-role"),
      ).toHaveLength(2);
    } finally {
      await blocker.query("rollback");
      await blocker.end();
      await Promise.allSettled([applying, signingOut]);
    }
  });
  it("restores confirmed roles, records and audits without restoring sessions or pending approvals", async () => {
    await grant(users.member, "staff");
    await engine.saveRecord({ userId: users.member }, org, "customers", {
      name: "Fictional restored member record",
    });
    const pending = await prepare(users.outsider, "set-role", "viewer");
    const expected = await access.snapshot(headers.owner, org);
    const audits = await membershipAudits();
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "lms-access-recovery-"),
    );
    const file = path.join(directory, "fictional.dump");
    let restored: Awaited<ReturnType<typeof createLocalAuth>> | undefined;
    let restoredBusiness:
      Awaited<ReturnType<typeof connectPostgres>> | undefined;
    const recovered = new Client({ connectionString: url(restoreName) });
    try {
      await backupDatabase(url(name), name, file, process.env.LMS_PG_BIN);
      await restoreDatabase(
        url(restoreName),
        restoreName,
        file,
        process.env.LMS_PG_BIN,
      );
      await recovered.connect();
      expect(
        (await recovered.query("select * from lms_identity.session")).rows,
      ).toHaveLength(0);
      expect(
        (await recovered.query("select * from lms_private.membership_reviews"))
          .rows,
      ).toHaveLength(0);
      expect(
        (
          await recovered.query(
            "select * from lms.audit_events where organization_id=$1 and entity='membership' order by occurred_at,id",
            [org],
          )
        ).rows,
      ).toEqual(audits);
      expect(
        (
          await recovered.query(
            "select count(*)::int as n from lms.access_receipts",
          )
        ).rows[0].n,
      ).toBe(3);
      await expect(
        createLocalAuth({
          ...options,
          databaseUrl: url(restoreName, "auth"),
          databaseName: restoreName,
        }),
      ).rejects.toThrow(/activation blocked/i);
      await expect(
        connectPostgres({ connectionString: url(restoreName, "business") }),
      ).rejects.toThrow(/activation blocked/i);
      const recoveredEngine = offlineEngine(recovered);
      expect(
        (await recoveredEngine.snapshot({ userId: users.member }, org))
          .records[0].data.name,
      ).toBe("Fictional restored member record");
      expect(await offlinePassword(recovered, users.owner, password)).toBe(
        true,
      );
      expect(
        (await recovered.query("select blocked from lms_control.state")).rows[0]
          .blocked,
      ).toBe(true);
    } finally {
      await restored?.close();
      await restoredBusiness?.close();
      await recovered.end();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
