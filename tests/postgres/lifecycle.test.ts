import { offlineEngine, offlinePassword } from "./offline-inspection";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createLocalAuth,
  provisionFictionalAccount,
} from "../../src/server/auth/host";
import { Engine } from "../../src/core/engine";
import { AccessService } from "../../src/core/access";
import { bootstrapFictionalWorkspace } from "../../src/server/access/bootstrap";
import { connectPostgres } from "../../src/server/postgres/adapter";
import { localTarget } from "../../src/server/postgres/targets";
import {
  loadMigrations,
  migrate,
  provisionAuthRuntime,
  provisionRuntime,
} from "../../src/server/postgres/migrations";
import {
  backupDatabase,
  restoreDatabase,
} from "../../src/server/postgres/backup";
const raw = process.env.LMS_TEST_ADMIN_URL;
if (!raw)
  throw new Error(
    "LMS_TEST_ADMIN_URL is required. Lifecycle tests never silently skip.",
  );
const controlName = decodeURIComponent(new URL(raw).pathname.slice(1)),
  control = localTarget(raw, controlName);
if (!controlName.startsWith("lms_test_"))
  throw new Error("Use a disposable lms_test_* control database.");
const suffix = randomBytes(5).toString("hex"),
  name = `lms_test_lifecycle_${suffix}`,
  restoreName = `lms_restore_lifecycle_${suffix}`;
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
const original = "fictional_original_password_for_lifecycle",
  changed = "fictional_changed_password_for_lifecycle";
let cluster: Client,
  admin: Client,
  host: Awaited<ReturnType<typeof createLocalAuth>>,
  second: typeof host;
let db: Awaited<ReturnType<typeof connectPostgres>>,
  engine: Engine,
  access: AccessService;
let owner: string,
  member: string,
  outsider: string,
  initialHash: string,
  memberHash: string,
  org: string,
  otherOrg: string,
  ownerHeaders: Headers,
  memberHeaders: Headers;
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
function cookie(response: Response) {
  return new Headers({
    cookie: response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  });
}
async function signIn(
  password = original,
  email = "owner@example.test",
  instance = host,
) {
  return instance.handle(request("/sign-in/email", { email, password }));
}
function input(
  newPassword = changed,
  operationId = randomUUID(),
  currentPassword = original,
) {
  return {
    operationId,
    currentPassword,
    newPassword,
    confirmation: "CHANGE PASSWORD AND SIGN OUT",
  };
}
async function events(client = admin) {
  return (
    await client.query(
      "select * from lms_identity.credential_events order by occurred_at,id",
    )
  ).rows;
}
async function prepare(target = member, role = "staff") {
  const { revision } = await access.snapshot(ownerHeaders, org);
  return access.prepare(ownerHeaders, {
    organizationId: org,
    targetUserId: target,
    action: "set-role",
    role,
    revision,
    reason: "Fictional reviewed staff change",
  });
}
async function waitForLock(pattern: string, count = 1) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    if (
      (
        await admin.query(
          "select 1 from pg_stat_activity where datname=$1 and wait_event_type='Lock' and query like $2",
          [name, pattern],
        )
      ).rows.length >= count
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Expected database lock was not observed.");
}
async function blocker() {
  const c = new Client({ connectionString: url(name) });
  await c.connect();
  await c.query("begin");
  return c;
}

beforeAll(async () => {
  cluster = new Client({ connectionString: control.toString() });
  await cluster.connect();
  for (const target of [name, restoreName])
    await cluster.query(`create database "${target}"`);
  admin = new Client({ connectionString: url(name) });
  await admin.connect();
  const migrations = await loadMigrations();
  await migrate(admin, migrations.slice(0, 3));
  await provisionRuntime(admin, url(name, "business"));
  await provisionAuthRuntime(admin, url(name, "auth"));
  for (const label of ["owner", "member", "outsider"]) {
    const user = (
      await provisionFictionalAccount(options, {
        name: "Fictional " + label,
        email: label + "@example.test",
        password: original,
      })
    ).userId;
    if (label === "owner") owner = user;
    else if (label === "member") member = user;
    else outsider = user;
  }
  initialHash = (
    await admin.query(
      'select password from lms_identity.account where "userId"=$1',
      [owner],
    )
  ).rows[0].password;
  memberHash = (
    await admin.query(
      'select password from lms_identity.account where "userId"=$1',
      [member],
    )
  ).rows[0].password;
  org = (
    await bootstrapFictionalWorkspace(admin, {
      ownerId: owner,
      operationId: randomUUID(),
      preset: "property",
      name: "Fictional pre-upgrade workspace",
      confirmation: "CREATE FICTIONAL WORKSPACE",
    })
  ).organizationId;
  db = await connectPostgres({ connectionString: url(name, "business") });
  engine = new Engine(db);
  const record = await engine.saveRecord({ userId: owner }, org, "customers", {
    name: "Fictional record before lifecycle migration",
  });
  const before = await engine.exportWorkspace({ userId: owner }, org);
  expect(await migrate(admin)).toEqual([
    "004_account_lifecycle",
    "005_offline_recovery",
    "006_credential_lineage",
  ]);
  expect((await engine.snapshot({ userId: owner }, org)).records[0]).toEqual(
    record,
  );
  const after = await engine.exportWorkspace({ userId: owner }, org);
  expect({ ...after, exportedAt: "" }).toEqual({ ...before, exportedAt: "" });
  expect(await events()).toEqual([]);
  host = await createLocalAuth(options);
  second = await createLocalAuth(options);
  access = new AccessService(engine, host.identity);
});
beforeEach(async () => {
  await admin.query(
    "truncate lms.organizations,lms.users cascade; delete from lms_identity.session; delete from lms_identity.rate_limit",
  );
  await admin.query(
    'update lms_identity.account set password=$1 where "userId"=$2',
    [initialHash, owner],
  );
  await admin.query(
    'update lms_identity.account set password=$1 where "userId"=$2',
    [memberHash, member],
  );
  await admin.query("truncate lms_identity.credential_events");
  org = (
    await bootstrapFictionalWorkspace(admin, {
      ownerId: owner,
      operationId: randomUUID(),
      preset: "property",
      name: "Fictional property workspace",
      confirmation: "CREATE FICTIONAL WORKSPACE",
    })
  ).organizationId;
  otherOrg = (
    await bootstrapFictionalWorkspace(admin, {
      ownerId: outsider,
      operationId: randomUUID(),
      preset: "cleaning",
      name: "Fictional cleaning workspace",
      confirmation: "CREATE FICTIONAL WORKSPACE",
    })
  ).organizationId;
  const signed = await signIn();
  expect(signed.status).toBe(200);
  ownerHeaders = cookie(signed);
  const memberSigned = await signIn(original, "member@example.test");
  expect(memberSigned.status).toBe(200);
  memberHeaders = cookie(memberSigned);
  const review = await prepare(member, "viewer");
  await access.confirm(ownerHeaders, {
    reviewId: review.reviewId,
    confirmation: "CONFIRM ACCESS CHANGE",
  });
  await engine.saveRecord({ userId: owner }, org, "customers", {
    name: "Fictional retained business record",
  });
});
afterAll(async () => {
  await host?.close();
  await second?.close();
  await db?.close();
  await admin?.end();
  if (cluster) {
    for (const target of [name, restoreName])
      await cluster.query(`drop database if exists "${target}" with (force)`);
    await cluster.end();
  }
});

describe("verified local credential lifecycle and recent authentication", () => {
  it("changes only the authenticated account, revokes every old session/review and preserves business history", async () => {
    const another = await signIn();
    expect(another.status).toBe(200);
    const pending = await prepare();
    const before = await engine.snapshot({ userId: owner }, org);
    const change = input();
    expect(await host.changePassword(ownerHeaders, change)).toEqual({
      success: true,
      signInRequired: true,
      operationId: change.operationId,
    });
    expect(await host.identity(ownerHeaders)).toBeNull();
    expect(await host.identity(cookie(another))).toBeNull();
    expect(
      (
        await admin.query(
          'select id from lms_identity.session where "userId"=$1',
          [owner],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await admin.query(
          "select id from lms_private.membership_reviews where id=$1",
          [pending.reviewId],
        )
      ).rows,
    ).toHaveLength(0);
    expect(await engine.snapshot({ userId: owner }, org)).toEqual(before);
    expect(await host.identity(memberHeaders)).toMatchObject({
      userId: member,
    });
    expect((await signIn(original)).status).toBe(401);
    const fresh = await signIn(changed);
    expect(fresh.status).toBe(200);
    expect(await access.snapshot(cookie(fresh), org)).toMatchObject({
      revision: 1,
    });
    const audit = await events();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      subject_id: owner,
      operation_id: change.operationId,
      action: "password-changed",
    });
    expect(Object.keys(audit[0]).sort()).toEqual(
      ["action", "id", "operation_id", "occurred_at", "subject_id"].sort(),
    );
    expect(JSON.stringify(audit)).not.toMatch(
      /password_for_lifecycle|token|session|hash|\$/,
    );
    await expect(
      access.snapshot(cookie(fresh), otherOrg),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("rejects incorrect credentials, forged identities, unconfirmed operations and all reset/deletion routes", async () => {
    await expect(
      host.changePassword(new Headers({ "x-user-id": owner }), input()),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      host.changePassword(ownerHeaders, { ...input(), userId: member }),
    ).rejects.toThrow();
    await expect(
      host.changePassword(ownerHeaders, {
        ...input(),
        confirmation: undefined,
      }),
    ).rejects.toThrow();
    await expect(
      host.changePassword(
        memberHeaders,
        input(changed, randomUUID(), "wrong_password"),
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      host.changePassword(
        ownerHeaders,
        input(changed, randomUUID(), "wrong_password"),
      ),
    ).rejects.toMatchObject({ status: 401 });
    for (const route of [
      "/change-password",
      "/verify-password",
      "/request-password-reset",
      "/reset-password",
      "/set-password",
      "/delete-user",
    ])
      expect(
        (
          await host.handle(
            request(route, input(), ownerHeaders.get("cookie")!),
          )
        ).status,
      ).toBe(404);
    expect(await events()).toHaveLength(0);
    expect(
      (await access.snapshot(ownerHeaders, org)).members
        .filter((m) => m.role === "owner")
        .map((m) => m.userId),
    ).toEqual([owner]);
    for (const sql of [
      "select * from lms_identity.credential_events",
      "update lms_identity.account set password='fake'",
      "select lms_identity.require_recent_session(gen_random_uuid(),gen_random_uuid(),true)",
    ])
      await expect(
        engine.asUser({ userId: owner }, (tx) => tx.exec(sql)),
      ).rejects.toMatchObject({ code: "42501" });
    const auth = new Client({ connectionString: url(name, "auth") });
    await auth.connect();
    try {
      await auth.query("set role lms_auth_service");
      for (const sql of [
        "delete from lms_identity.credential_events",
        "insert into lms_identity.credential_events(subject_id,action) values(gen_random_uuid(),'password-changed')",
      ])
        await expect(auth.query(sql)).rejects.toMatchObject({ code: "42501" });
    } finally {
      await auth.end();
    }
  });
  it("captures cookie credentials once so a caller cannot switch accounts between verification steps", async () => {
    const different = "fictional_member_different_password";
    await host.changePassword(memberHeaders, input(different));
    const signed = await signIn(different, "member@example.test");
    expect(signed.status).toBe(200);
    const changingHeaders = new Headers(ownerHeaders),
      held = await blocker();
    let changing: Promise<unknown> | undefined;
    try {
      await held.query("lock table lms_identity.rate_limit in share mode");
      changing = host.changePassword(
        changingHeaders,
        input(changed, randomUUID(), different),
      );
      changing.catch(() => {});
      await waitForLock("%insert into lms_identity.rate_limit%");
      changingHeaders.set("cookie", cookie(signed).get("cookie")!);
      await held.query("commit");
      await expect(changing).rejects.toMatchObject({ status: 401 });
      expect((await signIn()).status).toBe(200);
      expect((await events()).map((row) => row.subject_id)).toEqual([member]);
      expect((await engine.snapshot({ userId: owner }, org)).role).toBe(
        "owner",
      );
    } finally {
      await held.query("rollback");
      await held.end();
      await Promise.allSettled([changing]);
    }
  });
  it("requires a recent live session and checks expiry again after waiting for a database lock", async () => {
    const verified = await host.identity(ownerHeaders);
    await admin.query(
      "update lms_identity.session set \"createdAt\"=now()-interval '6 minutes' where id=$1",
      [verified!.sessionId],
    );
    await expect(
      host.changePassword(ownerHeaders, input()),
    ).rejects.toMatchObject({ status: 401 });
    await admin.query(
      'update lms_identity.session set "createdAt"=now() where id=$1',
      [verified!.sessionId],
    );
    const expiring = await signIn();
    expect(expiring.status).toBe(200);
    const expiredHeaders = cookie(expiring),
      expired = await host.identity(expiredHeaders);
    await admin.query(
      "update lms_identity.session set \"expiresAt\"=now()-interval '1 second' where id=$1",
      [expired!.sessionId],
    );
    await expect(
      host.changePassword(expiredHeaders, input()),
    ).rejects.toMatchObject({ status: 401 });
    const held = await blocker();
    let change: Promise<unknown> | undefined;
    try {
      await held.query(
        "select id from lms_identity.session where id=$1 for update",
        [verified!.sessionId],
      );
      change = host.changePassword(ownerHeaders, input());
      change.catch(() => {});
      await waitForLock("%lms_identity.require_recent_session%");
      await held.query(
        "update lms_identity.session set \"expiresAt\"=now()-interval '1 second' where id=$1",
        [verified!.sessionId],
      );
      await held.query("commit");
      await expect(change).rejects.toMatchObject({ status: 401 });
    } finally {
      await held.query("rollback");
      await held.end();
      await Promise.allSettled([change]);
    }
    expect(await events()).toHaveLength(0);
  });
  it("rejects a session revoked after password verification but before the mutation", async () => {
    const held = await blocker();
    let change: Promise<unknown> | undefined;
    try {
      await held.query(
        'select id from lms_identity.account where "userId"=$1 for update',
        [owner],
      );
      change = host.changePassword(ownerHeaders, input());
      change.catch(() => {});
      await waitForLock("%select id from lms_identity.account%");
      await admin.query('delete from lms_identity.session where "userId"=$1', [
        owner,
      ]);
      await held.query("commit");
      await expect(change).rejects.toMatchObject({ status: 401 });
    } finally {
      await held.query("rollback");
      await held.end();
      await Promise.allSettled([change]);
    }
    expect(await events()).toHaveLength(0);
    expect((await signIn()).status).toBe(200);
  });
  it("serializes competing password changes across hosts and never overwrites a committed credential", async () => {
    const held = await blocker();
    let changes: Promise<unknown>[] = [];
    try {
      await held.query(
        'select id from lms_identity.account where "userId"=$1 for update',
        [owner],
      );
      changes = [
        host.changePassword(ownerHeaders, input(changed)),
        second.changePassword(ownerHeaders, input(changed + "_second")),
      ];
      changes.forEach((p) => p.catch(() => {}));
      await waitForLock("%select id from lms_identity.account%", 2);
      await held.query("commit");
      const results = await Promise.allSettled(changes);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({
        reason: { status: 409 },
      });
      const winner =
        results[0].status === "fulfilled" ? changed : changed + "_second";
      expect((await signIn(winner)).status).toBe(200);
      expect(await events()).toHaveLength(1);
    } finally {
      await held.query("rollback");
      await held.end();
      await Promise.allSettled(changes);
    }
  });
  it("blocks an old-password sign-in behind a pending credential commit", async () => {
    const held = await blocker();
    let changing: Promise<unknown> | undefined,
      loggingIn: Promise<Response> | undefined;
    try {
      await held.query(
        'select id from lms_identity.account where "userId"=$1 for update',
        [owner],
      );
      changing = host.changePassword(ownerHeaders, input());
      changing.catch(() => {});
      await waitForLock("%select id from lms_identity.account%");
      loggingIn = signIn(original, "owner@example.test", second);
      loggingIn.catch(() => {});
      await waitForLock("%for share of a%");
      await held.query("commit");
      await expect(changing).resolves.toMatchObject({ success: true });
      expect((await loggingIn).status).toBe(401);
      expect(
        (
          await admin.query(
            'select id from lms_identity.session where "userId"=$1',
            [owner],
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      await held.query("rollback");
      await held.end();
      await Promise.allSettled([changing, loggingIn]);
    }
  });
  it("revokes a sign-in which acquired the credential first, even if its session insert was delayed", async () => {
    const held = await blocker();
    let changing: Promise<unknown> | undefined,
      loggingIn: Promise<Response> | undefined;
    try {
      await held.query("lock table lms_identity.session in share mode");
      loggingIn = signIn(original, "owner@example.test", second);
      loggingIn.catch(() => {});
      await waitForLock("%insert into%session%");
      changing = host.changePassword(ownerHeaders, input());
      changing.catch(() => {});
      await waitForLock("%select id from lms_identity.account%");
      await held.query("commit");
      const signed = await loggingIn;
      expect(signed.status).toBe(200);
      await changing;
      expect(await host.identity(cookie(signed))).toBeNull();
      expect(
        (
          await admin.query(
            'select id from lms_identity.session where "userId"=$1',
            [owner],
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      await held.query("rollback");
      await held.end();
      await Promise.allSettled([changing, loggingIn]);
    }
  });
  it("orders an in-flight owner confirmation before credential revocation without changing ownership history", async () => {
    const review = await prepare();
    const held = await blocker();
    let confirming: Promise<unknown> | undefined,
      changing: Promise<unknown> | undefined;
    try {
      await held.query(
        "select id from lms.organizations where id=$1 for update",
        [org],
      );
      confirming = access.confirm(ownerHeaders, {
        reviewId: review.reviewId,
        confirmation: "CONFIRM ACCESS CHANGE",
      });
      confirming.catch(() => {});
      await waitForLock("%lms.confirm_membership%");
      changing = host.changePassword(ownerHeaders, input());
      changing.catch(() => {});
      await waitForLock("%lms_identity.require_recent_session%");
      await held.query("commit");
      await expect(confirming).resolves.toMatchObject({ role: "staff" });
      await changing;
      await expect(
        access.confirm(ownerHeaders, {
          reviewId: review.reviewId,
          confirmation: "CONFIRM ACCESS CHANGE",
        }),
      ).rejects.toMatchObject({ status: 401 });
      expect((await engine.snapshot({ userId: owner }, org)).role).toBe(
        "owner",
      );
      expect((await engine.snapshot({ userId: member }, org)).role).toBe(
        "staff",
      );
      expect(await events()).toHaveLength(1);
    } finally {
      await held.query("rollback");
      await held.end();
      await Promise.allSettled([changing, confirming]);
    }
  });
  it("rolls back the password, sessions and pending reviews together when audit insertion fails", async () => {
    const review = await prepare(),
      before = await engine.snapshot({ userId: owner }, org);
    await admin.query(`create function lms_private.fail_credential_audit() returns trigger language plpgsql as $$ begin raise exception 'Synthetic audit failure'; end; $$;
    create trigger synthetic_audit_failure before insert on lms_identity.credential_events for each row execute function lms_private.fail_credential_audit()`);
    try {
      await expect(host.changePassword(ownerHeaders, input())).rejects.toThrow(
        "Synthetic audit failure",
      );
    } finally {
      await admin.query(
        "drop trigger synthetic_audit_failure on lms_identity.credential_events; drop function lms_private.fail_credential_audit()",
      );
    }
    expect(await host.identity(ownerHeaders)).toMatchObject({ userId: owner });
    expect(await events()).toHaveLength(0);
    expect(
      (
        await admin.query(
          "select id from lms_private.membership_reviews where id=$1",
          [review.reviewId],
        )
      ).rows,
    ).toHaveLength(1);
    expect(await engine.snapshot({ userId: owner }, org)).toEqual(before);
    expect((await signIn()).status).toBe(200);
  });
  it("rejects old-session replay and a reused operation UUID after a fresh sign-in", async () => {
    const first = input();
    await host.changePassword(ownerHeaders, first);
    await expect(
      host.changePassword(ownerHeaders, first),
    ).rejects.toMatchObject({ status: 401 });
    const fresh = await signIn(changed);
    expect(fresh.status).toBe(200);
    await expect(
      host.changePassword(
        cookie(fresh),
        input(changed + "_again", first.operationId, changed),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await host.identity(cookie(fresh))).toMatchObject({ userId: owner });
    expect(await events()).toHaveLength(1);
    expect((await signIn(changed)).status).toBe(200);
  });
  it("shares an atomic per-account password-attempt budget across hosts and ignores forged identity headers", async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        (i % 2 ? host : second).changePassword(
          new Headers({
            cookie: ownerHeaders.get("cookie")!,
            "x-user-id": randomUUID(),
            "x-forwarded-for": `198.51.100.${i}`,
          }),
          input(changed, randomUUID(), "wrong_password"),
        ),
      ),
    );
    expect(
      attempts.filter(
        (r) => r.status === "rejected" && r.reason.status === 401,
      ),
    ).toHaveLength(5);
    expect(
      attempts.filter(
        (r) => r.status === "rejected" && r.reason.status === 429,
      ),
    ).toHaveLength(3);
    await expect(
      host.changePassword(ownerHeaders, input()),
    ).rejects.toMatchObject({ status: 429 });
    expect(await events()).toHaveLength(0);
    await admin.query(
      'update lms_identity.rate_limit set "lastRequest"="lastRequest"-61000 where key=$1',
      ["lms:credential-change:" + owner],
    );
    await expect(
      host.changePassword(ownerHeaders, input()),
    ).resolves.toMatchObject({ success: true });
  });
  it("requires recent authentication in owner SQL commands and rechecks freshness after org lock waits", async () => {
    const review = await prepare(),
      session = await host.identity(ownerHeaders);
    const held = await blocker();
    let confirming: Promise<unknown> | undefined;
    try {
      await held.query(
        "select id from lms.organizations where id=$1 for update",
        [org],
      );
      await admin.query(
        "update lms_identity.session set \"createdAt\"=clock_timestamp()-interval '298 seconds' where id=$1",
        [session!.sessionId],
      );
      confirming = access.confirm(ownerHeaders, {
        reviewId: review.reviewId,
        confirmation: "CONFIRM ACCESS CHANGE",
      });
      confirming.catch(() => {});
      await waitForLock("%lms.confirm_membership%");
      // Let the real server clock cross the window without updating a locked session row.
      const deadline = Date.now() + 6000;
      while (
        !(
          await admin.query(
            "select \"createdAt\"<=clock_timestamp()-interval '5 minutes' as stale from lms_identity.session where id=$1",
            [session!.sessionId],
          )
        ).rows[0].stale
      ) {
        if (Date.now() > deadline)
          throw new Error("Recent-auth window did not expire.");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await held.query("commit");
      await expect(confirming).rejects.toMatchObject({ status: 401 });
    } finally {
      await held.query("rollback");
      await held.end();
      await Promise.allSettled([confirming]);
    }
    expect(await host.identity(ownerHeaders)).toMatchObject({ userId: owner });
    await expect(access.snapshot(ownerHeaders, org)).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      engine.asUser({ userId: owner }, (tx) =>
        tx.query("select lms.prepare_membership($1,$2,$3,$4,$5,$6,$7)", [
          org,
          session!.sessionId,
          "remove",
          member,
          null,
          1,
          "Fictional old-session removal",
        ]),
      ),
    ).rejects.toMatchObject({ code: "28000" });
    await expect(
      host.changePassword(ownerHeaders, input()),
    ).rejects.toMatchObject({ status: 401 });
    const fresh = await signIn();
    expect(fresh.status).toBe(200);
    expect(
      (await access.snapshot(cookie(fresh), org)).members
        .filter((m) => m.role === "owner")
        .map((m) => m.userId),
    ).toEqual([owner]);
  });
  it("restores the new credential, events and unchanged business history without restoring sessions or approvals", async () => {
    await prepare();
    const before = await engine.snapshot({ userId: owner }, org);
    await host.changePassword(ownerHeaders, input());
    const expected = await events(),
      directory = await mkdtemp(
        path.join(os.tmpdir(), "lms-credential-restore-"),
      ),
      file = path.join(directory, "fictional.dump");
    const recovered = new Client({ connectionString: url(restoreName) });
    let restored: typeof host | undefined, restoredDb: typeof db | undefined;
    try {
      await backupDatabase(url(name), name, file, process.env.LMS_PG_BIN);
      await restoreDatabase(
        url(restoreName),
        restoreName,
        file,
        process.env.LMS_PG_BIN,
      );
      await recovered.connect();
      expect(await events(recovered)).toEqual(expected);
      expect(
        (await recovered.query("select * from lms_identity.session")).rows,
      ).toHaveLength(0);
      expect(
        (await recovered.query("select * from lms_private.membership_reviews"))
          .rows,
      ).toHaveLength(0);
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
      expect(await offlinePassword(recovered, owner, original)).toBe(false);
      expect(await offlinePassword(recovered, owner, changed)).toBe(true);
      expect(
        await offlineEngine(recovered).snapshot({ userId: owner }, org),
      ).toEqual(before);
      expect(
        (await recovered.query("select blocked from lms_control.state")).rows[0]
          .blocked,
      ).toBe(true);
    } finally {
      await restored?.close();
      await restoredDb?.close();
      await recovered.end();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
