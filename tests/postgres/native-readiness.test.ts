import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Client } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import * as backup from "../../src/server/postgres/backup";
import {
  nativeReadiness,
  nativeTrustSchema,
  nativeRehearsalConfirmation,
  type NativeReadinessOptions,
} from "../../src/server/postgres/native-readiness";
import { offlineEngine } from "./offline-inspection";
import { localTarget } from "../../src/server/postgres/targets";
import {
  migrate,
  provisionRuntime,
  provisionAuthRuntime,
} from "../../src/server/postgres/migrations";
import { connectPostgres } from "../../src/server/postgres/adapter";
import {
  provisionFictionalAccount,
  createLocalAuth,
} from "../../src/server/auth/host";
import { Engine } from "../../src/core/engine";
import { sampleRecords } from "../../src/presets";
import { seedSchedule } from "../../src/presets/schedule-samples";
import { seedInventory } from "../../src/presets/inventory-samples";
import { seedPricing } from "../../src/presets/pricing-samples";
import { defaultBranding } from "../../src/core/branding";
import { planForConfig, brandBuildPlan } from "../../src/core/buildplan";
import { seedFictional } from "../../scripts/postgres/fixture";
const raw = process.env.LMS_TEST_ADMIN_URL;
if (!raw)
  throw new Error(
    "LMS_TEST_ADMIN_URL is required; native readiness tests never skip.",
  );
const controlName = decodeURIComponent(new URL(raw).pathname.slice(1)),
  control = localTarget(raw, controlName);
if (!controlName.startsWith("lms_test_"))
  throw new Error("Use a disposable fictional test control.");
let cluster: Client,
  sourceName: string,
  targetName: string,
  directory: string,
  options: NativeReadinessOptions,
  trust: ReturnType<typeof nativeTrustSchema.parse>,
  fixture: Awaited<ReturnType<typeof seedFictional>>;
function url(name: string, role = "admin") {
  const u = new URL(control);
  u.pathname = "/" + name;
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
async function using<T>(name: string, fn: (c: Client) => Promise<T>) {
  const c = new Client({
    connectionString: url(name),
    statement_timeout: 10000,
  });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
async function savedTrust() {
  await writeFile(options.trustFile, JSON.stringify(trust), { mode: 0o600 });
}
async function sourceState() {
  return using(
    sourceName,
    async (c) =>
      (
        await c.query(`select jsonb_build_array(
 (select jsonb_agg(to_jsonb(t) order by t.id) from lms.records t),
 (select jsonb_agg(to_jsonb(t) order by t.organization_id,t.revision) from lms.config_revisions t),
 (select jsonb_agg(to_jsonb(t) order by t.id) from lms.audit_events t),
 (select jsonb_agg(to_jsonb(t) order by t.organization_id,t.user_id) from lms.memberships t),
 (select jsonb_agg(to_jsonb(t) order by t.id) from lms_identity.account t),
 (select jsonb_agg(to_jsonb(t) order by t.id,t.revision) from lms.build_plan_revisions t)
 )::text as value`)
      ).rows[0].value,
  );
}
async function blockedTarget() {
  expect(
    await using(
      targetName,
      async (c) =>
        (
          await c.query(
            "select exists(select 1 from pg_db_role_setting s where s.setdatabase=(select oid from pg_database where datname=current_database()) and s.setrole=0 and 'lms.restore_blocked=on'=any(s.setconfig)) as blocked",
          )
        ).rows[0].blocked,
    ),
  ).toBe(true);
  await expect(
    connectPostgres({ connectionString: url(targetName, "runtime") }),
  ).rejects.toThrow(/activation blocked/i);
}
beforeAll(async () => {
  cluster = new Client({ connectionString: control.toString() });
  await cluster.connect();
});
beforeEach(async () => {
  const suffix = randomBytes(5).toString("hex");
  sourceName = "lms_test_native_" + suffix;
  targetName = "lms_restore_native_" + suffix;
  for (const name of [sourceName, targetName])
    await cluster.query(`create database "${name}"`);
  directory = await mkdtemp(path.join(os.tmpdir(), "lms-native-pg-"));
  await using(sourceName, async (c) => {
    await migrate(c);
    await provisionRuntime(c, url(sourceName, "runtime"));
    fixture = await seedFictional(c, url(sourceName, "runtime"));
    trust = {
      format: "lms-native-readiness-trust",
      version: 1,
      environment: "ci-fictional-test",
      fictionalOnly: true,
      maintenanceRole: decodeURIComponent(control.username),
      source: {
        database: sourceName,
        instanceId: (await c.query("select instance_id from lms_control.state"))
          .rows[0].instance_id,
        organizations: [fixture.property, fixture.cleaning],
      },
      target: { database: targetName },
    };
  });
  options = {
    mode: "rehearse",
    trustFile: path.join(directory, "trust.json"),
    sourceUrl: url(sourceName),
    targetUrl: url(targetName),
    workDirectory: directory,
    confirmation: nativeRehearsalConfirmation,
    binDirectory: process.env.LMS_PG_BIN,
  };
  await savedTrust();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const name of [sourceName, targetName])
    if (name)
      await cluster.query(`drop database if exists "${name}" with (force)`);
  if (directory) await rm(directory, { recursive: true, force: true });
});
afterAll(async () => {
  await cluster?.end();
});
describe("host-only native upgrade readiness", () => {
  it("preflight is read-only, checks supported state and never claims a verified restore", async () => {
    const before = await sourceState(),
      result = await nativeReadiness({ ...options, mode: "preflight" });
    expect(result.result).toBe("preflight-complete");
    expect(result.backupReadiness).toBe("not-verified");
    expect(result.versions).toMatchObject({
      source: { postgresMajor: 16, migration: 12, configurationSchemas: [1] },
      target: { postgresMajor: 16, migration: null, configurationSchemas: [] },
      destination: "same-schema-copy-only",
    });
    expect(result.checks.find((c) => c.id === "restore")!.status).toBe(
      "not-run",
    );
    expect(await sourceState()).toBe(before);
    expect(await readdir(directory)).toEqual(["trust.json"]);
  });
  it("native round-trip preserves both industries, v1/v2 history, stock, exact estimates, scheduling, workforce and credentials without activation", async () => {
    const db = await connectPostgres({
        connectionString: url(sourceName, "runtime"),
      }),
      engine = new Engine(db);
    try {
      for (const [org, user, industry] of [
        [fixture.property, fixture.owner, "property"],
        [fixture.cleaning, fixture.other, "cleaning"],
      ] as const) {
        const p = { userId: user };
        for (const r of sampleRecords[industry])
          await engine.saveRecord(p, org, r.entity, r.data);
        await seedSchedule(engine, p, org);
        await seedPricing(engine, p, org);
        await seedInventory(engine, p, org);
        const snap = await engine.snapshot(p, org),
          v1 = planForConfig(snap.config.document),
          v2 = brandBuildPlan(v1, defaultBranding(industry)),
          draft = randomUUID();
        await engine.saveBuildPlan(p, org, v1, draft, 0, 1);
        await engine.saveBuildPlan(p, org, v2, draft, 1, 1);
        await engine.publishConfig(p, org, v2.configuration, 1);
        const archived = await engine.saveRecord(p, org, "customers", {
          name: "PRIVATE ARCHIVED NATIVE",
        });
        await engine.archiveRecord(
          p,
          org,
          archived.id,
          archived.revision,
          true,
        );
      }
    } finally {
      await db.close();
    }
    await using(sourceName, (c) =>
      provisionAuthRuntime(c, url(sourceName, "auth")),
    );
    const authOptions = {
      databaseUrl: url(sourceName, "auth"),
      databaseName: sourceName,
      origin: "http://127.0.0.1:3200",
      secret: randomBytes(32).toString("hex"),
    };
    const account = await provisionFictionalAccount(authOptions, {
      name: "Private fictional identity",
      email: "native@example.test",
      password: "fictional_native_password_never_report",
    });
    await using(sourceName, (c) =>
      c.query(
        'insert into lms_identity.session(id,"expiresAt",token,"userId") values($1,now()+interval \'1 hour\',$2,$3)',
        [randomUUID(), "PRIVATE_NATIVE_TOKEN", account.userId],
      ),
    );
    const before = await sourceState(),
      result = await nativeReadiness(options);
    expect(result.result).toBe("rehearsal-complete");
    expect(result.backupReadiness).toBe("verified-fictional-round-trip");
    expect(result.checks.every((c) => c.status === "passed")).toBe(true);
    expect(result.versions.source.configurationSchemas).toEqual([1, 2]);
    expect(result.versions.source.buildPlanVersions).toEqual([1, 2]);
    expect(result.versions.target).toEqual(result.versions.source);
    expect(await sourceState()).toBe(before);
    await blockedTarget();
    await expect(
      createLocalAuth({
        ...authOptions,
        databaseUrl: url(targetName, "auth"),
        databaseName: targetName,
      }),
    ).rejects.toThrow(/activation blocked/i);
    await using(targetName, async (c) => {
      const restored = offlineEngine(c);
      await expect(
        restored.snapshot({ userId: fixture.other }, fixture.property),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        (
          await restored.asUser({ userId: fixture.other }, (tx) =>
            tx.query("select * from lms.records where organization_id=$1", [
              fixture.property,
            ]),
          )
        ).rows,
      ).toEqual([]);
    });
    expect(
      await using(
        targetName,
        async (c) =>
          (await c.query("select count(*)::int as n from lms_identity.session"))
            .rows[0].n,
      ),
    ).toBe(0);
    expect(
      await using(
        sourceName,
        async (c) =>
          (await c.query("select count(*)::int as n from lms_identity.session"))
            .rows[0].n,
      ),
    ).toBe(1);
    expect(await readdir(directory)).toEqual(["trust.json"]);
    const text = JSON.stringify(result);
    for (const value of [
      sourceName,
      targetName,
      fixture.owner,
      fixture.property,
      trust.source.instanceId,
      "PRIVATE_NATIVE_TOKEN",
      "PRIVATE ARCHIVED NATIVE",
      "fictional_native_password_never_report",
      "signatures",
      "catalog",
      control.password,
    ])
      expect(text).not.toContain(value);
  });
  it("refuses missing confirmation, incorrect instance evidence and undeclared organizations", async () => {
    const before = await sourceState();
    expect(
      (await nativeReadiness({ ...options, confirmation: "" })).result,
    ).toBe("blocked");
    const original = structuredClone(trust);
    trust.source.instanceId = randomUUID();
    await savedTrust();
    expect((await nativeReadiness(options)).result).toBe("blocked");
    trust = original;
    trust.source.organizations = [fixture.property];
    await savedTrust();
    expect((await nativeReadiness(options)).result).toBe("blocked");
    expect(await sourceState()).toBe(before);
    expect(await readdir(directory)).toEqual(["trust.json"]);
  });
  it("refuses runtime authority even when an allowlist names that role", async () => {
    trust.maintenanceRole = "lms_runtime";
    await savedTrust();
    const before = await sourceState();
    const result = await nativeReadiness({
      ...options,
      sourceUrl: url(sourceName, "runtime"),
      targetUrl: url(targetName, "runtime"),
    });
    expect(result.result).toBe("blocked");
    expect(result.checks[0].status).toBe("blocked");
    expect(await sourceState()).toBe(before);
  });
  it("refuses a previously blocked source without clearing or claiming credential-lineage acceptance", async () => {
    await using(sourceName, (c) =>
      c.query(
        "update lms_control.state set blocked=true,reason='recovery-pending'",
      ),
    );
    const before = await sourceState(),
      result = await nativeReadiness(options);
    expect(result.result).toBe("blocked");
    expect(result.checks.find((c) => c.id === "configuration")?.status).toBe(
      "blocked",
    );
    expect(await sourceState()).toBe(before);
    expect(await readdir(directory)).toEqual(["trust.json"]);
  });
  it("refuses active runtime hosts and unknown destination connections", async () => {
    const host = await connectPostgres({
      connectionString: url(sourceName, "runtime"),
    });
    try {
      expect(
        (await nativeReadiness(options)).checks.find((c) => c.id === "offline")
          ?.status,
      ).toBe("blocked");
    } finally {
      await host.close();
    }
    await using(targetName, async () => {
      const result = await nativeReadiness(options);
      expect(result.result).toBe("blocked");
      expect(result.checks.find((c) => c.id === "target")?.status).toBe(
        "blocked",
      );
    });
    expect(await readdir(directory)).toEqual(["trust.json"]);
  });
  it("refuses populated destinations and mismatched names without overwriting either database", async () => {
    await using(targetName, (c) =>
      c.query(
        "create table public.keep_me(value text); insert into public.keep_me values('PRIVATE_TARGET')",
      ),
    );
    const before = await sourceState();
    expect((await nativeReadiness(options)).result).toBe("blocked");
    expect(
      (await nativeReadiness({ ...options, targetUrl: options.sourceUrl }))
        .result,
    ).toBe("blocked");
    expect(
      await using(
        targetName,
        async (c) =>
          (await c.query("select value from public.keep_me")).rows[0].value,
      ),
    ).toBe("PRIVATE_TARGET");
    expect(await sourceState()).toBe(before);
  });
  it("refuses unknown migration history and unsupported configuration versions without executing migration SQL", async () => {
    await using(sourceName, (c) =>
      c.query(
        "insert into lms_meta.migrations(version,name,checksum) values(13,'future','unsupported')",
      ),
    );
    const before = await sourceState();
    expect(
      (await nativeReadiness(options)).checks.find((c) => c.id === "schema")
        ?.status,
    ).toBe("blocked");
    expect(await sourceState()).toBe(before);
    await using(sourceName, async (c) => {
      await c.query("delete from lms_meta.migrations where version=13");
      await c.query("set session_replication_role=replica");
      await c.query(
        "update lms.config_revisions set document=jsonb_set(document,'{schemaVersion}','99')",
      );
      await c.query("set session_replication_role=origin");
    });
    const corrupted = await sourceState();
    expect(
      (await nativeReadiness(options)).checks.find(
        (c) => c.id === "configuration",
      )?.status,
    ).toBe("blocked");
    expect(await sourceState()).toBe(corrupted);
  });
  it.each(["corrupt", "incomplete"])(
    "%s native archives never produce success and leave durable quarantine",
    async (kind) => {
      const original = backup.backupDatabase;
      vi.spyOn(backup, "backupDatabase").mockImplementation(async (...args) => {
        await original(...args);
        const bytes = await readFile(args[2]);
        await writeFile(
          args[2],
          kind === "corrupt"
            ? Buffer.from("NOT_A_DUMP")
            : bytes.subarray(0, Math.floor(bytes.length / 2)),
        );
      });
      const before = await sourceState(),
        result = await nativeReadiness(options);
      expect(result.result).toBe("blocked");
      expect(result.backupReadiness).toBe("not-verified");
      await blockedTarget();
      expect(await sourceState()).toBe(before);
      expect(await readdir(directory)).toEqual(["trust.json"]);
    },
  );
  it("interrupted execution cleans its archive and cannot report a partial restore as ready", async () => {
    const controller = new AbortController(),
      original = backup.backupDatabase;
    vi.spyOn(backup, "backupDatabase").mockImplementation(async (...args) => {
      await original(...args);
      controller.abort();
    });
    const before = await sourceState(),
      result = await nativeReadiness({ ...options, signal: controller.signal });
    expect(result.result).toBe("blocked");
    expect(result.backupReadiness).toBe("not-verified");
    expect(await sourceState()).toBe(before);
    expect(await readdir(directory)).toEqual(["trust.json"]);
  });
  it("read fences block a competing raw write and a second coordinator without changing source history", async () => {
    const original = backup.backupDatabase;
    let competing: string | undefined;
    vi.spyOn(backup, "backupDatabase").mockImplementation(async (...args) => {
      await using(sourceName, async (c) => {
        await c.query("set lock_timeout='150ms'");
        await expect(
          c.query("insert into lms.users values($1,'PRIVATE_DENIED')", [
            randomUUID(),
          ]),
        ).rejects.toThrow(/lock timeout/i);
      });
      competing = (await nativeReadiness({ ...options, mode: "preflight" }))
        .result;
      await original(...args);
    });
    const before = await sourceState(),
      result = await nativeReadiness(options);
    expect(result.result).toBe("rehearsal-complete");
    expect(competing).toBe("blocked");
    expect(await sourceState()).toBe(before);
  });
  it("verification failure retains quarantine and strips raw errors", async () => {
    const original = backup.restoreDatabase;
    vi.spyOn(backup, "restoreDatabase").mockImplementation(
      async (a, b, c, d, control) =>
        original(a, b, c, d, {
          ...control,
          verify: async (client) => {
            await client.query(
              "insert into lms.users values($1,'PRIVATE_ALTERED_TARGET')",
              [randomUUID()],
            );
            await control?.verify?.(client);
          },
        }),
    );
    const before = await sourceState(),
      result = await nativeReadiness(options);
    expect(result.result).toBe("blocked");
    expect(result.checks.find((c) => c.id === "integrity")?.status).toBe(
      "blocked",
    );
    expect(JSON.stringify(result)).not.toContain("PRIVATE_ALTERED_TARGET");
    expect(await sourceState()).toBe(before);
    await blockedTarget();
  });
  it("cleanup failure refuses readiness even after a verified restore, preserves private evidence and refuses destination reuse", async () => {
    const original = backup.backupDatabase;
    vi.spyOn(backup, "backupDatabase").mockImplementation(async (...args) => {
      await original(...args);
      await writeFile(
        path.join(path.dirname(args[2]), "keep-private"),
        "PRIVATE_CLEANUP",
        { mode: 0o600 },
      );
    });
    const before = await sourceState(),
      result = await nativeReadiness(options);
    expect(result.result).toBe("blocked");
    expect(result.backupReadiness).toBe("not-verified");
    expect(result.checks.find((c) => c.id === "cleanup")?.status).toBe(
      "blocked",
    );
    expect(await sourceState()).toBe(before);
    await blockedTarget();
    const kept = (await readdir(directory)).find((n) =>
      n.startsWith("lms-native-rehearsal-"),
    )!;
    expect(await readdir(path.join(directory, kept))).toEqual(["keep-private"]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_CLEANUP");
    expect((await nativeReadiness(options)).result).toBe("blocked");
  });
});
