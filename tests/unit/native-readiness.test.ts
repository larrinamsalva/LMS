import { afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  writeFile,
  readFile,
  readdir,
  rm,
  chmod,
  stat,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import {
  nativeTargets,
  nativeReadiness,
  nativeTrustSchema,
} from "../../src/server/postgres/native-readiness";
import {
  backupDatabase,
  backupToolVersions,
} from "../../src/server/postgres/backup";
import {
  sameNative,
  readinessTables,
  transientTables,
  type NativeObservation,
} from "../../src/server/postgres/readiness-inspection";
import { loadMigrations } from "../../src/server/postgres/migrations";
it("catalog commitments retain exact contents across canonical JSON key ordering", () => {
  const source: NativeObservation = {
    signatures: {},
    counts: {},
    catalog: { tables: "reviewed", functions: "known" },
    configurationSchemas: [1],
    buildPlanVersions: [],
  };
  const persisted = JSON.parse(
    JSON.stringify({
      ...source,
      catalog: { functions: "known", tables: "reviewed" },
    }),
  );
  expect(() => sameNative(source, persisted, false)).not.toThrow();
  persisted.catalog.functions = "altered";
  expect(() => sameNative(source, persisted, false)).toThrow();
  persisted.catalog.functions = "known";
  persisted.catalog.unexpected = "extra";
  expect(() => sameNative(source, persisted, false)).toThrow();
});
it("the host CLI writes a private sanitized blocked report, refuses overwrites and duplicate flags", async () => {
  const d = await directory(),
    trustFile = path.join(d, "trust.json"),
    file = path.join(d, "report.json");
  await writeFile(
    trustFile,
    JSON.stringify({ ...trust(), version: 99, secret: "DO_NOT_PRINT" }),
    { mode: 0o600 },
  );
  const args = [
    "--import=tsx",
    "scripts/native-readiness.ts",
    "preflight",
    "--trust",
    trustFile,
    "--work-directory",
    d,
    "--report",
    file,
  ];
  const exec = promisify(execFile),
    env = {
      ...process.env,
      LMS_ADMIN_DATABASE_URL: source,
      LMS_RESTORE_DATABASE_URL: target,
    };
  const result = await exec(process.execPath, args, { env }).catch((e) => e);
  expect(result.code).toBe(1);
  expect(result.stdout + result.stderr).not.toContain("DO_NOT_PRINT");
  const text = await readFile(file, "utf8");
  expect(JSON.parse(text).result).toBe("blocked");
  expect(text).not.toContain("DO_NOT_PRINT");
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect(
    (await exec(process.execPath, args, { env }).catch((e) => e)).code,
  ).toBe(1);
  expect(
    (
      await exec(process.execPath, [...args, "--trust", trustFile], {
        env,
      }).catch((e) => e)
    ).code,
  ).toBe(1);
  expect(await readFile(file, "utf8")).toBe(text);
});
const trust = () => ({
  format: "lms-native-readiness-trust",
  version: 1,
  environment: "local-test",
  fictionalOnly: true,
  maintenanceRole: "postgres",
  source: {
    database: "lms_test_native",
    instanceId: randomUUID(),
    organizations: [randomUUID()],
  },
  target: { database: "lms_restore_native" },
});
const source = "postgres://postgres:DO_NOT_PRINT@127.0.0.1/lms_test_native",
  target = "postgres://postgres:DO_NOT_PRINT@127.0.0.1/lms_restore_native";
const directories: string[] = [];
async function directory() {
  const d = await mkdtemp(path.join(os.tmpdir(), "lms-native-unit-"));
  directories.push(d);
  return d;
}
afterEach(async () => {
  for (const d of directories.splice(0))
    await rm(d, { recursive: true, force: true });
});
it("requires exact private fictional test/restore identities and one approved loopback authority", () => {
  expect(nativeTargets(trust(), source, target).source.pathname).toBe(
    "/lms_test_native",
  );
  for (const url of [
    source.replace("127.0.0.1", "db.example.test"),
    source + "?options=role%3Dlms_app",
    source + "#hidden",
    source.replace("postgres:DO_NOT_PRINT", "lms_runtime:DO_NOT_PRINT"),
    source.replace(":DO_NOT_PRINT", ":"),
    source.replace("lms_test_native", "lms_development"),
  ])
    expect(() => nativeTargets(trust(), url, target)).toThrow();
  expect(() =>
    nativeTargets(trust(), source, target.replace("127.0.0.1", "localhost")),
  ).toThrow();
  expect(() =>
    nativeTargets(
      trust(),
      source,
      target.replace("127.0.0.1", "127.0.0.1:5433"),
    ),
  ).toThrow();
  for (const extra of [
    { version: 2 },
    { fictionalOnly: false },
    { code: "execute" },
    { source: { ...trust().source, organizations: [] } },
    { target: { database: "production" } },
  ])
    expect(() => nativeTrustSchema.parse({ ...trust(), ...extra })).toThrow();
});
it("refuses insecure or unsupported evidence without exposing paths or secret values", async () => {
  const d = await directory(),
    file = path.join(d, "DO_NOT_PRINT.json");
  await writeFile(file, JSON.stringify(trust()), { mode: 0o644 });
  const result = await nativeReadiness({
    mode: "preflight",
    trustFile: file,
    sourceUrl: source,
    targetUrl: target,
    workDirectory: d,
  });
  expect(result.result).toBe("blocked");
  expect(result.backupReadiness).toBe("not-verified");
  expect(JSON.stringify(result)).not.toContain("DO_NOT_PRINT");
  expect(JSON.stringify(result)).not.toContain(d);
  await chmod(file, 0o600);
  const invalid = { ...trust(), version: 99 };
  await writeFile(file, JSON.stringify(invalid));
  expect(
    (
      await nativeReadiness({
        mode: "rehearse",
        trustFile: file,
        sourceUrl: source,
        targetUrl: target,
        workDirectory: d,
      })
    ).result,
  ).toBe("blocked");
  expect(await readdir(d)).toEqual(["DO_NOT_PRINT.json"]);
});
it("a pre-aborted rehearsal cannot allocate an archive or claim readiness", async () => {
  const d = await directory(),
    controller = new AbortController();
  controller.abort();
  const result = await nativeReadiness({
    mode: "rehearse",
    trustFile: "DO_NOT_PRINT",
    sourceUrl: source,
    targetUrl: target,
    workDirectory: d,
    signal: controller.signal,
  });
  expect(result.result).toBe("blocked");
  expect(result.backupReadiness).toBe("not-verified");
  expect(await readdir(d)).toEqual([]);
});
it("preservation comparison distinguishes purged transient state from retained history and catalog drift", () => {
  const observation: NativeObservation = {
    signatures: Object.fromEntries(readinessTables.map((t) => [t, "original"])),
    counts: Object.fromEntries(readinessTables.map((t) => [t, 0])),
    catalog: { tables: "reviewed" },
    configurationSchemas: [1, 2],
    buildPlanVersions: [1, 2],
  };
  const same = structuredClone(observation);
  expect(() => sameNative(observation, same, false)).not.toThrow();
  same.signatures["lms.audit_events"] = "altered";
  expect(() => sameNative(observation, same, false)).toThrow();
  same.signatures["lms.audit_events"] = "original";
  for (const t of transientTables) same.signatures[t] = "purged";
  same.signatures["lms_control.state"] = "quarantined";
  expect(() => sameNative(observation, same, true)).not.toThrow();
  expect(() => sameNative(observation, same, false)).toThrow();
  same.counts["lms_identity.session"] = 1;
  expect(() => sameNative(observation, same, true)).toThrow();
  same.counts["lms_identity.session"] = 0;
  same.catalog.tables = "altered";
  expect(() => sameNative(observation, same, true)).toThrow();
});
it("the closed table inventory covers every original migration table and the native ledger", async () => {
  const names = (await loadMigrations()).flatMap((m) =>
    [...m.sql.matchAll(/create table\s+([\w.\"]+)/g)].map((match) =>
      match[1].replaceAll('"', ""),
    ),
  );
  expect([...new Set([...names, "lms_meta.migrations"])].sort()).toEqual(
    [...readinessTables].sort(),
  );
});
it("reuses bounded native tool version inspection", async () => {
  const d = await directory();
  for (const name of ["pg_dump", "pg_restore"])
    await writeFile(
      path.join(d, name),
      `#!/usr/bin/env node\nconsole.log('${name} (PostgreSQL) 16.15');\n`,
      { mode: 0o700 },
    );
  expect(await backupToolVersions(source, "lms_test_native", d)).toEqual({
    pg_dump: 16,
    pg_restore: 16,
  });
  await writeFile(
    path.join(d, "pg_restore"),
    "#!/usr/bin/env node\nconsole.log('DO_NOT_PRINT invalid output');\n",
  );
  await expect(
    backupToolVersions(source, "lms_test_native", d),
  ).rejects.toThrow("Unsupported PostgreSQL client version output.");
});
it("waits for an interrupted child to stop before deleting its private partial archive, even if it exits zero", async () => {
  const d = await directory(),
    file = path.join(d, "partial.dump"),
    controller = new AbortController();
  await writeFile(
    path.join(d, "pg_dump"),
    "#!/usr/bin/env node\nprocess.on('SIGTERM',()=>process.exit(0));process.stdout.write('PGDMPpartial');setInterval(()=>{},1000);\n",
    { mode: 0o700 },
  );
  const result = backupDatabase(source, "lms_test_native", file, d, {
    signal: controller.signal,
  });
  for (let i = 0; i < 100; i++) {
    if ((await readFile(file).catch(() => Buffer.alloc(0))).length) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  controller.abort();
  await expect(result).rejects.toThrow(/failed or was interrupted/);
  expect(await readdir(d)).toEqual(["pg_dump"]);
});
