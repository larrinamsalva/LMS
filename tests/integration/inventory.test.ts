import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createDatabase, sqlDatabase } from "../../src/server/database";
import { Engine } from "../../src/core/engine";
import { presets } from "../../src/presets";
import { inventory, movement } from "../helpers/inventory";
let db: PGlite, engine: Engine, a: string, b: string;
const owner = { userId: randomUUID() },
  other = { userId: randomUUID() },
  staff = { userId: randomUUID() },
  viewer = { userId: randomUUID() };
beforeAll(async () => {
  db = await createDatabase();
  engine = new Engine(sqlDatabase(db));
  for (const p of [owner, other, staff, viewer])
    await db.query(
      "insert into lms.users values($1,'Fictional pricing principal')",
      [p.userId],
    );
});
beforeEach(async () => {
  a = randomUUID();
  b = randomUUID();
  for (const [org, p, industry] of [
    [a, owner, "property"],
    [b, other, "cleaning"],
  ] as const) {
    await db.query(
      "insert into lms.organizations values($1,'Fictional pricing')",
      [org],
    );
    await db.query("insert into lms.memberships values($1,$2,'owner')", [
      org,
      p.userId,
    ]);
    await db.transaction(async (tx) => {
      await tx.query("select set_config('lms.user_id',$1,true)", [p.userId]);
      await tx.query(
        "insert into lms.config_revisions(organization_id,revision,document,created_by)values($1,1,$2,$3)",
        [org, presets[industry], p.userId],
      );
    });
  }
  for (const [p, role] of [
    [staff, "staff"],
    [viewer, "viewer"],
  ] as const)
    await db.query("insert into lms.memberships values($1,$2,$3)", [
      a,
      p.userId,
      role,
    ]);
});
afterAll(async () => {
  await db?.close();
});
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
const balance = async (product: string, location: string) =>
  (await engine.snapshot(owner, a)).stockBalances.find(
    (b) => b.product_id === product && b.location_id === location,
  )?.units ?? "0";
it("receives exact cases, uses/returns units and transfers atomically with complete historical snapshots", async () => {
  const c = await inventory(engine, owner, a);
  await post(c);
  await post(c, "Usage", "3", "Units", staff);
  await post(c, "Return", "1", "Units", staff);
  await post(c, "Transfer", "4", "Units", staff, {
    destination: c.destination.id,
  });
  expect(await balance(c.product.id, c.location.id)).toBe("18");
  expect(await balance(c.product.id, c.destination.id)).toBe("4");
  const m = (await engine.snapshot(owner, a)).stockMovements;
  expect(m).toHaveLength(4);
  expect(m.find((x) => x.action === "Receiving")).toMatchObject({
    units: "24",
    case_size: "12",
    actor_id: owner.userId,
    product_name: "Fictional supply",
    location_name: "Stock room",
  });
  const changed = await engine.saveRecord(
    owner,
    a,
    "items",
    { ...c.product.data, name: "Changed name", case_size: "6" },
    c.product,
  );
  expect(
    (await engine.snapshot(owner, a)).stockMovements.find(
      (x) => x.action === "Receiving",
    )?.product_name,
  ).toBe("Fictional supply");
  await expect(post(c)).rejects.toMatchObject({ status: 409 });
  await engine.saveRecord(
    owner,
    a,
    "stock-movements",
    movement(changed, c.location, "Receiving", "1", "Cases"),
    undefined,
    randomUUID(),
  );
  expect(await balance(c.product.id, c.location.id)).toBe("24");
});
it("deduplicates original retry receipts after product changes and keeps one movement/audit", async () => {
  const c = await inventory(engine, owner, a),
    op = randomUUID(),
    data = movement(c.product, c.location);
  const first = await engine.saveRecord(
    owner,
    a,
    "stock-movements",
    data,
    undefined,
    op,
  );
  await engine.saveRecord(
    owner,
    a,
    "items",
    { ...c.product.data, case_size: "6" },
    c.product,
  );
  expect(
    (await engine.saveRecord(owner, a, "stock-movements", data, undefined, op))
      .id,
  ).toBe(first.id);
  await expect(
    engine.saveRecord(
      owner,
      a,
      "stock-movements",
      { ...data, quantity: "3" },
      undefined,
      op,
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(await balance(c.product.id, c.location.id)).toBe("24");
  expect(
    (await engine.snapshot(owner, a)).audit.filter(
      (x) => x.record_id === first.id,
    ),
  ).toHaveLength(1);
});
it("rejects underflow, source mutation/archive, direct projections and unauthorized adjustments", async () => {
  const c = await inventory(engine, owner, a),
    r = await post(c);
  await expect(post(c, "Usage", "25", "Units")).rejects.toMatchObject({
    status: 409,
  });
  await expect(
    post(c, "Adjustment increase", "1", "Units", staff),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    post(c, "Receiving", "1", "Units", viewer),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    engine.saveRecord(staff, a, "items", { name: "Unauthorized" }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    engine.saveRecord(owner, a, "stock-movements", r.data, r, randomUUID()),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    engine.archiveRecord(owner, a, r.id, r.revision, true, randomUUID()),
  ).rejects.toMatchObject({ status: 409 });
  for (const query of [
    "delete from lms.stock_movements",
    "update lms.stock_balances set units=999",
    "delete from lms.records where entity='stock-movements'",
  ])
    await expect(
      engine.asUser(owner, (tx) => tx.query(query)),
    ).rejects.toMatchObject({ code: "42501" });
  await expect(
    engine.asUser(owner, (tx) =>
      tx.query(
        "update lms.records set data=data where organization_id=$1 and id=$2",
        [a, r.id],
      ),
    ),
  ).rejects.toMatchObject({ code: "23514" });
  expect(await balance(c.product.id, c.location.id)).toBe("24");
});
it("protects organization/location isolation and preserves archived history, stock and SKU uniqueness", async () => {
  const c = await inventory(engine, owner, a),
    foreign = await inventory(engine, other, b);
  await expect(
    post(c, "Receiving", "1", "Units", owner, {
      location: foreign.location.id,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    post(c, "Transfer", "1", "Units", owner, {
      destination: foreign.destination.id,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await post(c);
  const archived = await engine.archiveRecord(
    owner,
    a,
    c.product.id,
    c.product.revision,
    true,
    randomUUID(),
  );
  expect(await balance(c.product.id, c.location.id)).toBe("24");
  await expect(post(c)).rejects.toMatchObject({ status: 409 });
  await expect(
    engine.saveRecord(owner, a, "items", {
      name: "Duplicate",
      sku: "test-001",
    }),
  ).rejects.toMatchObject({ status: 409 });
  const restored = await engine.archiveRecord(
    owner,
    a,
    c.product.id,
    archived.revision,
    false,
    randomUUID(),
  );
  await engine.saveRecord(
    owner,
    a,
    "stock-movements",
    movement(restored, c.location, "Usage", "1", "Units"),
    undefined,
    randomUUID(),
  );
  expect((await engine.snapshot(owner, a)).stockMovements).toHaveLength(2);
  expect(
    (
      await engine.asUser(other, (tx) =>
        tx.query("select * from lms.stock_balances where organization_id=$1", [
          a,
        ]),
      )
    ).rows,
  ).toEqual([]);
  expect(
    (
      await engine.asUser(other, (tx) =>
        tx.query("select * from lms.stock_movements where organization_id=$1", [
          a,
        ]),
      )
    ).rows,
  ).toEqual([]);
});
it("requires operation IDs and makes authorized linked corrections new history with no negative stock", async () => {
  const c = await inventory(engine, owner, a),
    r = await post(c);
  await expect(
    engine.saveRecord(
      owner,
      a,
      "stock-movements",
      movement(c.product, c.location),
    ),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    post(c, "Return", "1", "Units", staff, { correction: r.id }),
  ).rejects.toMatchObject({ status: 403 });
  await post(c, "Adjustment decrease", "2", "Units", owner, {
    correction: r.id,
    reason: "Correct over-receipt.",
  });
  expect(await balance(c.product.id, c.location.id)).toBe("22");
  expect((await engine.exportWorkspace(owner, a)).stockMovements).toHaveLength(
    2,
  );
  const archived = await engine.archiveRecord(
    owner,
    a,
    c.location.id,
    c.location.revision,
    true,
    randomUUID(),
  );
  await expect(post(c, "Usage", "1", "Units")).rejects.toMatchObject({
    status: 409,
  });
  await engine.archiveRecord(
    owner,
    a,
    c.location.id,
    archived.revision,
    false,
    randomUUID(),
  );
  expect(await balance(c.product.id, c.location.id)).toBe("22");
});
