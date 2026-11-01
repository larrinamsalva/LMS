import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  it,
  expect,
  vi,
} from "vitest";
import { Client } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  UpgradeLifecycle,
  type UpgradeOptions,
} from "../../src/server/postgres/upgrade-lifecycle";
import { nativeRehearsalConfirmation } from "../../src/server/postgres/native-readiness";
import { observeNative } from "../../src/server/postgres/readiness-inspection";
import { localTarget } from "../../src/server/postgres/targets";
import {
  migrate,
  provisionRuntime,
} from "../../src/server/postgres/migrations";
import { connectPostgres } from "../../src/server/postgres/adapter";
import { seedFictional } from "../../scripts/postgres/fixture";
import { offlineEngine } from "./offline-inspection";
import { presets } from "../../src/presets";
import {
  planForConfig,
  addCustomField,
  brandBuildPlan,
} from "../../src/core/buildplan";
import { defaultBranding } from "../../src/core/branding";
import { canonical, digest } from "../../src/server/recovery/trust";
import * as backup from "../../src/server/postgres/backup";
const raw = process.env.LMS_TEST_ADMIN_URL;
if (!raw)
  throw new Error(
    "Native upgrade tests require a disposable PostgreSQL control; never skipped.",
  );
const controlName = decodeURIComponent(new URL(raw).pathname.slice(1)),
  control = localTarget(raw, controlName);
if (!controlName.startsWith("lms_test_"))
  throw new Error("Fictional control required");
let cluster: Client,
  sourceName: string,
  targetName: string,
  directory: string,
  options: UpgradeOptions,
  f: Awaited<ReturnType<typeof seedFictional>>;
function url(name: string, runtime = false) {
  const u = new URL(control);
  u.pathname = "/" + name;
  if (runtime) {
    u.username = "lms_runtime";
    u.password =
      process.env.LMS_TEST_RUNTIME_PASSWORD ??
      "fictional_test_password_24_characters";
  }
  return u.toString();
}
async function using<T>(name: string, fn: (c: Client) => Promise<T>) {
  const c = new Client({
    connectionString: url(name),
    options: "-c timezone=UTC -c datestyle=ISO,MDY",
  });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
const snapshot = () =>
  using(sourceName, (c) => observeNative(c, Buffer.alloc(32, 1)));
function request() {
  const plan = planForConfig(presets.property);
  plan.configuration = addCustomField(plan.configuration, "customers", {
    key: "extra_upgrade",
    label: "Service preference",
    type: "text",
    required: false,
  });
  return { actorId: f.owner, organizationId: f.property, document: plan };
}
async function prepared() {
  const p = await new UpgradeLifecycle(options).prepare(request());
  return {
    p,
    w: new UpgradeLifecycle({ ...options, rootDigest: p.rootDigest }),
  };
}
async function blocked() {
  await expect(
    connectPostgres({ connectionString: url(targetName, true) }),
  ).rejects.toThrow(/activation blocked/i);
}
beforeAll(async () => {
  cluster = new Client({ connectionString: control.toString() });
  await cluster.connect();
});
beforeEach(async () => {
  const suffix = randomBytes(5).toString("hex");
  sourceName = "lms_test_upgrade_" + suffix;
  targetName = "lms_restore_upgrade_" + suffix;
  for (const n of [sourceName, targetName])
    await cluster.query(`create database "${n}"`);
  directory = await mkdtemp(path.join(os.tmpdir(), "lms-upgrade-pg-"));
  for (const n of ["store", "work"])
    await mkdir(path.join(directory, n), { mode: 0o700 });
  const trustFile = path.join(directory, "trust.json");
  await using(sourceName, async (c) => {
    await migrate(c);
    await provisionRuntime(c, url(sourceName, true));
    f = await seedFictional(c, url(sourceName, true));
    await writeFile(
      trustFile,
      JSON.stringify({
        format: "lms-native-readiness-trust",
        version: 1,
        environment: "upgrade-ci",
        fictionalOnly: true,
        maintenanceRole: decodeURIComponent(control.username),
        source: {
          database: sourceName,
          instanceId: (
            await c.query("select instance_id from lms_control.state")
          ).rows[0].instance_id,
          organizations: [f.property, f.cleaning],
        },
        target: { database: targetName },
      }),
      { mode: 0o600 },
    );
  });
  options = {
    directory: path.join(directory, "store"),
    native: {
      sourceUrl: url(sourceName),
      targetUrl: url(targetName),
      trustFile,
      workDirectory: path.join(directory, "work"),
      binDirectory: process.env.LMS_PG_BIN,
    },
  };
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const n of [sourceName, targetName])
    if (n) await cluster.query(`drop database if exists "${n}" with(force)`);
  if (directory) await rm(directory, { recursive: true, force: true });
});
afterAll(async () => {
  await cluster?.end();
});
it("prepares, copies, inspects and logically retires without publishing the populated proposal or changing source", async () => {
  const before = await snapshot(),
    { p, w } = await prepared();
  expect(p.lifecycle).toBe("newly-prepared");
  expect(p.blueprint?.overall).toBe("migration-review");
  expect(
    p.blueprint?.operations.some((o) => o.kind === "optional-field-addition"),
  ).toBe(true);
  const copy = await w.copy(p.headDigest, nativeRehearsalConfirmation);
  expect(copy.lifecycle, JSON.stringify(copy)).toBe(
    "quarantined-for-inspection",
  );
  await blocked();
  const inspected = await w.inspect(copy.headDigest);
  expect(inspected.lifecycle).toBe("inspection-completed");
  const retired = await w.inspect(
    inspected.headDigest,
    "RETIRE FICTIONAL COPY TRACKING",
  );
  expect(retired.lifecycle).toBe("retired");
  await blocked();
  expect(await snapshot()).toEqual(before);
  expect(
    await using(
      targetName,
      async (c) =>
        (
          await c.query(
            "select document from lms.config_revisions where organization_id=$1 order by revision desc limit 1",
            [f.property],
          )
        ).rows[0].document,
    ),
  ).toEqual(presets.property);
  const out = JSON.stringify(retired);
  for (const value of [
    f.owner,
    f.property,
    sourceName,
    targetName,
    "Durable Fictional Customer",
    "signatures",
    control.password,
  ])
    expect(out).not.toContain(value);
  expect(retired.executionAuthorized).toBe(false);
  expect(await readdir(options.native.workDirectory)).toEqual([]);
});
it("legacy and branded proposals remain design-only, including compatible presentation changes", async () => {
  const input = {
    ...request(),
    document: brandBuildPlan(
      planForConfig(presets.property),
      defaultBranding("property"),
    ),
  };
  const before = await snapshot(),
    p = await new UpgradeLifecycle(options).prepare(input);
  expect(p.blueprint?.overall).toBe("compatible");
  expect(p.blueprint?.configurations.proposed.version).toBe(2);
  expect(p.blueprint?.configurations.current.schemaVersion).toBe(1);
  expect(await snapshot()).toEqual(before);
});
it("archived data remains a blocker and stale saved draft revisions refuse copy", async () => {
  const draft = randomUUID(),
    input = { ...request(), draft: { id: draft, revision: 1 } };
  await using(sourceName, async (c) => {
    const e = offlineEngine(c),
      snap = await e.snapshot({ userId: f.owner }, f.property);
    for (const r of snap.records)
      if (r.entity === "customers")
        await e.archiveRecord(
          { userId: f.owner },
          f.property,
          r.id,
          r.revision,
          true,
        );
    await e.saveBuildPlan(
      { userId: f.owner },
      f.property,
      input.document,
      draft,
      0,
      1,
    );
  });
  const p = await new UpgradeLifecycle(options).prepare(input);
  expect(p.blueprint?.overall).toBe("migration-review");
  await using(sourceName, async (c) => {
    const changed = structuredClone(input.document);
    changed.configuration.name = "New draft revision";
    await offlineEngine(c).saveBuildPlan(
      { userId: f.owner },
      f.property,
      changed,
      draft,
      1,
      1,
    );
  });
  const before = await snapshot(),
    w = new UpgradeLifecycle({ ...options, rootDigest: p.rootDigest }),
    result = await w.copy(p.headDigest, nativeRehearsalConfirmation);
  expect(result.lifecycle).toBe("blocked-pending-manual-disposition");
  expect(await snapshot()).toEqual(before);
  expect(await readdir(options.native.workDirectory)).toEqual([]);
});
it("source configuration changes make an existing blueprint stale without altering its original history", async () => {
  const { p, w } = await prepared();
  await using(sourceName, (c) =>
    offlineEngine(c).publishConfig(
      { userId: f.owner },
      f.property,
      { ...presets.property, name: "Changed current revision" },
      1,
    ),
  );
  const before = await snapshot(),
    out = await w.copy(p.headDigest, nativeRehearsalConfirmation);
  expect(out.lifecycle).toBe("blocked-pending-manual-disposition");
  expect(await snapshot()).toEqual(before);
});
it("wrong organization authority and unsupported requests fail without copying", async () => {
  const before = await snapshot();
  for (const input of [
    { ...request(), actorId: f.other },
    { ...request(), organizationId: randomUUID() },
    { ...request(), sql: "execute" },
  ]) {
    const store = path.join(directory, randomUUID());
    await mkdir(store, { mode: 0o700 });
    await expect(
      new UpgradeLifecycle({ ...options, directory: store }).prepare(input),
    ).rejects.toThrow();
  }
  expect(await snapshot()).toEqual(before);
});
it("recreated destination identities refuse even under the same allowlisted name", async () => {
  const { p, w } = await prepared();
  await cluster.query(`drop database "${targetName}"`);
  await cluster.query(`create database "${targetName}"`);
  const before = await snapshot();
  expect(
    (await w.copy(p.headDigest, nativeRehearsalConfirmation)).lifecycle,
  ).toBe("blocked-pending-manual-disposition");
  expect(await snapshot()).toEqual(before);
});
it("changed quarantined copies cannot complete inspection or authorize activation", async () => {
  const { p, w } = await prepared(),
    copy = await w.copy(p.headDigest, nativeRehearsalConfirmation);
  expect(copy.lifecycle).toBe("quarantined-for-inspection");
  await using(targetName, (c) =>
    c.query("insert into lms.users values($1,'PRIVATE COPY CHANGE')", [
      randomUUID(),
    ]),
  );
  const before = await snapshot();
  const failed = await w.inspect(copy.headDigest);
  expect(failed.lifecycle).toBe("blocked-pending-manual-disposition");
  expect(JSON.stringify(failed)).not.toContain("PRIVATE COPY CHANGE");
  expect(await snapshot()).toEqual(before);
  await blocked();
});
it("durable but unacknowledged copied events remain pending, reject stale heads and never replay", async () => {
  const { p } = await prepared();
  class Crash extends UpgradeLifecycle {
    protected async afterDurabilityStep(s: string) {
      if (s === "verified-copied-state") throw new Error("interrupted");
    }
  }
  const w = new Crash({ ...options, rootDigest: p.rootDigest }),
    before = await snapshot();
  await expect(
    w.copy(p.headDigest, nativeRehearsalConfirmation),
  ).rejects.toThrow();
  await blocked();
  await expect(w.status(p.headDigest)).rejects.toThrow();
  const event = JSON.parse(
      await readFile(path.join(options.directory, "002.json"), "utf8"),
    ),
    head = digest(canonical(event));
  expect((await w.status(head)).lifecycle).toBe(
    "blocked-pending-manual-disposition",
  );
  await expect(w.copy(head, nativeRehearsalConfirmation)).rejects.toThrow();
  expect(await snapshot()).toEqual(before);
});
it("competing copy operations produce one verified copy and no duplicate lifecycle history", async () => {
  const { p, w } = await prepared(),
    before = await snapshot();
  const results = await Promise.allSettled([
    w.copy(p.headDigest, nativeRehearsalConfirmation),
    w.copy(p.headDigest, nativeRehearsalConfirmation),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(
    (await readdir(options.directory)).filter((n) => /^\d/.test(n)),
  ).toHaveLength(3);
  expect(await snapshot()).toEqual(before);
  await blocked();
});
it.each(["archive", "cleanup"])(
  "%s failure stays blocked instead of accepting partial native success",
  async (failure) => {
    const { p, w } = await prepared(),
      before = await snapshot(),
      original = backup.backupDatabase;
    vi.spyOn(backup, "backupDatabase").mockImplementation(async (...args) => {
      await original(...args);
      if (failure === "archive") await writeFile(args[2], "corrupt archive");
      else
        await writeFile(
          path.join(path.dirname(args[2]), "unexpected-private-file"),
          "PRIVATE CLEANUP",
          { mode: 0o600 },
        );
    });
    const failed = await w.copy(p.headDigest, nativeRehearsalConfirmation);
    expect(failed.lifecycle).toBe("blocked-pending-manual-disposition");
    expect(failed.backupEvidence).toContain("Missing");
    expect(await snapshot()).toEqual(before);
    await blocked();
  },
);
it("unexpected files and removed immutable checkpoints refuse inspection without cleanup or fallback", async () => {
  const { p, w } = await prepared(),
    copy = await w.copy(p.headDigest, nativeRehearsalConfirmation);
  await writeFile(path.join(options.directory, "unexpected.txt"), "PRIVATE");
  await expect(w.inspect(copy.headDigest)).rejects.toThrow();
  await rm(path.join(options.directory, "unexpected.txt"));
  await rm(path.join(options.directory, "002.json"));
  await expect(w.status(copy.headDigest)).rejects.toThrow();
  await blocked();
});
