import { offlineEngine } from "./offline-inspection";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, stat, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Engine } from "../../src/core/engine";
import { presets } from "../../src/presets";
import { connectPostgres } from "../../src/server/postgres/adapter";
import {
  migrate,
  loadMigrations,
  provisionRuntime,
} from "../../src/server/postgres/migrations";
import {
  backupDatabase,
  restoreDatabase,
} from "../../src/server/postgres/backup";
import { localTarget } from "../../src/server/postgres/targets";
import { seedFictional } from "../../scripts/postgres/fixture";
const exec = promisify(execFile);
const raw = process.env.LMS_TEST_ADMIN_URL;
if (!raw)
  throw new Error(
    "LMS_TEST_ADMIN_URL is required. Network tests never silently skip. Use a disposable local PostgreSQL cluster.",
  );
const baseName = decodeURIComponent(new URL(raw).pathname.slice(1));
const source = localTarget(raw, baseName);
if (!baseName.startsWith("lms_test_"))
  throw new Error("Tests require a disposable lms_test_* database.");
const suffix = randomBytes(5).toString("hex");
const names = [
  `lms_test_${suffix}`,
  `lms_restore_${suffix}`,
  `lms_test_failure_${suffix}`,
];
const databaseUrl = (name: string, runtime = false) => {
  const url = new URL(source);
  url.pathname = "/" + name;
  if (runtime) {
    url.username = "lms_runtime";
    url.password =
      process.env.LMS_TEST_RUNTIME_PASSWORD ??
      "fictional_test_password_24_characters";
  }
  return url.toString();
};
let admin: Client;
let cluster: Client;
let db: Awaited<ReturnType<typeof connectPostgres>>;
let fixture: Awaited<ReturnType<typeof seedFictional>>;
let engine: Engine;
let backupDirectory: string;
async function withClient<T>(url: string, fn: (client: Client) => Promise<T>) {
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
beforeAll(async () => {
  cluster = new Client({ connectionString: source.toString() });
  await cluster.connect();
  const version = (await cluster.query("show server_version")).rows[0]
    .server_version;
  console.log(`Network PostgreSQL version: ${version}`);
  for (const name of names) await cluster.query(`create database "${name}"`);
  admin = new Client({ connectionString: databaseUrl(names[0]) });
  await admin.connect();
  await migrate(admin);
  await provisionRuntime(admin, databaseUrl(names[0], true));
  fixture = await seedFictional(admin, databaseUrl(names[0], true));
  db = await connectPostgres({
    connectionString: databaseUrl(names[0], true),
    maxConnections: 2,
  });
  engine = new Engine(db);
  backupDirectory = await mkdtemp(path.join(os.tmpdir(), "lms-postgres-"));
});
afterAll(async () => {
  await db?.close();
  await admin?.end();
  if (cluster) {
    // Test-created names only; never drop an externally supplied database.
    for (const name of names)
      await cluster.query(`drop database if exists "${name}" with (force)`);
    await cluster.end();
  }
  if (backupDirectory)
    await rm(backupDirectory, { recursive: true, force: true });
});
describe("durable PostgreSQL using the unchanged LMS engine", () => {
  it("survives exit and restart of independent application processes", async () => {
    const options = {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LMS_TEST_RUNTIME_URL: databaseUrl(names[0], true),
      },
    };
    const args = ["--import=tsx", "scripts/postgres/restart-probe.ts"];
    const first = await exec(
      process.execPath,
      [...args, "write", fixture.owner, fixture.property, names[0]],
      options,
    );
    const written = JSON.parse(first.stdout).find(
      (r: { name: string }) => r.name === "Survives process restart",
    );
    expect(written?.id).toBeTruthy();
    const second = await exec(
      process.execPath,
      [...args, "read", fixture.owner, fixture.property, names[0]],
      options,
    );
    expect(JSON.parse(second.stdout)).toContainEqual(written);
    expect(
      (
        await engine.snapshot({ userId: fixture.owner }, fixture.property)
      ).records.some((r) => r.id === written.id),
    ).toBe(true);
  });
  it("serializes competing record and configuration updates, returning one success and one conflict", async () => {
    const principal = { userId: fixture.owner };
    const record = await engine.saveRecord(
      principal,
      fixture.property,
      "customers",
      { name: "Concurrent fictional record" },
    );
    const updates = await Promise.allSettled(
      ["A", "B"].map((name) =>
        engine.saveRecord(
          principal,
          fixture.property,
          "customers",
          { name },
          { id: record.id, revision: 1 },
        ),
      ),
    );
    expect(updates.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(updates.find((r) => r.status === "rejected")).toMatchObject({
      reason: { status: 409 },
    });
    const versions = await Promise.allSettled(
      ["First", "Second"].map((name) =>
        engine.publishConfig(
          principal,
          fixture.property,
          { ...presets.property, name },
          1,
        ),
      ),
    );
    expect(versions.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(versions.find((r) => r.status === "rejected")).toMatchObject({
      reason: { status: 409 },
    });
    const events = (
      await engine.snapshot(principal, fixture.property)
    ).audit.filter((e) => e.record_id === record.id);
    expect(events).toHaveLength(2);
  });
  it("enforces organization isolation and role checks in the database", async () => {
    const owner = { userId: fixture.owner },
      other = { userId: fixture.other },
      viewer = { userId: fixture.viewer },
      staff = { userId: fixture.staff };
    const record = await engine.saveRecord(
      owner,
      fixture.property,
      "customers",
      { name: "Private fictional customer" },
    );
    await expect(
      engine.snapshot(other, fixture.property),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (
        await engine.asUser(other, (tx) =>
          tx.query("select * from lms.records where organization_id=$1", [
            fixture.property,
          ]),
        )
      ).rows,
    ).toHaveLength(0);
    await expect(
      engine.asUser(other, (tx) =>
        tx.query(
          "insert into lms.records(organization_id,entity,data,config_revision,created_by,updated_by) values($1,$2,$3,1,$4,$4)",
          [fixture.property, "customers", { name: "Attack" }, fixture.other],
        ),
      ),
    ).rejects.toThrow(/row.level security/i);
    expect(
      (
        await engine.asUser(other, (tx) =>
          tx.query("update lms.records set data=$1 where id=$2 returning id", [
            { name: "Attack" },
            record.id,
          ]),
        )
      ).rows,
    ).toHaveLength(0);
    await expect(
      engine.saveRecord(viewer, fixture.property, "customers", {
        name: "Denied",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      engine.asUser(viewer, (tx) =>
        tx.query("update lms.records set data=$1 where id=$2", [
          { name: "Denied" },
          record.id,
        ]),
      ),
    ).resolves.toMatchObject({ rows: [] });
    await expect(
      engine.publishConfig(staff, fixture.property, presets.property, 2),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      engine.asUser(staff, (tx) =>
        tx.query("update lms.memberships set role='owner'"),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      engine.asUser(owner, (tx) => tx.query("delete from lms.audit_events")),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      engine.asUser(owner, (tx) =>
        tx.query("update lms.records set organization_id=$1 where id=$2", [
          fixture.cleaning,
          record.id,
        ]),
      ),
    ).rejects.toThrow(/immutable/i);
    await expect(db.query("select * from lms.records")).rejects.toThrow(
      /permission denied/i,
    );
    await expect(db.query("select * from lms_meta.migrations")).rejects.toThrow(
      /permission denied/i,
    );
  });
  it("returns pooled connections without identity after commits, failures and revoked memberships", async () => {
    const single = await connectPostgres({
      connectionString: databaseUrl(names[0], true),
      maxConnections: 1,
    });
    const service = new Engine(single);
    try {
      await service.snapshot({ userId: fixture.owner }, fixture.property);
      await expect(
        service.asUser({ userId: fixture.owner }, async (tx) => {
          await tx.query(
            "insert into lms.records(organization_id,entity,data,config_revision,created_by,updated_by) values($1,'customers',$2,1,$3,$3)",
            [fixture.property, { name: "Should roll back" }, fixture.owner],
          );
          throw new Error("Expected rollback");
        }),
      ).rejects.toThrow("Expected rollback");
      const identity = await single.query<{ actor: string; role: string }>(
        "select current_setting('lms.user_id',true) as actor,current_user as role",
      );
      expect(identity.rows[0].actor || "").toBe("");
      expect(identity.rows[0].role).toBe("lms_runtime");
      expect(
        (
          await service.snapshot({ userId: fixture.owner }, fixture.property)
        ).records.some((r) => r.data.name === "Should roll back"),
      ).toBe(false);
      await expect(
        service.snapshot({ userId: fixture.other }, fixture.property),
      ).rejects.toMatchObject({ status: 403 });
      const stranger = randomUUID();
      await service.asUser({ userId: stranger }, async (tx) =>
        expect((await tx.query("select * from lms.records")).rows).toHaveLength(
          0,
        ),
      );
      await admin.query(
        "delete from lms.memberships where organization_id=$1 and user_id=$2",
        [fixture.property, fixture.staff],
      );
      await expect(
        service.snapshot({ userId: fixture.staff }, fixture.property),
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      await single.close();
    }
    await expect(
      connectPostgres({ connectionString: databaseUrl(names[0]) }),
    ).rejects.toThrow(/unsafe/i);
  });
  it("applies migrations once, locks competing runners and refuses checksum/history drift", async () => {
    const current = await migrate(admin);
    expect(current).toEqual([]);
    const [first, second] = await Promise.all([
      withClient(databaseUrl(names[0]), (c) => migrate(c)),
      withClient(databaseUrl(names[0]), (c) => migrate(c)),
    ]);
    expect(first).toEqual([]);
    expect(second).toEqual([]);
    const changed = await loadMigrations();
    changed[0].sql += "\n-- unreviewed change";
    await expect(migrate(admin, changed)).rejects.toThrow(/history mismatch/i);
    expect(
      (
        await admin.query(
          "select count(*)::int as count from lms_meta.migrations",
        )
      ).rows[0].count,
    ).toBe(9);
  });
  it("rolls back failed migrations atomically and can subsequently initialize the empty database", async () => {
    await withClient(databaseUrl(names[2]), async (client) => {
      const files = await loadMigrations();
      await expect(
        migrate(client, [
          ...files,
          {
            version: 11,
            name: "011_intentional_failure",
            sql: "create table public.partial_migration(id integer); select definitely_missing_function();",
          },
        ]),
      ).rejects.toThrow();
      const state = (
        await client.query(
          "select to_regclass('lms.records') as records,to_regclass('public.partial_migration') as partial,to_regclass('lms_meta.migrations') as ledger",
        )
      ).rows[0];
      expect(state).toEqual({ records: null, partial: null, ledger: null });
      expect(await migrate(client)).toEqual([
        "001_foundation",
        "002_local_identity",
        "003_owner_memberships",
        "004_account_lifecycle",
        "005_offline_recovery",
        "006_credential_lineage",
        "007_relationship_scheduling",
        "008_workforce_availability",
        "009_service_estimates",
        "010_inventory_ledger",
      ]);
    });
  });
  it("creates a private native pg_dump archive and restores records, audit, roles and constraints into a separate database", async () => {
    const archive = path.join(backupDirectory, "fictional.dump");
    const principal = { userId: fixture.owner };
    const before = await engine.exportWorkspace(principal, fixture.property);
    const beforeAudit = (await engine.snapshot(principal, fixture.property))
      .audit;
    const previousService = process.env.PGSERVICE;
    const previousOptions = process.env.PGOPTIONS;
    process.env.PGSERVICE = "definitely_missing_lms_service";
    process.env.PGOPTIONS = "-c role=lms_app";
    try {
      await backupDatabase(
        databaseUrl(names[0]),
        names[0],
        archive,
        process.env.LMS_PG_BIN,
      );
    } finally {
      if (previousService === undefined) delete process.env.PGSERVICE;
      else process.env.PGSERVICE = previousService;
      if (previousOptions === undefined) delete process.env.PGOPTIONS;
      else process.env.PGOPTIONS = previousOptions;
    }
    expect((await stat(archive)).mode & 0o777).toBe(0o600);
    expect((await readFile(archive)).subarray(0, 5).toString()).toBe("PGDMP");
    await expect(
      backupDatabase(
        databaseUrl(names[0]),
        names[0],
        archive,
        process.env.LMS_PG_BIN,
      ),
    ).rejects.toThrow();
    await restoreDatabase(
      databaseUrl(names[1]),
      names[1],
      archive,
      process.env.LMS_PG_BIN,
    );
    await expect(
      connectPostgres({ connectionString: databaseUrl(names[1], true) }),
    ).rejects.toThrow(/activation blocked/i);
    const restoredDb = new Client({ connectionString: databaseUrl(names[1]) });
    await restoredDb.connect();
    try {
      const restored = offlineEngine(restoredDb);
      const after = await restored.exportWorkspace(principal, fixture.property);
      expect(after.records).toEqual(before.records);
      expect(after.config).toEqual(before.config);
      expect(after.history).toEqual(before.history);
      expect(
        (await restored.snapshot(principal, fixture.property)).audit,
      ).toEqual(beforeAudit);
      await expect(
        restored.snapshot({ userId: fixture.other }, fixture.property),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        restored.saveRecord(
          { userId: fixture.viewer },
          fixture.property,
          "customers",
          { name: "Denied after restore" },
        ),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        restored.asUser(principal, (tx) =>
          tx.query("delete from lms.audit_events"),
        ),
      ).rejects.toThrow(/permission denied/i);
      expect(
        (
          await restored.asUser({ userId: fixture.other }, (tx) =>
            tx.query("select * from lms.records where organization_id=$1", [
              fixture.property,
            ]),
          )
        ).rows,
      ).toHaveLength(0);
      await expect(
        restored.asUser(principal, (tx) =>
          tx.query(
            "insert into lms.records(organization_id,entity,data,config_revision,created_by,updated_by) values($1,'customers',$2,9999,$3,$3)",
            [
              fixture.property,
              { name: "Invalid restored reference" },
              fixture.owner,
            ],
          ),
        ),
      ).rejects.toThrow(/activation blocked/i);
      await expect(
        restored.saveRecord(principal, fixture.property, "customers", {
          name: "Blocked restored write",
        }),
      ).rejects.toThrow(/activation blocked/i);
    } finally {
      await restoredDb.end();
    }
    expect(
      await withClient(databaseUrl(names[1]), (client) => migrate(client)),
    ).toEqual([]);
    await expect(
      restoreDatabase(
        databaseUrl(names[1]),
        names[1],
        archive,
        process.env.LMS_PG_BIN,
      ),
    ).rejects.toThrow(/not empty/i);
    // A failed restore must not remove already-retained records.
    expect(
      (await engine.exportWorkspace(principal, fixture.property)).records,
    ).toEqual(before.records);
  });
  it("rejects corrupted archives and wrong targets without changing the source database", async () => {
    const file = path.join(backupDirectory, "corrupt.dump");
    await writeFile(file, "not a PostgreSQL archive");
    await expect(
      restoreDatabase(databaseUrl(names[0]), names[0], file),
    ).rejects.toThrow(/Stop runtime hosts/i);
    await expect(
      restoreDatabase(databaseUrl(names[0]), "production", file),
    ).rejects.toThrow();
    const corruptTarget = `lms_restore_corrupt_${suffix}`;
    await cluster.query(`create database "${corruptTarget}"`);
    try {
      await expect(
        restoreDatabase(
          databaseUrl(corruptTarget),
          corruptTarget,
          file,
          process.env.LMS_PG_BIN,
        ),
      ).rejects.toThrow(/pg_restore failed/);
      const state = await withClient(databaseUrl(corruptTarget), (c) =>
        c.query("select to_regclass('lms.records') as records"),
      );
      expect(state.rows[0].records).toBeNull();
    } finally {
      await cluster.query(`drop database "${corruptTarget}" with (force)`);
    }
    const missing = path.join(backupDirectory, "failed.dump");
    await expect(
      backupDatabase(
        databaseUrl(names[0]),
        names[0],
        missing,
        "/definitely/missing/pg-tools",
      ),
    ).rejects.toThrow(/Unable to start/);
    await expect(stat(missing)).rejects.toThrow();
  });
  it("keeps the public demo temporary even when persistent storage is configured", async () => {
    const previous = process.env.LMS_POSTGRES_URL;
    process.env.LMS_POSTGRES_URL = databaseUrl(names[0], true);
    try {
      const { createDatabase, sqlDatabase } =
        await import("../../src/server/database");
      const temporary = await createDatabase();
      try {
        const service = new Engine(sqlDatabase(temporary));
        await expect(
          service.snapshot({ userId: fixture.owner }, fixture.property),
        ).rejects.toMatchObject({ status: 403 });
        expect(
          (await temporary.query("select * from lms.records")).rows,
        ).toHaveLength(0);
      } finally {
        await temporary.close();
      }
      const fresh = await createDatabase();
      try {
        expect(
          (await fresh.query("select * from lms.records")).rows,
        ).toHaveLength(0);
      } finally {
        await fresh.close();
      }
    } finally {
      if (previous === undefined) delete process.env.LMS_POSTGRES_URL;
      else process.env.LMS_POSTGRES_URL = previous;
    }
  });
});
