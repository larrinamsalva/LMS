import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { inventory, movement } from "../helpers/inventory";

import type { WorkspaceRecord } from "../../src/core/engine";
import type { RecordData } from "../../src/core/config";
import { Engine } from "../../src/core/engine";
import { presets } from "../../src/presets";

import { connectPostgres } from "../../src/server/postgres/adapter";
import {
  migrate,
  loadMigrations,
  provisionRuntime,
} from "../../src/server/postgres/migrations";
import { localTarget } from "../../src/server/postgres/targets";
import {
  backupDatabase,
  restoreDatabase,
} from "../../src/server/postgres/backup";
const raw = process.env.LMS_TEST_ADMIN_URL;
if (!raw)
  throw new Error(
    "LMS_TEST_ADMIN_URL is required; inventory PostgreSQL tests never skip.",
  );
const controlName = decodeURIComponent(new URL(raw).pathname.slice(1));
if (!controlName.startsWith("lms_test_"))
  throw new Error("Use a disposable fictional lms_test_* control.");
const control = localTarget(raw, controlName),
  suffix = randomBytes(5).toString("hex"),
  name = "lms_test_inventory_" + suffix,
  restoreName = "lms_restore_inventory_" + suffix,
  legacyName = "lms_test_inventory_legacy_" + suffix;
function url(database = name, runtime = false) {
  const u = new URL(control);
  u.pathname = "/" + database;
  if (runtime) {
    u.username = "lms_runtime";
    u.password =
      process.env.LMS_TEST_RUNTIME_PASSWORD ??
      "fictional_test_password_24_characters";
  }
  return u.toString();
}
let cluster: Client,
  admin: Client,
  db: Awaited<ReturnType<typeof connectPostgres>>,
  engine: Engine,
  a: string,
  b: string,
  directory: string;
const owner = { userId: randomUUID() },
  other = { userId: randomUUID() },
  staff = { userId: randomUUID() },
  viewer = { userId: randomUUID() };
async function client<T>(
  database: string,
  runtime: boolean,
  fn: (c: Client) => Promise<T>,
) {
  const c = new Client({
    connectionString: url(database, runtime),
    statement_timeout: 15000,
  });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}
async function org(c: Client, id: string, actor: string, config: unknown) {
  await c.query(
    "insert into lms.organizations(id,name) values($1,'Fictional schedule')",
    [id],
  );
  await c.query("insert into lms.memberships values($1,$2,'owner')", [
    id,
    actor,
  ]);
  await c.query("select set_config('lms.user_id',$1,false)", [actor]);
  await c.query(
    "insert into lms.config_revisions(organization_id,revision,document,created_by)values($1,1,$2,$3)",
    [id, config, actor],
  );
}
beforeAll(async () => {
  cluster = new Client({ connectionString: control.toString() });
  await cluster.connect();
  for (const n of [name, restoreName, legacyName])
    await cluster.query(`create database "${n}"`);
  admin = new Client({ connectionString: url() });
  await admin.connect();
  await migrate(admin);
  await provisionRuntime(admin, url(name, true));
  for (const p of [owner, other, staff, viewer])
    await admin.query(
      "insert into lms.users values($1,'Fictional scheduling principal')",
      [p.userId],
    );
  db = await connectPostgres({
    connectionString: url(name, true),
    maxConnections: 4,
  });
  engine = new Engine(db);
  directory = await mkdtemp(path.join(os.tmpdir(), "lms-inventory-"));
});
beforeEach(async () => {
  await admin.query("truncate lms.organizations cascade");
  a = randomUUID();
  b = randomUUID();
  await org(admin, a, owner.userId, presets.property);
  await org(admin, b, other.userId, presets.cleaning);
  for (const [p, role] of [
    [staff, "staff"],
    [viewer, "viewer"],
  ] as const)
    await admin.query("insert into lms.memberships values($1,$2,$3)", [
      a,
      p.userId,
      role,
    ]);
});
afterAll(async () => {
  await db?.close();
  await admin?.end();
  if (cluster) {
    for (const n of [name, restoreName, legacyName])
      await cluster.query(`drop database if exists "${n}" with(force)`);
    await cluster.end();
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function rawTransaction<T>(
  fn: (c: Client) => Promise<T>,
  actor = owner.userId,
  isolation = "read committed",
) {
  return client(name, true, async (c) => {
    await c.query("begin isolation level " + isolation);
    try {
      await c.query("set local role lms_app");
      await c.query("select set_config('lms.user_id',$1,true)", [actor]);
      const r = await fn(c);
      await c.query("commit");
      return r;
    } catch (e) {
      await c.query("rollback");
      throw e;
    }
  });
}
async function rawPost(
  c: Client,
  data: RecordData,
  op = randomUUID(),
  actor = owner.userId,
) {
  await c.query("select set_config('lms.record_command',$1,true)", [
    JSON.stringify({
      operationId: op,
      request: {
        kind: "save",
        entity: "stock-movements",
        data,
        existing: null,
      },
    }),
  ]);
  return (
    await c.query<WorkspaceRecord>(
      "insert into lms.records(organization_id,entity,data,config_revision,created_by,updated_by)values($1,'stock-movements',$2,1,$3,$3)returning *",
      [a, data, actor],
    )
  ).rows[0];
}
const balance = async (product: string, location: string) =>
  (await engine.snapshot(owner, a)).stockBalances.find(
    (b) => b.product_id === product && b.location_id === location,
  )?.units ?? "0";
async function post(
  c: Awaited<ReturnType<typeof inventory>>,
  action = "Receiving",
  quantity = "2",
  packaging = "Cases",
  p = owner,
  extra = {},
) {
  return engine.saveRecord(
    p,
    a,
    "stock-movements",
    {
      ...movement(c.product, c.location, action, quantity, packaging),
      ...extra,
    },
    undefined,
    randomUUID(),
  );
}
describe("native inventory boundary", () => {
  it("uses the same products/ledger for cleaning and property work with exact case snapshots", async () => {
    for (const [org, p, industry] of [
      [a, owner, "property"],
      [b, other, "cleaning"],
    ] as const) {
      const c = await inventory(engine, p, org),
        work = await engine.saveRecord(
          p,
          org,
          industry === "property" ? "tasks" : "jobs",
          industry === "property"
            ? { title: "Fictional maintenance", status: "Open" }
            : {
                title: "Fictional cleaning",
                service: "Standard clean",
                status: "Planned",
                date: "2026-11-01",
              },
        );
      await engine.saveRecord(
        p,
        org,
        "stock-movements",
        { ...movement(c.product, c.location), work: work.id },
        undefined,
        randomUUID(),
      );
      const snap = await engine.snapshot(p, org);
      expect(snap.stockBalances[0].units).toBe("24");
      expect(snap.stockMovements[0]).toMatchObject({
        work_id: work.id,
        case_size: "12",
        units: "24",
        product_name: "Fictional supply",
        actor_id: p.userId,
      });
    }
  });
  it("serializes competing raw usage at one location and never overspends", async () => {
    const c = await inventory(engine, owner, a);
    await post(c, "Receiving", "10", "Units");
    const results = await Promise.allSettled([
      rawTransaction((db) =>
        rawPost(db, movement(c.product, c.location, "Usage", "7", "Units")),
      ),
      rawTransaction((db) =>
        rawPost(db, movement(c.product, c.location, "Usage", "7", "Units")),
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")?.reason).toMatchObject({
      code: "23514",
    });
    expect(await balance(c.product.id, c.location.id)).toBe("3");
    expect((await engine.snapshot(owner, a)).stockMovements).toHaveLength(2);
  });
  it("adds concurrent receipts without lost updates and deduplicates competing retries/audits", async () => {
    const c = await inventory(engine, owner, a),
      data = movement(c.product, c.location),
      op = randomUUID();
    const result = await Promise.all([
      engine.saveRecord(owner, a, "stock-movements", data, undefined, op),
      engine.saveRecord(owner, a, "stock-movements", data, undefined, op),
    ]);
    expect(result[0].id).toBe(result[1].id);
    expect(await balance(c.product.id, c.location.id)).toBe("24");
    await Promise.all([
      rawTransaction((db) => rawPost(db, data)),
      rawTransaction((db) => rawPost(db, data)),
    ]);
    expect(await balance(c.product.id, c.location.id)).toBe("72");
    const before = await engine.snapshot(owner, a);
    await expect(
      rawTransaction((db) => rawPost(db, data, op)),
    ).rejects.toMatchObject({ code: "23505" });
    expect((await engine.snapshot(owner, a)).stockMovements).toEqual(
      before.stockMovements,
    );
    expect(
      before.audit.filter((x) => x.record_id === result[0].id),
    ).toHaveLength(1);
  });
  it("orders transfers both ways, refuses foreign destinations and rolls source back when destination overflows", async () => {
    const c = await inventory(engine, owner, a);
    await post(c, "Receiving", "10", "Units");
    await post(c, "Transfer", "5", "Units", staff, {
      destination: c.destination.id,
    });
    await Promise.all([
      rawTransaction((db) =>
        rawPost(db, {
          ...movement(c.product, c.location, "Transfer", "2", "Units"),
          destination: c.destination.id,
        }),
      ),
      rawTransaction((db) =>
        rawPost(db, {
          ...movement(c.product, c.destination, "Transfer", "3", "Units"),
          destination: c.location.id,
        }),
      ),
    ]);
    expect(await balance(c.product.id, c.location.id)).toBe("6");
    expect(await balance(c.product.id, c.destination.id)).toBe("4");
    const foreign = await inventory(engine, other, b);
    await expect(
      post(c, "Transfer", "1", "Units", owner, {
        destination: foreign.location.id,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await engine.saveRecord(
      owner,
      a,
      "stock-movements",
      movement(c.product, c.destination, "Receiving", "999999999995", "Units"),
      undefined,
      randomUUID(),
    );
    const before = await engine.snapshot(owner, a);
    await expect(
      post(c, "Transfer", "1", "Units", owner, {
        destination: c.destination.id,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const after = await engine.snapshot(owner, a);
    expect(after.stockBalances).toEqual(before.stockBalances);
    expect(after.stockMovements).toEqual(before.stockMovements);
    expect(after.audit).toEqual(before.audit);
  });
  it("orders packaging changes against raw receipt conversion and rejects a stale repeatable-read command", async () => {
    const c = await inventory(engine, owner, a);
    const results = await Promise.allSettled([
      rawTransaction((db) => rawPost(db, movement(c.product, c.location))),
      rawTransaction((db) =>
        db.query(
          "update lms.records set data=jsonb_set(data,'{case_size}','\"6\"') where organization_id=$1 and id=$2",
          [a, c.product.id],
        ),
      ),
    ]);
    expect(results[1].status).toBe("fulfilled");
    if (results[0].status === "fulfilled")
      expect((await engine.snapshot(owner, a)).stockMovements[0]).toMatchObject(
        { units: "24", case_size: "12" },
      );
    else expect(results[0].reason.code).toBe("23514");
    const current = (await engine.snapshot(owner, a)).records.find(
      (r) => r.id === c.product.id,
    )!;
    await client(name, true, async (db) => {
      await db.query("begin isolation level repeatable read");
      await db.query("set local role lms_app");
      await db.query("select set_config('lms.user_id',$1,true)", [
        owner.userId,
      ]);
      await db.query("select * from lms.records where organization_id=$1", [a]);
      await engine.saveRecord(
        owner,
        a,
        "items",
        { ...current.data, case_size: "3" },
        current,
      );
      await expect(
        rawPost(db, movement(current, c.location)),
      ).rejects.toMatchObject({ code: "40001" });
      await db.query("rollback");
    });
  });
  it("serializes archival with postings, retains balances and restores catalog without replaying movements", async () => {
    const c = await inventory(engine, owner, a);
    await post(c);
    const results = await Promise.allSettled([
      rawTransaction((db) => rawPost(db, movement(c.product, c.location))),
      rawTransaction((db) =>
        db.query(
          "update lms.records set archived=true where organization_id=$1 and id=$2",
          [a, c.product.id],
        ),
      ),
    ]);
    expect(results[1].status).toBe("fulfilled");
    const snap = await engine.snapshot(owner, a),
      archived = snap.records.find((r) => r.id === c.product.id)!;
    expect(archived.archived).toBe(true);
    expect(await balance(c.product.id, c.location.id)).toBe(
      results[0].status === "fulfilled" ? "48" : "24",
    );
    await engine.archiveRecord(
      owner,
      a,
      archived.id,
      archived.revision,
      false,
      randomUUID(),
    );
    expect((await engine.snapshot(owner, a)).stockMovements).toEqual(
      snap.stockMovements,
    );
  });
  it("enforces role and org/location/record-type isolation independently of Engine and keeps projections immutable", async () => {
    const c = await inventory(engine, owner, a),
      foreign = await inventory(engine, other, b);
    for (const p of [staff, viewer])
      await expect(
        rawTransaction(
          (db) =>
            rawPost(
              db,
              movement(
                c.product,
                c.location,
                "Adjustment increase",
                "1",
                "Units",
              ),
              randomUUID(),
              p.userId,
            ),
          p.userId,
        ),
      ).rejects.toMatchObject({ code: "42501" });
    await expect(
      rawTransaction((db) =>
        rawPost(db, {
          ...movement(c.product, c.location),
          product: foreign.product.id,
        }),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      rawTransaction((db) =>
        rawPost(db, {
          ...movement(c.product, c.location),
          location: c.product.id,
        }),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      rawTransaction((db) =>
        rawPost(db, { ...movement(c.product, c.location), quantity: 1 }),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      rawTransaction((db) =>
        db.query(
          "insert into lms.records(organization_id,entity,data,config_revision,created_by,updated_by)values($1,'stock-movements',$2,1,$3,$3)",
          [a, movement(c.product, c.location), owner.userId],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    const first = await post(c);
    for (const sql of [
      "update lms.stock_balances set units=900",
      "delete from lms.stock_movements",
      "insert into lms.stock_balances select * from lms.stock_balances",
    ])
      await expect(rawTransaction((db) => db.query(sql))).rejects.toMatchObject(
        { code: "42501" },
      );
    await expect(
      rawTransaction((db) =>
        db.query(
          "update lms.records set data=data where organization_id=$1 and id=$2",
          [a, first.id],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514" });
    for (const table of ["stock_balances", "stock_movements"])
      expect(
        (
          await engine.asUser(other, (db) =>
            db.query(`select * from lms.${table} where organization_id=$1`, [
              a,
            ]),
          )
        ).rows,
      ).toEqual([]);
  });
  it("retains original receipt after catalog change and supports authorized compensating history with work links", async () => {
    const c = await inventory(engine, owner, a),
      op = randomUUID(),
      data = movement(c.product, c.location),
      first = await engine.saveRecord(
        owner,
        a,
        "stock-movements",
        data,
        undefined,
        op,
      );
    const current = await engine.saveRecord(
      owner,
      a,
      "items",
      { ...c.product.data, case_size: "6", name: "Changed" },
      c.product,
    );
    expect(
      (
        await engine.saveRecord(
          owner,
          a,
          "stock-movements",
          data,
          undefined,
          op,
        )
      ).id,
    ).toBe(first.id);
    await expect(
      engine.saveRecord(
        owner,
        a,
        "stock-movements",
        { ...data, quantity: "1" },
        undefined,
        op,
      ),
    ).rejects.toMatchObject({ status: 409 });
    const c2 = { ...c, product: current };
    await post(c2, "Adjustment decrease", "2", "Units", owner, {
      correction: first.id,
      reason: "Correct fictional over-receipt.",
    });
    await expect(
      post(c2, "Return", "1", "Units", staff, { correction: first.id }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      engine.saveRecord(
        owner,
        a,
        "items",
        { ...current.data, unit: "litre" },
        current,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await balance(c.product.id, c.location.id)).toBe("22");
    const competing = await Promise.allSettled([
      rawTransaction((db) =>
        rawPost(db, {
          ...movement(
            current,
            c.location,
            "Adjustment decrease",
            "15",
            "Units",
          ),
          correction: first.id,
        }),
      ),
      rawTransaction((db) =>
        rawPost(db, {
          ...movement(
            current,
            c.location,
            "Adjustment decrease",
            "15",
            "Units",
          ),
          correction: first.id,
        }),
      ),
    ]);
    expect(competing.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      competing.find((r) => r.status === "rejected")?.reason,
    ).toMatchObject({ code: "23514" });
    expect(await balance(c.product.id, c.location.id)).toBe("7");
    expect((await engine.snapshot(owner, a)).stockMovements).toHaveLength(3);
  });
  it("rejects competing SKU/barcode identities including archived products while allowing independent organizations", async () => {
    const c = await inventory(engine, owner, a);
    await inventory(engine, other, b);
    await engine.archiveRecord(
      owner,
      a,
      c.product.id,
      c.product.revision,
      true,
      randomUUID(),
    );
    for (const extra of [{ sku: "test-001" }, { barcode: "TEST0001" }])
      await expect(
        engine.saveRecord(owner, a, "items", { name: "Duplicate", ...extra }),
      ).rejects.toMatchObject({ status: 409 });
    const results = await Promise.allSettled([
      engine.saveRecord(owner, a, "items", { name: "One", sku: "RACE" }),
      engine.saveRecord(owner, a, "items", { name: "Two", sku: "race" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("requires stopped hosts for migration 9 to 10, preserves prior catalog/config/audits and refuses premature activation", async () => {
    await client(legacyName, false, async (db) => {
      await migrate(db, (await loadMigrations()).slice(0, 9));
      await db.query(
        "insert into lms.users values($1,'Fictional legacy owner')",
        [owner.userId],
      );
      const config = structuredClone(presets.property);
      config.entities = config.entities.filter(
        (e) => !["stock-locations", "stock-movements"].includes(e.id),
      );
      config.navigation = config.navigation.filter(
        (e) => !["stock-locations", "stock-movements"].includes(e),
      );
      const id = randomUUID();
      await org(db, id, owner.userId, config);
      const legacy = await connectPostgres({
        connectionString: url(legacyName, true),
      });
      let before: unknown;
      const snap = async () =>
        (
          await db.query(
            "select (select jsonb_agg(to_jsonb(r))from lms.records r)as records,(select jsonb_agg(to_jsonb(r))from lms.config_revisions r)as config,(select jsonb_agg(to_jsonb(r))from lms.audit_events r)as audit",
          )
        ).rows[0];
      try {
        const e = new Engine(legacy);
        await e.saveRecord(owner, id, "items", {
          name: "Retained old catalog",
          unit: "Box",
        });
        before = await snap();
        await expect(
          e.publishConfig(owner, id, presets.property, 1),
        ).rejects.toMatchObject({
          status: 409,
          message: expect.stringContaining("migration 10"),
        });
        await expect(migrate(db)).rejects.toThrow(/Stop runtime/);
      } finally {
        await legacy.close();
      }
      expect(await migrate(db)).toEqual(["010_inventory_ledger"]);
      expect(await snap()).toEqual(before);
      expect((await db.query("select * from lms.stock_balances")).rows).toEqual(
        [],
      );
    });
  });
  it("restarts and natively backs up/restores fictional stock, immutable history and receipts with activation still blocked", async () => {
    const c = await inventory(engine, owner, a),
      op = randomUUID(),
      data = movement(c.product, c.location),
      first = await engine.saveRecord(
        owner,
        a,
        "stock-movements",
        data,
        undefined,
        op,
      );
    await post(c, "Transfer", "3", "Units", owner, {
      destination: c.destination.id,
    });
    const before = await engine.snapshot(owner, a);
    await db.close();
    db = await connectPostgres({
      connectionString: url(name, true),
      maxConnections: 4,
    });
    engine = new Engine(db);
    expect((await engine.snapshot(owner, a)).stockMovements).toEqual(
      before.stockMovements,
    );
    expect((await engine.snapshot(owner, a)).stockBalances).toEqual(
      before.stockBalances,
    );
    const file = path.join(directory, "inventory.dump");
    await backupDatabase(url(), name, file, process.env.LMS_PG_BIN);
    await restoreDatabase(
      url(restoreName),
      restoreName,
      file,
      process.env.LMS_PG_BIN,
    );
    await client(restoreName, false, async (db) => {
      const rows = (
        await db.query(
          "select product_id,location_id,units::text from lms.stock_balances where organization_id=$1 order by product_id,location_id",
          [a],
        )
      ).rows;
      expect(rows).toEqual(
        before.stockBalances.map(({ product_id, location_id, units }) => ({
          product_id,
          location_id,
          units,
        })),
      );
      expect(
        (
          await db.query(
            "select units::text,case_size::text from lms.stock_movements where organization_id=$1 and record_id=$2",
            [a, first.id],
          )
        ).rows[0],
      ).toEqual({ units: "24", case_size: "12" });
      expect(
        (
          await db.query(
            "select request from lms.record_operations where organization_id=$1 and operation_id=$2",
            [a, op],
          )
        ).rows[0].request.data,
      ).toEqual(data);
      expect(
        (await db.query("select lms_control.is_blocked() as blocked")).rows[0]
          .blocked,
      ).toBe(true);
      expect(
        (
          await db.query(
            "select count(*)::int as count from lms.stock_movements where organization_id=$1",
            [a],
          )
        ).rows[0].count,
      ).toBe(2);
      expect(
        (
          await db.query(
            "select count(*)::int as count from lms.audit_events where organization_id=$1 and entity='stock-movements'",
            [a],
          )
        ).rows[0].count,
      ).toBe(2);
      expect(await migrate(db)).toEqual([]);
    });
    await expect(
      connectPostgres({ connectionString: url(restoreName, true) }),
    ).rejects.toThrow(/activation blocked/i);
  });
});
