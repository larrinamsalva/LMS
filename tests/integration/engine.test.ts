import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createDatabase, sqlDatabase } from "../../src/server/database";
import { Engine } from "../../src/core/engine";
import { presets } from "../../src/presets";
import type { BusinessConfig } from "../../src/core/config";
let db: PGlite;
let engine: Engine;
const owner = { userId: randomUUID() },
  other = { userId: randomUUID() },
  viewer = { userId: randomUUID() },
  staff = { userId: randomUUID() };
const a = randomUUID(),
  b = randomUUID();
beforeAll(async () => {
  db = await createDatabase();
  engine = new Engine(sqlDatabase(db));
  for (const user of [owner, other, viewer, staff])
    await db.query("insert into lms.users values($1,'Test user')", [
      user.userId,
    ]);
  for (const [org, principal, preset] of [
    [a, owner, presets.property],
    [b, other, presets.cleaning],
  ] as const) {
    await db.query(
      "insert into lms.organizations values($1,'Test organization')",
      [org],
    );
    await db.query("insert into lms.memberships values($1,$2,'owner')", [
      org,
      principal.userId,
    ]);
    await db.transaction(async (tx) => {
      await tx.query("select set_config('lms.user_id',$1,true)", [
        principal.userId,
      ]);
      await tx.query(
        "insert into lms.config_revisions(organization_id,revision,document,created_by) values($1,1,$2,$3)",
        [org, preset, principal.userId],
      );
    });
  }
  for (const [principal, role] of [
    [viewer, "viewer"],
    [staff, "staff"],
  ] as const)
    await db.query("insert into lms.memberships values($1,$2,$3)", [
      a,
      principal.userId,
      role,
    ]);
});
afterAll(async () => {
  await db?.close();
});
describe("shared engine with real PostgreSQL policies", () => {
  it("operates genuinely different property and cleaning entities through the same service", async () => {
    const unit = await engine.saveRecord(owner, a, "units", {
      label: "RV-99",
      kind: "RV site",
      condition: "Ready",
      notes: "",
    });
    const job = await engine.saveRecord(other, b, "jobs", {
      title: "Move out",
      service: "Move-out clean",
      date: "2026-11-03",
      status: "Planned",
      crew: "Blue",
      notes: "",
    });
    expect(unit.entity).toBe("units");
    expect(job.entity).toBe("jobs");
    expect(
      (await engine.snapshot(owner, a)).records.map((r) => r.id),
    ).toContain(unit.id);
    expect(
      (await engine.snapshot(other, b)).records.map((r) => r.id),
    ).toContain(job.id);
  });
  it("blocks cross-organization reads and direct inserts/updates, even without UI filtering", async () => {
    const record = await engine.saveRecord(owner, a, "customers", {
      name: "Private customer",
    });
    await expect(engine.snapshot(other, a)).rejects.toMatchObject({
      status: 403,
    });
    const rows = await engine.asUser(other, (tx) =>
      tx.query("select * from lms.records where organization_id=$1", [a]),
    );
    expect(rows.rows).toHaveLength(0);
    await expect(
      engine.asUser(other, (tx) =>
        tx.query(
          "insert into lms.records(organization_id,entity,data,config_revision,created_by,updated_by) values($1,$2,$3,1,$4,$4)",
          [a, "customers", { name: "Attack" }, other.userId],
        ),
      ),
    ).rejects.toThrow(/row.level security/i);
    const update = await engine.asUser(other, (tx) =>
      tx.query("update lms.records set data=$1 where id=$2 returning id", [
        { name: "Attack" },
        record.id,
      ]),
    );
    expect(update.rows).toHaveLength(0);
    await expect(
      engine.asUser(owner, (tx) =>
        tx.query("update lms.records set organization_id=$1 where id=$2", [
          b,
          record.id,
        ]),
      ),
    ).rejects.toThrow(/immutable/i);
    const exports = await engine.exportWorkspace(other, b);
    expect(exports.records.some((r) => r.id === record.id)).toBe(false);
  });
  it("denies viewer writes, staff configuration changes, self-promotion and unauthenticated reads", async () => {
    await expect(
      engine.saveRecord(viewer, a, "customers", { name: "No" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      engine.asUser(viewer, (tx) =>
        tx.query(
          "insert into lms.records(organization_id,entity,data,config_revision,created_by,updated_by) values($1,$2,$3,1,$4,$4)",
          [a, "customers", { name: "No" }, viewer.userId],
        ),
      ),
    ).rejects.toThrow(/row.level security/i);
    await expect(
      engine.publishConfig(staff, a, presets.property, 1),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      engine.asUser(staff, (tx) =>
        tx.query("update lms.memberships set role='owner' where user_id=$1", [
          staff.userId,
        ]),
      ),
    ).rejects.toThrow(/permission denied/i);
    await db.transaction(async (tx) => {
      await tx.exec("set local role lms_app");
      expect((await tx.query("select * from lms.records")).rows).toHaveLength(
        0,
      );
    });
    expect((await engine.snapshot(staff, a)).audit).toHaveLength(0);
  });
  it("retains audit, refuses audit/config rewrites and enforces optimistic revisions", async () => {
    const first = await engine.saveRecord(owner, a, "customers", {
      name: "Original",
    });
    const next = await engine.saveRecord(
      owner,
      a,
      "customers",
      { name: "Edited" },
      { id: first.id, revision: first.revision },
    );
    expect(next.revision).toBe(2);
    await expect(
      engine.saveRecord(
        owner,
        a,
        "customers",
        { name: "Stale" },
        { id: first.id, revision: 1 },
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      engine.asUser(owner, (tx) => tx.query("delete from lms.audit_events")),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      engine.asUser(owner, (tx) =>
        tx.query("update lms.config_revisions set document='{}'"),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      engine.asUser(owner, (tx) => tx.query("delete from lms.records")),
    ).rejects.toThrow(/permission denied/i);
    const audit = (await engine.snapshot(owner, a)).audit.filter(
      (e) => e.record_id === first.id,
    );
    expect(audit).toHaveLength(2);
    expect(
      audit.some(
        (e) =>
          (e.before_data as { data?: { name?: string } })?.data?.name ===
          "Original",
      ),
    ).toBe(true);
    const archived = await engine.archiveRecord(owner, a, first.id, 2, true);
    expect(archived.archived).toBe(true);
    expect(
      (await engine.archiveRecord(owner, a, first.id, 3, false)).archived,
    ).toBe(false);
  });
  it("disables modules without losing data; rollback appends a retained revision", async () => {
    await engine.saveRecord(owner, a, "items", { name: "Retained supply" });
    const disabled: BusinessConfig = {
      ...presets.property,
      modules: presets.property.modules.filter((m) => m.id !== "inventory"),
      navigation: presets.property.navigation.filter(
        (n) =>
          presets.property.entities.find((e) => e.id === n)?.module !==
          "inventory",
      ),
    };
    expect(await engine.publishConfig(owner, a, disabled, 1)).toBe(2);
    await expect(
      engine.saveRecord(owner, a, "items", { name: "Hidden" }),
    ).rejects.toThrow(/disabled/i);
    expect(
      (await engine.snapshot(owner, a)).records.filter(
        (r) => r.entity === "items",
      ),
    ).toHaveLength(0);
    expect(
      (await engine.exportWorkspace(owner, a)).records.some(
        (r) => r.data.name === "Retained supply",
      ),
    ).toBe(true);
    await expect(
      engine.publishConfig(owner, a, presets.property, 1),
    ).rejects.toMatchObject({ status: 409 });
    expect(await engine.publishConfig(owner, a, presets.property, 2, 1)).toBe(
      3,
    );
    expect(
      (await engine.snapshot(owner, a)).records.some(
        (r) => r.data.name === "Retained supply",
      ),
    ).toBe(true);
    const changed = structuredClone(presets.property);
    changed.entities[0].fields[0].type = "number";
    await expect(engine.publishConfig(owner, a, changed, 3)).rejects.toThrow();
  });
  it("isolates identity across transactions and rejects attempts to change organization identity", async () => {
    await engine.snapshot(owner, a);
    await expect(engine.snapshot(other, a)).rejects.toMatchObject({
      status: 403,
    });
    const scope = await db.query<{ value: string }>(
      "select current_setting('lms.user_id',true) as value",
    );
    expect(scope.rows[0].value ?? "").toBe("");
    await expect(
      engine.asUser(owner, (tx) =>
        tx.query("update lms.organizations set id=$1 where id=$2", [
          randomUUID(),
          a,
        ]),
      ),
    ).rejects.toThrow(/row.level security|foreign key/i);
  });
});
