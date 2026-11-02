import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createDatabase, sqlDatabase } from "../../src/server/database";
import { Engine } from "../../src/core/engine";
import { presets } from "../../src/presets";
import { selectModules } from "../../src/core/buildplan";
import { reviewedEstimate, conversion } from "../helpers/invoices";
import { savedPricing } from "../helpers/pricing";
import { invoiceLabel } from "../../src/core/invoices";
let db: PGlite, engine: Engine, org: string;
const owner = { userId: randomUUID() },
  other = { userId: randomUUID() },
  staff = { userId: randomUUID() };
beforeAll(async () => {
  db = await createDatabase();
  engine = new Engine(sqlDatabase(db));
  for (const p of [owner, other, staff])
    await db.query(
      "insert into lms.users values($1,'Fictional invoice operator')",
      [p.userId],
    );
});
beforeEach(async () => {
  org = randomUUID();
  await db.query(
    "insert into lms.organizations values($1,'Fictional invoices')",
    [org],
  );
  await db.query(
    "insert into lms.memberships values($1,$2,'owner'),($1,$3,'staff')",
    [org, owner.userId, staff.userId],
  );
  const config = selectModules(presets.property, [
    ...presets.property.modules.map((m) => m.id),
    "invoice-drafts",
  ]);
  await db.transaction(async (tx) => {
    await tx.query("select set_config('lms.user_id',$1,true)", [owner.userId]);
    await tx.query(
      "insert into lms.config_revisions(organization_id,revision,document,created_by) values($1,1,$2,$3)",
      [org, config, owner.userId],
    );
  });
});
afterAll(async () => {
  await db?.close();
});
it("converts only the reviewed revision, retains exact snapshots after rate changes and deduplicates receipts", async () => {
  const c = await reviewedEstimate(engine, owner, org),
    op = randomUUID(),
    req = conversion(c.estimate);
  const invoice = await engine.writeInvoiceDraft(owner, org, req, op);
  expect(savedPricing(invoice)).toEqual(savedPricing(c.estimate));
  await engine.saveRecord(
    owner,
    org,
    "service-rates",
    { ...c.rate.data, amount: "9000" },
    c.rate,
  );
  expect(await engine.writeInvoiceDraft(owner, org, req, op)).toEqual(invoice);
  await expect(
    engine.writeInvoiceDraft(owner, org, req, randomUUID()),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    engine.writeInvoiceDraft(owner, org, { ...req, estimateRevision: 1 }, op),
  ).rejects.toMatchObject({ status: 409 });
  const s = await engine.snapshot(owner, org);
  expect(s.invoiceVersions).toHaveLength(1);
  expect(s.audit.filter((a) => a.record_id === invoice.id)).toHaveLength(1);
});
it("appends exact corrections, reasons and a terminal void without losing original values", async () => {
  const c = await reviewedEstimate(engine, owner, org),
    first = await engine.writeInvoiceDraft(
      owner,
      org,
      conversion(c.estimate),
      randomUUID(),
    );
  const pricing = {
    ...savedPricing(first),
    lines: savedPricing(first).lines.map((l) => ({ ...l, quantity: "2" })),
  };
  const req = {
    kind: "correct",
    invoiceId: first.id,
    revision: 1,
    configRevision: 1,
    acknowledgement: invoiceLabel,
    reason: "Corrected fictional quantity",
    notes: "Reviewed internally",
    pricing,
  };
  const second = await engine.writeInvoiceDraft(owner, org, req, randomUUID());
  expect(savedPricing(second).totalMinor).toBe("2002");
  const voided = await engine.writeInvoiceDraft(
    owner,
    org,
    {
      kind: "void",
      invoiceId: first.id,
      revision: 2,
      configRevision: 1,
      acknowledgement: invoiceLabel,
      reason: "Voided fictional demonstration",
    },
    randomUUID(),
  );
  expect(voided.data.status).toBe("Void");
  await expect(
    engine.writeInvoiceDraft(owner, org, { ...req, revision: 3 }, randomUUID()),
  ).rejects.toMatchObject({ status: 409 });
  const s = await engine.snapshot(owner, org);
  expect(s.invoiceVersions.map((v) => v.data.status)).toEqual([
    "Draft",
    "Draft",
    "Void",
  ]);
  expect(
    (s.invoiceVersions[0].data.pricing as unknown as { totalMinor: string })
      .totalMinor,
  ).toBe("501");
  await expect(
    engine.saveRecord(owner, org, "invoice-drafts", first.data),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    engine.archiveRecord(owner, org, first.id, 3, true),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    engine.asUser(owner, (tx) => tx.query("delete from lms.invoice_versions")),
  ).rejects.toMatchObject({ code: "42501" });
});
it("requires current authority, confirmation, source state, scoped links and exact revisions", async () => {
  const c = await reviewedEstimate(engine, owner, org),
    req = conversion(c.estimate);
  for (const p of [staff, other])
    await expect(
      engine.writeInvoiceDraft(p, org, req, randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
  for (const change of [{ estimateRevision: 1 }, { configRevision: 2 }])
    await expect(
      engine.writeInvoiceDraft(owner, org, { ...req, ...change }, randomUUID()),
    ).rejects.toMatchObject({ status: 409 });
  await expect(
    engine.writeInvoiceDraft(
      owner,
      org,
      { ...req, acknowledgement: "issue" },
      randomUUID(),
    ),
  ).rejects.toThrow();
  await engine.saveRecord(
    owner,
    org,
    "estimates",
    { ...c.estimate.data, status: "Void" },
    c.estimate,
  );
  await expect(
    engine.writeInvoiceDraft(
      owner,
      org,
      { ...req, estimateRevision: 3 },
      randomUUID(),
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect((await engine.snapshot(owner, org)).invoiceVersions).toEqual([]);
  expect(
    (
      await engine.asUser(other, (tx) =>
        tx.query(
          "select * from lms.invoice_versions where organization_id=$1",
          [org],
        ),
      )
    ).rows,
  ).toEqual([]);
});
