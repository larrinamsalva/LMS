import { it, expect, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { Engine } from "../../src/core/engine";
import {
  newBuildPlan,
  addCustomField,
  selectModules,
  brandBuildPlan,
} from "../../src/core/buildplan";
import { defaultBranding } from "../../src/core/branding";
import {
  explainMigrationImpact,
  type MigrationReview,
} from "../../src/core/migration-review";
import { upgradeBlueprint } from "../../src/core/upgrade-blueprint";
import {
  UpgradeLifecycle,
  upgradeRequest,
} from "../../src/server/postgres/upgrade-lifecycle";
import * as native from "../../src/server/postgres/native-readiness";
import {
  readinessTables,
  type NativeObservation,
} from "../../src/server/postgres/readiness-inspection";
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
function reviewed(populated = false): MigrationReview {
  const current = newBuildPlan("property"),
    next = structuredClone(current);
  next.configuration = addCustomField(next.configuration, "customers", {
    key: "extra_blueprint",
    label: "Service preference",
    type: "text",
    required: false,
  });
  return {
    format: "lms-migration-review",
    version: 1,
    configurationRevision: 1,
    ...explainMigrationImpact(current.configuration, next, [
      { entity: "customers", active: 0, archived: populated ? 1 : 0 },
    ]),
    state: { stateDigest: "1".repeat(64), proposalDigest: "2".repeat(64) },
  };
}
it("derives non-executable vocabulary and authoritative populated/archived blockers without claiming rollback", () => {
  for (const populated of [false, true]) {
    const r = reviewed(populated),
      report = upgradeBlueprint(r);
    expect(
      report.operations.some((o) => o.kind === "optional-field-addition"),
    ).toBe(true);
    expect(report.operations.every((o) => o.executable === false)).toBe(true);
    expect(report.overall).toBe(populated ? "migration-review" : "compatible");
    expect(report.rollbackReadiness.nativeCopy).toContain(
      "no retained rollback backup",
    );
    expect(JSON.stringify(report)).not.toContain("stateDigest");
  }
  const r = reviewed();
  r.proposed = brandBuildPlan(r.proposed, defaultBranding("property"));
  r.proposed.configuration = selectModules(r.proposed.configuration, [
    "customers",
    "tasks",
  ]);
  expect(
    upgradeBlueprint({
      ...r,
      ...explainMigrationImpact(r.current, r.proposed, []),
    }).operations.map((o) => o.kind),
  ).toContain("branding");
});
it("strict requests reject executable fields, missing dependencies and unsupported core-field transformations", () => {
  const base = {
    actorId: randomUUID(),
    organizationId: randomUUID(),
    document: newBuildPlan("cleaning"),
  };
  for (const extra of [
    { sql: "drop database" },
    { script: "execute" },
    { operations: ["run-sql"] },
  ])
    expect(() => upgradeRequest.parse({ ...base, ...extra })).toThrow();
  const missing = structuredClone(base);
  missing.document.configuration.modules = [];
  expect(() => upgradeRequest.parse(missing)).toThrow();
  const changed = structuredClone(base);
  changed.document.configuration.entities.find(
    (e) => e.id === "customers",
  )!.fields[0].type = "number";
  expect(() => upgradeRequest.parse(changed)).toThrow();
});
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lms-upgrade-unit-"));
  dirs.push(directory);
  const r = reviewed(true),
    org = randomUUID(),
    actor = randomUUID();
  const evidence: NativeObservation = {
    signatures: Object.fromEntries(
      readinessTables.map((t) => [t, "a".repeat(64)]),
    ),
    counts: Object.fromEntries(readinessTables.map((t) => [t, 0])),
    catalog: { tables: "b".repeat(64) },
    configurationSchemas: [1],
    buildPlanVersions: [],
  };
  const pin = { oid: "12", cluster: "123", locale: "reviewed" };
  const context = {
    source: {} as any,
    observation: evidence,
    sourcePin: pin,
    targetPin: pin,
    trust: {
      format: "lms-native-readiness-trust" as const,
      version: 1 as const,
      environment: "unit-lab",
      fictionalOnly: true as const,
      maintenanceRole: "postgres",
      source: {
        database: "lms_test_unit",
        instanceId: randomUUID(),
        organizations: [org],
      },
      target: { database: "lms_restore_unit" },
    },
  };
  vi.spyOn(Engine.prototype, "reviewBuildPlanImpact").mockResolvedValue(r);
  vi.spyOn(native, "nativeReadiness").mockImplementation(async (options) => {
    await options.onSource?.(context);
    if (options.mode === "rehearse") await options.onCopy?.(evidence);
    return {
      format: "lms-native-readiness-report",
      version: 1,
      mode: options.mode,
      environment: "unit-lab",
      result:
        options.mode === "rehearse"
          ? "rehearsal-complete"
          : "preflight-complete",
      backupReadiness:
        options.mode === "rehearse"
          ? "verified-fictional-round-trip"
          : "not-verified",
      versions: {} as any,
      checks: native.nativeReadinessChecks.map((id) => ({
        id,
        status: "passed",
        label: id,
      })) as any,
      remainingBlockers: [],
      notice: "unit protocol only",
    };
  });
  vi.spyOn(native, "withNativeCopyInspection").mockImplementation(
    async (_o, _k, fn) => fn(context, evidence),
  );
  const options = {
    directory,
    native: { sourceUrl: "", targetUrl: "", trustFile: "", workDirectory: "" },
  };
  const request = { actorId: actor, organizationId: org, document: r.proposed };
  return { directory, r, request, options, evidence };
}
it("records a pinned lifecycle, preserves immutable earlier files and retires tracking without database deletion", async () => {
  const f = await fixture(),
    prepared = await new UpgradeLifecycle(f.options).prepare(f.request),
    root = await readFile(path.join(f.directory, "root.json"), "utf8"),
    first = await readFile(path.join(f.directory, "001.json"), "utf8");
  const w = new UpgradeLifecycle({
    ...f.options,
    rootDigest: prepared.rootDigest,
  });
  const copy = await w.copy(
    prepared.headDigest,
    native.nativeRehearsalConfirmation,
  );
  expect(copy.lifecycle).toBe("quarantined-for-inspection");
  const inspected = await w.inspect(copy.headDigest);
  expect(inspected.lifecycle).toBe("inspection-completed");
  const retired = await w.inspect(
    inspected.headDigest,
    "RETIRE FICTIONAL COPY TRACKING",
  );
  expect(retired.lifecycle).toBe("retired");
  expect(retired.activationAllowed).toBe(false);
  expect(retired.executionAuthorized).toBe(false);
  expect(await readFile(path.join(f.directory, "root.json"), "utf8")).toBe(
    root,
  );
  expect(await readFile(path.join(f.directory, "001.json"), "utf8")).toBe(
    first,
  );
  expect(JSON.stringify(retired)).not.toContain(f.request.actorId);
  expect(JSON.stringify(retired)).not.toContain(f.request.organizationId);
  await expect(
    w.copy(prepared.headDigest, native.nativeRehearsalConfirmation),
  ).rejects.toThrow();
});
it("refuses forged pins, changed root, unexpected files and missing history without fallback", async () => {
  const f = await fixture(),
    prepared = await new UpgradeLifecycle(f.options).prepare(f.request),
    w = new UpgradeLifecycle({ ...f.options, rootDigest: prepared.rootDigest });
  await expect(
    new UpgradeLifecycle({ ...f.options, rootDigest: "0".repeat(64) }).status(
      prepared.headDigest,
    ),
  ).rejects.toThrow();
  await writeFile(path.join(f.directory, "unexpected.txt"), "PRIVATE");
  await expect(w.status(prepared.headDigest)).rejects.toThrow();
  await rm(path.join(f.directory, "unexpected.txt"));
  const root = await readFile(path.join(f.directory, "root.json"), "utf8");
  await writeFile(
    path.join(f.directory, "root.json"),
    root.replace("Service preference", "altered label"),
  );
  await expect(w.status(prepared.headDigest)).rejects.toThrow();
});
it("interrupted copy intent remains blocked and never replays a native copy", async () => {
  const f = await fixture(),
    p = await new UpgradeLifecycle(f.options).prepare(f.request);
  class Interrupted extends UpgradeLifecycle {
    protected async afterDurabilityStep(step: string) {
      if (step === "intent") throw new Error("interrupted");
    }
  }
  const w = new Interrupted({ ...f.options, rootDigest: p.rootDigest });
  await expect(
    w.copy(p.headDigest, native.nativeRehearsalConfirmation),
  ).rejects.toThrow();
  const normal = new UpgradeLifecycle({
    ...f.options,
    rootDigest: p.rootDigest,
  });
  expect((await normal.status(p.headDigest)).lifecycle).toBe(
    "blocked-pending-manual-disposition",
  );
  await expect(
    normal.copy(p.headDigest, native.nativeRehearsalConfirmation),
  ).rejects.toThrow();
  expect(vi.mocked(native.nativeReadiness).mock.calls).toHaveLength(1);
});
it("incomplete native evidence and competing requests cannot claim copied state", async () => {
  const f = await fixture(),
    p = await new UpgradeLifecycle(f.options).prepare(f.request),
    w = new UpgradeLifecycle({ ...f.options, rootDigest: p.rootDigest });
  vi.mocked(native.nativeReadiness).mockResolvedValueOnce({
    result: "rehearsal-complete",
    backupReadiness: "verified-fictional-round-trip",
    checks: [],
  } as any);
  const blocked = await w.copy(
    p.headDigest,
    native.nativeRehearsalConfirmation,
  );
  expect(blocked.lifecycle).toBe("blocked-pending-manual-disposition");
  expect(blocked.backupEvidence).toContain("Missing");
});
