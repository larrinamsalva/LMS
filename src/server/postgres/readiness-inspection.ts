import { createHmac, randomUUID } from "node:crypto";
import type { Client } from "pg";
import { validateConfig } from "../../core/config";
import { validateBuildPlan } from "../../core/buildplan";
import { checksum, loadMigrations } from "./migrations";

// Closed inventory, not caller-supplied SQL identifiers. New schemas need code review.
export const readinessTables = [
  "lms.users",
  "lms.organizations",
  "lms.memberships",
  "lms.config_revisions",
  "lms.records",
  "lms.audit_events",
  "lms.access_versions",
  "lms.access_receipts",
  "lms.record_links",
  "lms.appointments",
  "lms.record_operations",
  "lms.resource_memberships",
  "lms.availability_windows",
  "lms.appointment_staff",
  "lms.service_rates",
  "lms.estimate_lines",
  "lms.estimate_versions",
  "lms.stock_balances",
  "lms.stock_movements",
  "lms.build_plan_revisions",
  "lms_identity.user",
  "lms_identity.session",
  "lms_identity.account",
  "lms_identity.verification",
  "lms_identity.rate_limit",
  "lms_identity.credential_events",
  "lms_identity.credential_versions",
  "lms_private.membership_reviews",
  "lms_private.workspace_bootstraps",
  "lms_private.recovery_trust",
  "lms_private.recovery_cases",
  "lms_private.recovery_events",
  "lms_private.lineage_stream",
  "lms_private.lineage_entries",
  "lms_private.record_epochs",
  "lms_control.state",
  "lms_meta.migrations",
] as const;
export const transientTables = new Set([
  "lms_identity.session",
  "lms_identity.verification",
  "lms_private.membership_reviews",
  "lms_private.recovery_cases",
]);
export const quotedTable = (name: string) =>
  name
    .split(".")
    .map((s) => '"' + s + '"')
    .join(".");
const schemas = [
  "lms",
  "lms_private",
  "lms_identity",
  "lms_control",
  "lms_meta",
];
const assert = (truth: unknown) => {
  if (!truth) throw new Error("Unsupported native evidence.");
};
export interface NativeObservation {
  signatures: Record<string, string>;
  counts: Record<string, number>;
  catalog: Record<string, string>;
  configurationSchemas: number[];
  buildPlanVersions: number[];
}

/** Checks source and copy using the same original migration bytes, never migrate(). */
export async function inspectSchema(client: Client, restored: boolean) {
  const files = await loadMigrations();
  const rows = (
    await client.query(
      "select version,name,checksum from lms_meta.migrations order by version",
    )
  ).rows;
  assert(
    rows.length === files.length &&
      rows.every(
        (r, i) =>
          r.version === files[i].version &&
          r.name === files[i].name &&
          r.checksum === checksum(files[i].sql),
      ),
  );
  const tables = (
    await client.query(`select n.nspname||'.'||c.relname as name,c.relrowsecurity as rls,c.relforcerowsecurity as forced,
    pg_get_userbyid(c.relowner)=current_user as owned,c.relkind
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname !~ '^pg_' and n.nspname<>'information_schema' and c.relkind in ('r','p','v','m','f','S') order by 1`)
  ).rows;
  const expected: string[] = [
    ...readinessTables,
    ...(restored ? ["lms_control.restore_blocker"] : []),
  ].sort();
  assert(
    JSON.stringify(tables.map((r) => r.name)) === JSON.stringify(expected),
  );
  assert(
    tables.every((r) => r.rls && r.forced && r.owned && r.relkind === "r"),
  );
  const unsafe = (
    await client.query(`select 1 from pg_roles r where r.rolname in ('lms_app','lms_auth_service') and
    (r.rolcanlogin or r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolinherit or r.rolbypassrls
     or exists(select 1 from pg_auth_members m where m.member=r.oid))`)
  ).rows;
  assert(
    !unsafe.length &&
      (
        await client.query(
          "select count(*)::int as n from pg_roles where rolname in ('lms_app','lms_auth_service')",
        )
      ).rows[0].n === 2,
  );
  for (const table of readinessTables.filter(
    (t) =>
      t.startsWith("lms_private.") ||
      t === "lms_meta.migrations" ||
      t === "lms_identity.credential_versions",
  )) {
    for (const role of ["lms_app", "lms_auth_service"])
      assert(
        !(
          await client.query(
            "select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') as unsafe",
            [role, table],
          )
        ).rows[0].unsafe,
      );
  }
  assert(
    !(
      await client.query(
        "select has_table_privilege('lms_app','lms_identity.account','SELECT,INSERT,UPDATE,DELETE') as unsafe",
      )
    ).rows[0].unsafe,
  );
  assert(
    !(
      await client.query(
        `select 1 from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname=any($1) and not convalidated limit 1`,
        [schemas],
      )
    ).rows.length,
  );
  // Reject extra non-extension routines; dumps are executable trusted SQL, not an import format.
  assert(
    !(
      await client.query(
        `select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname !~ '^pg_' and n.nspname<>'information_schema' and n.nspname<>all($1)
    and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') limit 1`,
        [schemas],
      )
    ).rows.length,
  );
  assert(
    !(
      await client.query(
        "select 1 from pg_extension where extname not in ('plpgsql','btree_gist')",
      )
    ).rows.length,
  );
  return files.length;
}

/** Internal HMACs never leave this process/report. Hash original JSON text, retaining exact SQL numbers. */
export async function observeNative(
  client: Client,
  key: Buffer,
): Promise<NativeObservation> {
  const signatures: Record<string, string> = {},
    counts: Record<string, number> = {};
  let bytes = 0,
    total = 0;
  const versions = new Set<number>(),
    plans = new Set<number>();
  for (const table of readinessTables) {
    const rows = (
      await client.query(
        `select to_jsonb(t)::text as document from ${quotedTable(table)} t limit 10001`,
      )
    ).rows.map((r) => r.document as string);
    total += rows.length;
    assert(rows.length <= 10000 && total <= 50000);
    bytes += rows.reduce((n, r) => n + Buffer.byteLength(r), 0);
    assert(bytes <= 16 * 1024 * 1024);
    // Group by tenant before hashing; global identity/control history is compared separately.
    const groups = new Map<string, string[]>();
    for (const row of rows) {
      const data = JSON.parse(row),
        scope = data.organization_id ?? "global";
      const group = groups.get(scope) ?? [];
      group.push(row);
      groups.set(scope, group);
      if (table === "lms.config_revisions")
        versions.add(validateConfig(data.document).schemaVersion);
      if (table === "lms.build_plan_revisions")
        plans.add(validateBuildPlan(data.document).version);
    }
    signatures[table] = createHmac("sha256", key)
      .update(
        JSON.stringify(
          [...groups]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([scope, values]) => [scope, values.sort()]),
        ),
      )
      .digest("hex");
    counts[table] = rows.length;
  }
  assert(versions.size > 0);
  const catalog: Record<string, string> = {};
  // pg_dump may serialize a default ACL as NULL rather than an explicit default.
  // Compare PostgreSQL's actual grant entries, retaining PUBLIC, grantor and grant options.
  const acl = (
    value: string,
    kind: string,
    owner: string,
  ) => `array(select jsonb_build_array(pg_get_userbyid(x.grantor),case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable)
    from aclexplode(coalesce(${value},acldefault('${kind}',${owner}))) x order by x.grantor,x.grantee,x.privilege_type,x.is_grantable)`;
  const queries = [
    `select jsonb_build_array(n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,
      ${acl("c.relacl", "r", "c.relowner")},
      array(select jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid),${acl("a.attacl", "c", "c.relowner")}) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped order by a.attnum))::text as document
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=any($1) and c.relkind='r' and c.relname<>'restore_blocker'`,
    // PostgreSQL's own formatter preserves precedence while normalizing equivalent AND nesting after dump/reparse.
    `select jsonb_build_array(n.nspname,c.relname,x.conname,pg_get_constraintdef(x.oid,true),x.convalidated)::text as document from pg_constraint x join pg_class c on c.oid=x.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=any($1) and c.relname<>'restore_blocker'`,
    `select to_jsonb(p)::text as document from pg_policies p where schemaname=any($1) and tablename<>'restore_blocker'`,
    `select jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid),${acl("p.proacl", "f", "p.proowner")})::text as document from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=any($1)`,
    `select jsonb_build_array(n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid))::text as document from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=any($1) and not t.tgisinternal`,
    `select jsonb_build_array(schemaname,tablename,indexname,indexdef)::text as document from pg_indexes where schemaname=any($1) and tablename<>'restore_blocker'`,
  ];
  for (const [index, sql] of queries.entries()) {
    const rows = (await client.query(sql, [schemas])).rows;
    assert(rows.length <= 10000);
    catalog[
      ["tables", "constraints", "policies", "functions", "triggers", "indexes"][
        index
      ]
    ] = createHmac("sha256", key)
      .update(JSON.stringify(rows.map((r) => r.document as string).sort()))
      .digest("hex");
  }
  return {
    signatures,
    counts,
    catalog,
    configurationSchemas: [...versions].sort(),
    buildPlanVersions: [...plans].sort(),
  };
}

export function sameNative(
  source: NativeObservation,
  target: NativeObservation,
  restored: boolean,
) {
  const names = Object.keys(source.catalog).sort();
  assert(
    JSON.stringify(names) ===
      JSON.stringify(Object.keys(target.catalog).sort()),
  );
  assert(names.every((name) => source.catalog[name] === target.catalog[name]));
  for (const table of readinessTables) {
    if (restored && transientTables.has(table))
      assert(target.counts[table] === 0);
    else if (!(restored && table === "lms_control.state"))
      assert(source.signatures[table] === target.signatures[table]);
  }
}

/** Actual database policies under the existing role/context; no grants or synthetic memberships. */
export async function inspectIsolation(client: Client) {
  await client.query("set local role lms_app");
  try {
    await client.query("select set_config('lms.user_id',$1,true)", [
      randomUUID(),
    ]);
    for (const table of readinessTables.filter((t) => t.startsWith("lms."))) {
      assert(
        !(await client.query(`select 1 from ${quotedTable(table)} limit 1`))
          .rows.length,
      );
    }
    assert(
      !(
        await client.query(
          "select has_table_privilege(current_user,'lms.audit_events','DELETE') or has_table_privilege(current_user,'lms.memberships','UPDATE') or has_table_privilege(current_user,'lms.stock_movements','UPDATE') as unsafe",
        )
      ).rows[0].unsafe,
    );
  } finally {
    await client.query("reset role");
  }
}
