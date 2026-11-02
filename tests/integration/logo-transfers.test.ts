import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { createDatabase, sqlDatabase } from "../../src/server/database";
import { Engine } from "../../src/core/engine";
import { privateLogoTransfers } from "../../src/server/postgres/logo-transfers";
import { privateLogoDestinationMap } from "../../src/core/logo-transfers";
import { presets } from "../../src/presets";
import { fictionalBrandedBundle } from "../helpers/branded-logo";
import * as sanitizer from "../../src/server/logo-sanitizer";

let db: Awaited<ReturnType<typeof createDatabase>>, engine: Engine, api: ReturnType<typeof privateLogoTransfers>;
const owner = randomUUID(), staff = randomUUID(), org = randomUUID(), other = randomUUID();
const sid = randomUUID(), staffSid = randomUUID();
let instance: string, sample: Awaited<ReturnType<typeof fictionalBrandedBundle>>;
const resolve = async () => ({userId: owner, sessionId: sid});
const command = (review: unknown) => ({
  format: "lms-private-logo-transfer-command", version: 1, operationId: randomUUID(), review, confirmed: true,
});
async function count(table: string) {
  return (await db.query<{n: number}>("select count(*)::int n from " + table)).rows[0].n;
}
async function protectedRows() {
  return (await db.query("select * from (select 'config' k,to_jsonb(c) d from lms.config_revisions c union all select 'record',to_jsonb(r) from lms.records r union all select 'audit',to_jsonb(a) from lms.audit_events a where entity<>'private-logo-transfer') x order by k,d::text")).rows;
}
beforeAll(async () => {
  db = await createDatabase();
  expect((await db.query("select to_regclass('lms.logo_transfer_receipts') t")).rows).toEqual([{t: null}]);
  await db.exec("create role lms_auth_service nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls");
  for (const file of [
    "002_local_identity", "003_owner_memberships", "004_account_lifecycle", "005_offline_recovery",
    "006_credential_lineage", "013_private_logo_assets", "014_private_logo_associations", "015_private_logo_transfers",
  ]) await db.exec(await readFile("db/" + file + ".sql", "utf8"));
  instance = (await db.query<{id: string}>("select instance_id id from lms_control.state")).rows[0].id;
  // SQL fixture sessions exercise actual shared guards; native suite signs in with actual Better Auth.
  for (const [user, session] of [[owner, sid], [staff, staffSid]]) {
    await db.query("insert into lms.users values($1,'Fictional transfer fixture')", [user]);
    await db.query('insert into lms_identity."user"(id,name,email) values($1,\'Fictional transfer\',$2)', [user, user + "@example.test"]);
    await db.query('insert into lms_identity.session(id,"userId",token,"expiresAt") values($1,$2,$3,clock_timestamp()+interval \'1 hour\')', [session, user, randomUUID()]);
  }
  await db.query("select set_config('lms.user_id',$1,false)", [owner]);
  for (const group of [org, other]) {
    await db.query("insert into lms.organizations values($1,'Fictional transfer lab')", [group]);
    await db.query("insert into lms.memberships values($1,$2,'owner')", [group, owner]);
    await db.query("insert into lms.config_revisions(organization_id,revision,document,created_by) values($1,1,$2,$3)", [group, presets.property, owner]);
  }
  await db.query("insert into lms.memberships values($1,$2,'staff')", [org, staff]);
  engine = new Engine(sqlDatabase(db));
  api = privateLogoTransfers((actor, _org, fn) => engine.asUser(actor, fn), instance, error => {throw error;});
  sample = await fictionalBrandedBundle();
  await engine.saveRecord({userId: owner}, org, "customers", {name: "Private fictional row never transferred"});
});
afterAll(async () => { vi.restoreAllMocks(); sample?.image.fill(0); await db?.close(); });

it("re-sanitizes and commits a new unselected asset and private map without publication or record changes", async () => {
  const before = await protectedRows(), {review} = await api.review(resolve, org, sample.bundle), cmd = command(review);
  const decoder = vi.spyOn(sanitizer, "sanitizeLogo");
  const receipt = privateLogoDestinationMap.parse(await api.accept(resolve, org, sample.bundle, cmd));
  expect(decoder).toHaveBeenCalledOnce(); decoder.mockRestore();
  expect(receipt.review.source.bundleSha256).toBe(createHash("sha256").update(sample.bundle).digest("hex"));
  expect(receipt.asset).toMatchObject({revision: 1, state: "stored", sha256: createHash("sha256").update(sample.image).digest("hex")});
  expect((await db.query("select asset_id from lms.logo_asset_states where organization_id=$1", [org])).rows).toEqual([{asset_id: null}]);
  expect(await count("lms.logo_associations")).toBe(0);
  expect(await protectedRows()).toEqual(before);
  expect(await api.history(resolve, org)).toEqual([receipt]);
  const audit = (await db.query("select after_data from lms.audit_events where entity='private-logo-transfer'")).rows;
  expect(audit).toHaveLength(1);
  for (const value of [receipt.asset.sha256, receipt.review.source.bundleSha256, sid, owner, sample.image.toString("base64")])
    expect(JSON.stringify(audit)).not.toContain(value);
  expect(await api.accept(resolve, org, sample.bundle, cmd)).toEqual(receipt);
  expect(await count("lms.logo_assets")).toBe(1);
  await expect(api.accept(resolve, org, sample.bundle, {
    ...cmd, review: {...review, reviewedAt: "2020-01-01T00:00:00.000Z", expiresAt: "2020-01-01T00:10:00.000Z"},
  })).rejects.toMatchObject({code: "40001"});
});
it("refuses cross-organization replay, wrong actor, stale configuration/asset revisions and unconfirmed instructions", async () => {
  const {review} = await api.review(resolve, org, sample.bundle);
  await expect(api.accept(resolve, other, sample.bundle, command(review))).rejects.toMatchObject({status: 409});
  await expect(api.accept(async () => ({userId: staff, sessionId: staffSid}), org, sample.bundle, command(review))).rejects.toMatchObject({status: 409});
  await expect(api.accept(resolve, org, sample.bundle, {...command(review), confirmed: false})).rejects.toThrow();
  await expect(api.accept(resolve, org, sample.bundle, {...command(review), sql: "drop schema lms"})).rejects.toThrow();
  await engine.publishConfig({userId: owner}, org, {...presets.property, name: "Fictional revised destination"}, 1);
  await expect(api.accept(resolve, org, sample.bundle, command(review))).rejects.toMatchObject({status: 409});
  const r2 = (await api.review(resolve, org, sample.bundle)).review;
  await api.accept(resolve, org, sample.bundle, command(r2));
  await expect(api.accept(resolve, org, sample.bundle, command(r2))).rejects.toMatchObject({status: 409});
});
it("rejects changed bytes, oversized/unsafe files and unsupported sanitizer profiles without mutation", async () => {
  const before = await count("lms.logo_assets"), {review} = await api.review(resolve, org, sample.bundle);
  const tampered = new Uint8Array(sample.bundle); tampered[100] ^= 1;
  await expect(api.accept(resolve, org, tampered, command(review))).rejects.toMatchObject({status: 400});
  await expect(api.accept(resolve, org, new Uint8Array(393217), command(review))).rejects.toMatchObject({status: 413});
  await expect(api.review(resolve, org, new TextEncoder().encode("<svg/>"))).rejects.toMatchObject({status: 400});
  await expect(api.accept(resolve, org, sample.bundle, {...command(review), review: {...review, sanitizer: "trust-source"}})).rejects.toThrow();
  expect(await count("lms.logo_assets")).toBe(before);
});
it("rejects revoked, missing, expired and non-recent sessions, including expiry during native processing", async () => {
  const {review} = await api.review(resolve, org, sample.bundle), before = await count("lms.logo_assets");
  await expect(api.accept(async () => null, org, sample.bundle, command(review))).rejects.toMatchObject({status: 401});
  const decode = sanitizer.sanitizeLogo;
  const spy = vi.spyOn(sanitizer, "sanitizeLogo").mockImplementationOnce(async bytes => {
    const image = await decode(bytes);
    await db.query('update lms_identity.session set "expiresAt"=clock_timestamp()-interval \'1 second\' where id=$1', [sid]);
    return image;
  });
  try { await expect(api.accept(resolve, org, sample.bundle, command(review))).rejects.toMatchObject({code: "28000"}); }
  finally {
    spy.mockRestore();
    await db.query('update lms_identity.session set "expiresAt"=clock_timestamp()+interval \'1 hour\' where id=$1', [sid]);
  }
  await db.query('update lms_identity.session set "createdAt"=clock_timestamp()-interval \'6 minutes\' where id=$1', [sid]);
  await expect(api.review(resolve, org, sample.bundle)).rejects.toMatchObject({code: "28000"});
  await db.query('update lms_identity.session set "createdAt"=clock_timestamp() where id=$1', [sid]);
  await expect(api.history(async () => ({userId: owner, sessionId: randomUUID()}), org)).rejects.toMatchObject({code: "28000"});
  expect(await count("lms.logo_assets")).toBe(before);
});
it("rolls back asset/history/receipt/cursor/audit effects when mapping insertion fails", async () => {
  const before = await protectedRows();
  const tables = ["lms.logo_assets", "lms.logo_asset_history", "lms.logo_asset_receipts", "lms.logo_transfer_receipts", "lms.audit_events"];
  const counts = await Promise.all(tables.map(count)), {review} = await api.review(resolve, org, sample.bundle);
  await db.exec("create function lms_private.test_transfer_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic failure' using errcode='53100';end;$$; create trigger test_transfer_failure before insert on lms.logo_transfer_receipts for each row execute function lms_private.test_transfer_failure()");
  try { await expect(api.accept(resolve, org, sample.bundle, command(review))).rejects.toMatchObject({code: "53100"}); }
  finally { await db.exec("drop trigger test_transfer_failure on lms.logo_transfer_receipts;drop function lms_private.test_transfer_failure()"); }
  expect(await Promise.all(tables.map(count))).toEqual(counts);
  expect(await protectedRows()).toEqual(before);
});
it("forces RLS, retains immutable receipt bytes and denies direct mapping writes", async () => {
  const history = await api.history(resolve, org);
  for (const sql of [
    "delete from lms.logo_transfer_receipts", "update lms.logo_transfer_receipts set result='{}'", "truncate lms.logo_transfer_receipts",
  ]) await expect(engine.asUser({userId: owner}, tx => tx.exec(sql))).rejects.toMatchObject({code: "42501"});
  await expect(db.exec("delete from lms.logo_transfer_receipts")).rejects.toMatchObject({code: "23514"});
  expect((await engine.asUser({userId: staff}, tx => tx.query("select * from lms.logo_transfer_receipts"))).rows).toEqual([]);
  expect(await api.history(resolve, org)).toEqual(history);
  expect((await db.query("select relrowsecurity r,relforcerowsecurity f from pg_class where oid='lms.logo_transfer_receipts'::regclass")).rows).toEqual([{r: true, f: true}]);
});
it("expires first-use reviews and revalidates COMPLETE configuration before the storage transaction commits", async () => {
  const {review} = await api.review(resolve, other, sample.bundle);
  await expect(api.accept(resolve, other, sample.bundle, command({
    ...review, reviewedAt: "2020-01-01T00:00:00.000Z", expiresAt: "2020-01-01T00:10:00.000Z",
  }))).rejects.toMatchObject({code: "40001"});
  const badOrg = randomUUID();
  await db.query("insert into lms.organizations values($1,'Fictional unsupported lab')", [badOrg]);
  await db.query("insert into lms.memberships values($1,$2,'owner')", [badOrg, owner]);
  await db.query("insert into lms.config_revisions(organization_id,revision,document,created_by) values($1,1,$2,$3)", [
    badOrg, {...presets.property, modules: presets.property.modules.map(m => ({...m, version: "99.0.0"}))}, owner,
  ]);
  const rawReview = (await engine.asUser({userId: owner}, tx => tx.query<{r: unknown}>(
    "select lms.logo_transfer_review($1,$2,$3,$4) r", [badOrg, instance, sid, review.source],
  ))).rows[0].r;
  // Bypass only the PRECHECK reader in test to isolate authoritative validation after actual SQL storage.
  const bypass = privateLogoTransfers(async (actor, _org, fn) => engine.asUser(actor, async tx => {
    const query = tx.query.bind(tx);
    return fn({...tx, query: async <T>(sql: string, params?: unknown[]) => {
      const result = await query<T>(sql, params);
      if (sql.includes("logo_transfer_state"))
        for (const row of result.rows as {document: {configuration: unknown}}[]) row.document.configuration = presets.property;
      return result;
    }});
  }), instance, error => {throw error;});
  const before = await count("lms.logo_assets");
  await expect(bypass.accept(resolve, badOrg, sample.bundle, command(rawReview))).rejects.toThrow();
  expect(await count("lms.logo_assets")).toBe(before);
  expect((await db.query("select * from lms.logo_transfer_receipts where organization_id=$1", [badOrg])).rows).toEqual([]);
});
it("does not turn a receipt or bundle into a recovery activation token", async () => {
  await db.exec("update lms_control.state set blocked=true,reason='recovery-pending'");
  await expect(api.history(resolve, org)).rejects.toMatchObject({code: "55000"});
  await expect(api.review(resolve, org, sample.bundle)).rejects.toMatchObject({code: "55000"});
});
