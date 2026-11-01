import { offlinePassword } from "./offline-inspection";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createLocalAuth,
  provisionFictionalAccount,
} from "../../src/server/auth/host";
import {
  migrate,
  provisionAuthRuntime,
  provisionRuntime,
  loadMigrations,
} from "../../src/server/postgres/migrations";
import { localTarget } from "../../src/server/postgres/targets";
import { connectPostgres } from "../../src/server/postgres/adapter";
import {
  backupDatabase,
  restoreDatabase,
} from "../../src/server/postgres/backup";
import { Engine } from "../../src/core/engine";
import { presets } from "../../src/presets";
const raw = process.env.LMS_TEST_ADMIN_URL;
if (!raw)
  throw new Error(
    "LMS_TEST_ADMIN_URL is required. Identity tests never silently skip.",
  );
const controlName = decodeURIComponent(new URL(raw).pathname.slice(1));
const control = localTarget(raw, controlName);
if (!controlName.startsWith("lms_test_"))
  throw new Error("Use a disposable lms_test_* control database.");
const suffix = randomBytes(5).toString("hex");
const name = `lms_test_auth_${suffix}`,
  restoreName = `lms_restore_auth_${suffix}`;
function url(database: string, role = "admin") {
  const url = new URL(control);
  url.pathname = "/" + database;
  if (role !== "admin") {
    url.username = role === "auth" ? "lms_auth_runtime" : "lms_runtime";
    url.password =
      role === "auth"
        ? "fictional_identity_runtime_password"
        : (process.env.LMS_TEST_RUNTIME_PASSWORD ??
          "fictional_test_password_24_characters");
  }
  return url.toString();
}
const options = {
  databaseUrl: url(name, "auth"),
  databaseName: name,
  origin: "http://127.0.0.1:3200",
  secret: randomBytes(32).toString("hex"),
};
const password = "fictional_test_password_for_identity";
let cluster: Client,
  admin: Client,
  host: Awaited<ReturnType<typeof createLocalAuth>>;
let owner: string, outsider: string;
const org = randomUUID();
let business: Awaited<ReturnType<typeof connectPostgres>>;
let engine: Engine;
function request(
  route: string,
  body?: unknown,
  cookie = "",
  extra?: Record<string, string>,
  origin = options.origin,
) {
  return new Request(origin + "/api/local-auth" + route, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined
        ? {}
        : { "content-type": "application/json", origin }),
      ...(cookie ? { cookie } : {}),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}
async function login(email = "owner@example.test", instance = host) {
  const response = await instance.handle(
    request("/sign-in/email", { email, password }),
  );
  expect(response.status).toBe(200);
  return { response, cookie: cookies(response) };
}
beforeAll(async () => {
  cluster = new Client({ connectionString: control.toString() });
  await cluster.connect();
  for (const db of [name, restoreName])
    await cluster.query(`create database "${db}"`);
  admin = new Client({ connectionString: url(name) });
  await admin.connect();
  // Rehearse upgrading an existing PR #2 database, without rewriting migration 1 or records.
  const migrations = await loadMigrations();
  await migrate(admin, migrations.slice(0, 1));
  expect(await migrate(admin)).toEqual([
    "002_local_identity",
    "003_owner_memberships",
    "004_account_lifecycle",
    "005_offline_recovery",
    "006_credential_lineage",
    "007_relationship_scheduling",
    "008_workforce_availability",
    "009_service_estimates",
  ]);
  await provisionRuntime(admin, url(name, "business"));
  await provisionAuthRuntime(admin, url(name, "auth"));
  owner = (
    await provisionFictionalAccount(options, {
      name: "Fictional owner",
      email: "owner@example.test",
      password,
    })
  ).userId;
  outsider = (
    await provisionFictionalAccount(options, {
      name: "Fictional outsider",
      email: "outsider@example.test",
      password,
    })
  ).userId;
  expect(
    (await admin.query("select * from lms.memberships")).rows,
  ).toHaveLength(0);
  await admin.query("BEGIN");
  try {
    await admin.query("select set_config('lms.user_id',$1,true)", [owner]);
    await admin.query(
      "insert into lms.users values($1,'Fictional owner'),($2,'Fictional outsider')",
      [owner, outsider],
    );
    await admin.query(
      "insert into lms.organizations values($1,'Fictional authenticated property')",
      [org],
    );
    await admin.query("insert into lms.memberships values($1,$2,'owner')", [
      org,
      owner,
    ]);
    await admin.query(
      "insert into lms.config_revisions(organization_id,revision,document,created_by) values($1,1,$2,$3)",
      [org, presets.property, owner],
    );
    await admin.query("COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }
  business = await connectPostgres({ connectionString: url(name, "business") });
  engine = new Engine(business);
  await engine.saveRecord({ userId: owner }, org, "customers", {
    name: "Private fictional business record",
  });
  host = await createLocalAuth(options);
});
beforeEach(async () => {
  await admin.query(
    "delete from lms_identity.session; delete from lms_identity.rate_limit",
  );
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
describe("self-hosted local identity and revocable database sessions", () => {
  it("uses maintained password hashing, cookie-only sign-in and verified principal mapping", async () => {
    const { response, cookie } = await login();
    const attributes = response.headers.getSetCookie().join(";");
    expect(attributes).toMatch(/HttpOnly/i);
    expect(attributes).toMatch(/SameSite=Strict/i);
    expect(attributes).toContain("Path=/api/local-auth");
    expect(cookie).toContain("lms_local_auth");
    expect(cookie).not.toContain("lms_demo");
    expect(await response.json()).toEqual({ success: true });
    expect(await host.principal(new Headers({ cookie }))).toEqual({
      userId: owner,
    });
    const visible = await host.handle(
      request("/get-session", undefined, cookie),
    );
    expect(visible.headers.get("cache-control")).toBe("private, no-store");
    const payload = await visible.json();
    expect(payload.user.id).toBe(owner);
    expect(payload.session.token).toBeUndefined();
    const hashes = (
      await admin.query("select password from lms_identity.account")
    ).rows;
    expect(hashes).toHaveLength(2);
    expect(
      hashes.every((row) => row.password && row.password !== password),
    ).toBe(true);
    const principal = await host.principal(new Headers({ cookie }));
    expect((await engine.snapshot(principal!, org)).records[0].data.name).toBe(
      "Private fictional business record",
    );
  });
  it("rejects incorrect credentials, tampering, forged identity and unknown signup/recovery actions", async () => {
    const bad = await host.handle(
      request("/sign-in/email", {
        email: "owner@example.test",
        password: "wrong_password",
      }),
    );
    const unknown = await host.handle(
      request("/sign-in/email", {
        email: "unknown@example.test",
        password: "wrong_password",
      }),
    );
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await bad.json()).toEqual(await unknown.json());
    await expect(
      provisionFictionalAccount(options, {
        name: "Duplicate",
        email: "owner@example.test",
        password,
      }),
    ).rejects.toThrow();
    const { cookie } = await login();
    expect(
      await host.principal(new Headers({ cookie: cookie + "tampered" })),
    ).toBeNull();
    expect(
      await host.principal(
        new Headers({
          cookie: "lms_demo=pretend",
          "x-user-id": owner,
          authorization: "Bearer pretend",
        }),
      ),
    ).toBeNull();
    expect(
      (
        await host.handle(
          request("/sign-up/email", {
            email: "new@example.test",
            password,
            name: "Unauthorized",
          }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await host.handle(
          request("/request-password-reset", { email: "owner@example.test" }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await host.handle(
          request("/sign-in/email", {
            email: "owner@example.test",
            password,
            role: "owner",
            callbackURL: "https://attacker.invalid",
          }),
        )
      ).status,
    ).toBe(400);
  });
  it("enforces origin/content/size boundaries and blocks forwarding-header bypasses", async () => {
    expect(
      (
        await host.handle(
          request(
            "/sign-in/email",
            { email: "owner@example.test", password },
            "",
            { origin: "https://attacker.invalid" },
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await host.handle(
          request(
            "/sign-in/email",
            { email: "owner@example.test", password },
            "",
            { origin: "" },
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await host.handle(
          request("/get-session", undefined, "", {
            "sec-fetch-site": "same-site",
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await host.handle(
          new Request(options.origin + "/api/local-auth/sign-in/email", {
            method: "POST",
            headers: { origin: options.origin, "content-type": "text/plain" },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await host.handle(
          request("/sign-in/email", { value: "x".repeat(9000) }),
        )
      ).status,
    ).toBe(413);
    expect(
      (await host.handle(request("/get-session?userId=" + owner))).status,
    ).toBe(404);
  });
  it("revokes sign-out, other sessions and all sessions on the next database validation", async () => {
    const first = await login(),
      second = await login();
    expect(first.cookie).not.toBe(second.cookie);
    expect(
      (await host.handle(request("/revoke-other-sessions", {}, second.cookie)))
        .status,
    ).toBe(200);
    expect(
      await host.principal(new Headers({ cookie: first.cookie })),
    ).toBeNull();
    expect(
      await host.principal(new Headers({ cookie: second.cookie })),
    ).toEqual({ userId: owner });
    const third = await login();
    expect(
      (await host.handle(request("/revoke-sessions", {}, third.cookie))).status,
    ).toBe(200);
    expect(
      await host.principal(new Headers({ cookie: second.cookie })),
    ).toBeNull();
    expect(
      await host.principal(new Headers({ cookie: third.cookie })),
    ).toBeNull();
    const last = await login();
    expect(
      (await host.handle(request("/sign-out", {}, last.cookie))).status,
    ).toBe(200);
    expect(
      await host.principal(new Headers({ cookie: last.cookie })),
    ).toBeNull();
  });
  it("rejects expired sessions and a changed secret; session checks do not renew absolute lifetime", async () => {
    const { cookie } = await login();
    const before = (
      await admin.query('select "expiresAt" from lms_identity.session')
    ).rows[0].expiresAt;
    await host.principal(new Headers({ cookie }));
    expect(
      (await admin.query('select "expiresAt" from lms_identity.session'))
        .rows[0].expiresAt,
    ).toEqual(before);
    const rotated = await createLocalAuth({
      ...options,
      secret: randomBytes(32).toString("hex"),
    });
    try {
      expect(await rotated.principal(new Headers({ cookie }))).toBeNull();
    } finally {
      await rotated.close();
    }
    await admin.query(
      "update lms_identity.session set \"expiresAt\"=now()-interval '1 minute'",
    );
    expect(await host.principal(new Headers({ cookie }))).toBeNull();
  });
  it("retains sessions across independent auth processes and enforces database membership separately", async () => {
    const { cookie } = await login();
    const result = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import=tsx", "scripts/postgres/auth-probe.ts", name],
        {
          env: {
            ...process.env,
            LMS_TEST_AUTH_URL: options.databaseUrl,
            LMS_TEST_AUTH_ORIGIN: options.origin,
            LMS_TEST_AUTH_SECRET: options.secret,
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let output = "";
      child.stdout.on("data", (c) => (output += c));
      child.stderr.resume();
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0
          ? resolve(output)
          : reject(new Error("Independent identity probe failed")),
      );
      child.stdin.end(cookie);
    });
    expect(JSON.parse(result)).toEqual({ userId: owner });
    const other = await login("outsider@example.test");
    const outsiderPrincipal = await host.principal(
      new Headers({ cookie: other.cookie }),
    );
    expect(outsiderPrincipal).toEqual({ userId: outsider });
    await expect(
      engine.snapshot(outsiderPrincipal!, org),
    ).rejects.toMatchObject({ status: 403 });
    await admin.query(
      "delete from lms.memberships where organization_id=$1 and user_id=$2",
      [org, owner],
    );
    try {
      await expect(
        engine.snapshot((await host.principal(new Headers({ cookie })))!, org),
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      await admin.query("insert into lms.memberships values($1,$2,'owner')", [
        org,
        owner,
      ]);
    }
  });
  it("shares persistent throttles across instances and ignores client-supplied IP headers", async () => {
    const responses = await Promise.all(
      Array.from({ length: 7 }, (_, i) =>
        host.handle(
          request(
            "/sign-in/email",
            { email: "owner@example.test", password: "wrong_password" },
            "",
            {
              "x-forwarded-for": `192.0.2.${i}`,
              "x-lms-local-bucket": `198.51.100.${i}`,
            },
          ),
        ),
      ),
    );
    expect(responses.filter((r) => r.status === 401)).toHaveLength(5);
    expect(responses.filter((r) => r.status === 429)).toHaveLength(2);
    const fresh = await createLocalAuth(options);
    try {
      expect(
        (
          await fresh.handle(
            request("/sign-in/email", {
              email: "owner@example.test",
              password,
            }),
          )
        ).status,
      ).toBe(429);
    } finally {
      await fresh.close();
    }
  });
  it("separates identity credentials from business storage and emits Secure cookies for HTTPS configuration", async () => {
    await expect(
      engine.asUser({ userId: owner }, (tx) =>
        tx.query("select * from lms_identity.session"),
      ),
    ).rejects.toThrow(/permission denied/i);
    const client = new Client({
      connectionString: url(name, "auth"),
      options: "-c role=lms_auth_service",
    });
    await client.connect();
    try {
      await expect(client.query("select * from lms.records")).rejects.toThrow(
        /permission denied/i,
      );
      await expect(
        client.query("select * from lms_meta.migrations"),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await client.end();
    }
    const secure = await createLocalAuth({
      ...options,
      origin: "https://localhost:3200",
    });
    try {
      const response = await secure.handle(
        request(
          "/sign-in/email",
          { email: "owner@example.test", password },
          "",
          undefined,
          "https://localhost:3200",
        ),
      );
      expect(response.status).toBe(200);
      expect(response.headers.getSetCookie().join(";")).toMatch(/; Secure/i);
    } finally {
      await secure.close();
    }
  });
  it("restores identity accounts but never revives backup sessions or verification tokens", async () => {
    const { cookie } = await login();
    expect(await host.principal(new Headers({ cookie }))).toEqual({
      userId: owner,
    });
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "lms-auth-restore-"),
    );
    try {
      const archive = path.join(directory, "identity.dump");
      await backupDatabase(url(name), name, archive, process.env.LMS_PG_BIN);
      await restoreDatabase(
        url(restoreName),
        restoreName,
        archive,
        process.env.LMS_PG_BIN,
      );
      await expect(
        createLocalAuth({
          ...options,
          databaseUrl: url(restoreName, "auth"),
          databaseName: restoreName,
        }),
      ).rejects.toThrow(/activation blocked/i);
      const verifier = new Client({ connectionString: url(restoreName) });
      await verifier.connect();
      try {
        expect(
          (await verifier.query("select * from lms_identity.account")).rows,
        ).toHaveLength(2);
        expect(await offlinePassword(verifier, owner, password)).toBe(true);
        expect(
          (await verifier.query("select blocked from lms_control.state"))
            .rows[0].blocked,
        ).toBe(true);
        expect(
          (await verifier.query("select * from lms_identity.session")).rows,
        ).toHaveLength(0);
        expect(
          (await verifier.query("select * from lms_identity.verification"))
            .rows,
        ).toHaveLength(0);
      } finally {
        await verifier.end();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
