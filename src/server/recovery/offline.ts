import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { localTarget } from "../postgres/targets";
import { replaceCredential } from "../auth/lifecycle";
import { passwordCodec } from "../auth/password";
import { passwordPolicy } from "../auth/config";
import { EngineError } from "../../core/engine";
import {
  canonical,
  digest,
  readTrust,
  verifyAttestation,
  type Trust,
} from "./trust";
const id = z.uuid();
export const openCaseSchema = z
  .object({
    subjectId: id,
    evidenceId: id,
    confirmation: z.literal("OPEN OFFLINE RECOVERY AND BLOCK ACTIVATION"),
  })
  .strict();
export const signedCaseSchema = z
  .object({
    caseId: id,
    operatorId: id,
    signature: z.string().max(100),
    confirmation: z.literal("I VERIFIED THE OFFLINE RECOVERY REVIEW"),
  })
  .strict();
export const applyCaseSchema = z
  .object({
    caseId: id,
    newPassword: z
      .string()
      .min(passwordPolicy.minLength)
      .max(passwordPolicy.maxLength),
    confirmation: z.literal(
      "RECOVER FICTIONAL ACCOUNT AND REVOKE ALL SESSIONS",
    ),
  })
  .strict();
interface Context {
  protocol: string;
  instanceId: string;
  caseId: string;
  subjectId: string;
  credentialVersion: string;
  membershipDigest: string;
  registryDigest: string;
  evidenceId: string;
  evidenceDigest: string;
  createdAt: string;
  expiresAt: string;
  effect: string;
}
interface Proof {
  operatorId: string;
  signature: string;
}
interface Case {
  id: string;
  subject_id: string;
  account_id: string;
  registry_digest: string;
  context: Context;
  expires_at: Date;
  status: string;
  verification: Proof | null;
  approval: Proof | null;
  approved_at: Date | null;
}
type Trusted = Awaited<ReturnType<typeof readTrust>>;
const tables =
  'lms.organizations,lms.users,lms.memberships,lms.config_revisions,lms.records,lms.audit_events,lms.access_versions,lms.access_receipts,lms_identity."user",lms_identity.account,lms_identity.session,lms_identity.verification,lms_identity.credential_events,lms_identity.credential_versions,lms_private.membership_reviews,lms_private.recovery_cases,lms_private.recovery_trust,lms_private.recovery_events,lms_control.state';
function message(
  row: Case,
  stage: "verification" | "approval",
  operatorId: string,
) {
  return canonical({
    context: row.context,
    stage,
    operatorId,
    ...(stage === "approval"
      ? { verificationDigest: digest(canonical(row.verification)) }
      : {}),
  });
}
async function memberships(client: Client, subject: string) {
  const rows = (
    await client.query(
      "select m.organization_id,m.role,coalesce(v.revision,0) as revision from lms.memberships m left join lms.access_versions v on v.organization_id=m.organization_id where m.user_id=$1 order by m.organization_id",
      [subject],
    )
  ).rows;
  return { digest: digest(canonical(rows)), rows };
}
/** Local superuser authority plus previously enrolled offline trust, never browser/admin-role input. */
export class OfflineRecovery {
  private readonly target: URL;
  constructor(
    private readonly options: {
      databaseUrl: string;
      databaseName: string;
      trustFile: string;
    },
  ) {
    this.target = localTarget(options.databaseUrl, options.databaseName);
  }
  private async run<T>(
    fn: (client: Client, trust: Trusted) => Promise<T>,
    caseId?: string,
  ): Promise<T> {
    const trust = await readTrust(this.options.trustFile);
    const client = new Client({
      connectionString: this.target.toString(),
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
      lock_timeout: 1000,
    });
    await client.connect();
    let authorized = false,
      offline = false;
    try {
      if (
        !(
          await client.query(
            "select rolsuper from pg_roles where rolname=current_user",
          )
        ).rows[0]?.rolsuper
      )
        throw new EngineError(
          "Use the separate local maintenance administrator.",
          403,
        );
      authorized = true;
      await client.query("begin");
      if (
        !(
          await client.query(
            "select pg_try_advisory_xact_lock(74021906) as held",
          )
        ).rows[0].held
      )
        throw new EngineError(
          "Stop all identity and persistent runtime hosts first.",
          423,
        );
      offline = true;
      await client.query(
        "lock table " + tables + " in access exclusive mode nowait",
      );
      const result = await fn(client, trust);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      if (authorized && offline) {
        // Rejection is a separate transaction; credentials/case state never partially commit.
        try {
          await client.query("begin");
          if (
            (
              await client.query(
                "select pg_try_advisory_xact_lock(74021906) as held",
              )
            ).rows[0].held
          )
            await client.query(
              "insert into lms_private.recovery_events(case_id,action,code) values($1,'rejected',$2)",
              [
                caseId ?? null,
                error instanceof EngineError
                  ? "rejected-" + error.status
                  : "storage-failure",
              ],
            );
          await client.query("commit");
        } catch {
          await client.query("rollback").catch(() => {});
        }
      }
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "55P03"
      )
        throw new EngineError(
          "Offline database is busy. Stop every host/transaction and review again.",
          423,
        );
      throw error;
    } finally {
      await client.end();
    }
  }
  private async enrolled(client: Client, trust: Trusted) {
    const row = (
      await client.query(
        "select trusted_at<=clock_timestamp()-interval '24 hours' as established from lms_private.recovery_trust where digest=$1",
        [trust.digest],
      )
    ).rows[0];
    if (!row?.established)
      throw new EngineError(
        "Previously enrolled trust and the 24-hour cooling-off period are required.",
        403,
      );
  }
  private async load(client: Client, trust: Trusted, caseId: string) {
    await this.enrolled(client, trust);
    const row = (
      await client.query<Case>(
        "select * from lms_private.recovery_cases where id=$1 for update",
        [caseId],
      )
    ).rows[0];
    if (!row || row.registry_digest !== trust.digest)
      throw new EngineError(
        "Recovery case unavailable for this trust registry.",
        403,
      );
    if (
      !(
        await client.query(
          "select $1::timestamptz>clock_timestamp() as valid",
          [row.expires_at],
        )
      ).rows[0].valid
    )
      throw new EngineError("Recovery case or approval expired.", 410);
    if (
      row.context.expiresAt !== row.expires_at.toISOString() ||
      row.context.caseId !== row.id ||
      row.context.subjectId !== row.subject_id ||
      row.context.registryDigest !== trust.digest ||
      row.context.protocol !== "lms-offline-recovery-v1"
    )
      throw new EngineError("Recovery review context changed.", 409);
    return row;
  }
  private proof(
    trust: Trust,
    row: Case,
    stage: "verification" | "approval",
    proof: Proof,
  ) {
    const op = verifyAttestation(
      trust,
      proof.operatorId,
      row.subject_id,
      stage === "verification" ? "verify" : "approve",
      message(row, stage, proof.operatorId),
      proof.signature,
    );
    if (stage === "approval" && row.verification?.operatorId === op.id)
      throw new EngineError("A different verified operator must approve.", 403);
  }
  async enroll(value: unknown) {
    z.object({ confirmation: z.literal("REGISTER PRE-EXISTING OFFLINE TRUST") })
      .strict()
      .parse(value);
    return this.run(async (client, trust) => {
      if (
        !(
          await client.query(
            "select $1::timestamptz<=clock_timestamp() as valid",
            [trust.registry.createdAt],
          )
        ).rows[0].valid
      )
        throw new EngineError("Trust dates cannot be in the future.", 403);
      const inserted = await client.query(
        "insert into lms_private.recovery_trust(digest,registry_id) values($1,$2) on conflict do nothing returning digest",
        [trust.digest, trust.registry.id],
      );
      if (inserted.rows.length)
        await client.query(
          "insert into lms_private.recovery_events(action) values('trust-enrolled')",
        );
      return {
        registryId: trust.registry.id,
        digest: trust.digest,
        coolingOffHours: 24,
      };
    });
  }
  async open(value: unknown) {
    const input = openCaseSchema.parse(value);
    return this.run(async (client, trust) => {
      await this.enrolled(client, trust);
      const evidence = trust.registry.evidence.find(
        (item) =>
          item.id === input.evidenceId && item.subjectId === input.subjectId,
      );
      if (!evidence)
        throw new EngineError(
          "Previously established independent evidence is unavailable.",
          403,
        );
      const accounts = (
        await client.query(
          'select a.id,v.version,u.name from lms_identity.account a join lms_identity."user" u on u.id=a."userId" join lms_identity.credential_versions v on v.account_id=a.id where u.id=$1 and u.email like \'%@example.test\' and a."providerId"=\'credential\' and a.password is not null for update of a,v',
          [input.subjectId],
        )
      ).rows;
      if (accounts.length !== 1)
        throw new EngineError("Fictional credential account unavailable.", 403);
      const account = accounts[0],
        caseId = randomUUID(),
        time = (
          await client.query(
            "select clock_timestamp() as created,clock_timestamp()+interval '10 minutes' as expires",
          )
        ).rows[0];
      const roles = await memberships(client, input.subjectId);
      const context: Context = {
        protocol: "lms-offline-recovery-v1",
        instanceId: (
          await client.query("select instance_id from lms_control.state")
        ).rows[0].instance_id,
        caseId,
        subjectId: input.subjectId,
        credentialVersion: account.version,
        membershipDigest: roles.digest,
        registryDigest: trust.digest,
        evidenceId: evidence.id,
        evidenceDigest: evidence.recordDigest,
        createdAt: time.created.toISOString(),
        expiresAt: time.expires.toISOString(),
        effect:
          "Replace only this credential; revoke every subject session and pending approval; preserve all roles/history; activation remains blocked.",
      };
      await client.query(
        "insert into lms_private.recovery_cases(id,subject_id,account_id,registry_digest,context,expires_at) values($1,$2,$3,$4,$5,$6)",
        [
          caseId,
          input.subjectId,
          account.id,
          trust.digest,
          context,
          time.expires,
        ],
      );
      await client.query(
        "update lms_control.state set blocked=true,reason='recovery-pending'",
      );
      await client.query(
        "insert into lms_private.recovery_events(case_id,subject_id,action) values($1,$2,'opened')",
        [caseId, input.subjectId],
      );
      return {
        caseId,
        subjectId: input.subjectId,
        name: account.name,
        organizations: roles.rows,
        expiresAt: context.expiresAt,
        requiredIndependentOperators: 2,
        effect: context.effect,
      };
    });
  }
  async review(value: unknown) {
    const input = z
      .object({
        caseId: id,
        operatorId: id,
        stage: z.enum(["verification", "approval"]),
      })
      .strict()
      .parse(value);
    return this.run(async (client, trust) => {
      const row = await this.load(client, trust, input.caseId);
      if (
        (input.stage === "verification" && row.status !== "opened") ||
        (input.stage === "approval" && row.status !== "verified")
      )
        throw new EngineError("Review stage is unavailable.", 409);
      const op = trust.registry.operators.find(
        (op) =>
          op.id === input.operatorId &&
          op.personId !== row.subject_id &&
          op.capabilities.includes(
            input.stage === "verification" ? "verify" : "approve",
          ),
      );
      if (
        !op ||
        (input.stage === "approval" && row.verification?.operatorId === op.id)
      )
        throw new EngineError("Independent enrolled operator required.", 403);
      return {
        caseId: row.id,
        stage: input.stage,
        operatorId: op.id,
        message: message(row, input.stage, op.id),
        effect: row.context.effect,
      };
    }, input.caseId);
  }
  async attest(stage: "verification" | "approval", value: unknown) {
    stage = z.enum(["verification", "approval"]).parse(stage);
    const input = signedCaseSchema.parse(value);
    return this.run(async (client, trust) => {
      const row = await this.load(client, trust, input.caseId);
      if (row.status !== (stage === "verification" ? "opened" : "verified"))
        throw new EngineError(
          "Recovery stage already used or unavailable.",
          409,
        );
      const proof = {
        operatorId: input.operatorId,
        signature: input.signature,
      };
      if (stage === "approval")
        this.proof(trust.registry, row, "verification", row.verification!);
      this.proof(trust.registry, row, stage, proof);
      if (stage === "verification")
        await client.query(
          "update lms_private.recovery_cases set status='verified',verification=$1 where id=$2",
          [proof, row.id],
        );
      else
        await client.query(
          "update lms_private.recovery_cases set status='approved',approval=$1,approved_at=clock_timestamp() where id=$2",
          [proof, row.id],
        );
      await client.query(
        "insert into lms_private.recovery_events(case_id,subject_id,operator_id,action) values($1,$2,$3,$4)",
        [
          row.id,
          row.subject_id,
          proof.operatorId,
          stage === "verification" ? "verified" : "approved",
        ],
      );
      return {
        caseId: row.id,
        status: stage === "verification" ? "verified" : "approved",
        activationBlocked: true,
      };
    }, input.caseId);
  }
  async apply(value: unknown) {
    const input = applyCaseSchema.parse(value),
      hash = await passwordCodec.hash(input.newPassword);
    return this.run(async (client, trust) => {
      const row = await this.load(client, trust, input.caseId);
      if (row.status !== "approved" || !row.approval || !row.verification)
        throw new EngineError(
          "Two verified approvals and an unused case are required.",
          409,
        );
      if (
        !(
          await client.query(
            "select $1::timestamptz>clock_timestamp()-interval '5 minutes' as valid",
            [row.approved_at],
          )
        ).rows[0].valid
      )
        throw new EngineError("Approval expired.", 410);
      this.proof(trust.registry, row, "verification", row.verification);
      this.proof(trust.registry, row, "approval", row.approval);
      const state = (
        await client.query("select instance_id from lms_control.state")
      ).rows[0];
      const current = (
        await client.query(
          'select a.id from lms_identity.account a join lms_identity.credential_versions v on v.account_id=a.id join lms_identity."user" u on u.id=a."userId" where a.id=$1 and a."userId"=$2 and v.version=$3 and a."providerId"=\'credential\' and u.email like \'%@example.test\' for update of a,v',
          [row.account_id, row.subject_id, row.context.credentialVersion],
        )
      ).rows;
      if (
        !current.length ||
        state.instance_id !== row.context.instanceId ||
        (await memberships(client, row.subject_id)).digest !==
          row.context.membershipDigest
      )
        throw new EngineError(
          "Credential, membership or database version changed. Open a new case.",
          409,
        );
      await replaceCredential(
        client,
        row.account_id,
        row.subject_id,
        hash,
        row.id,
      );
      await client.query(
        "update lms_private.recovery_cases set status='completed',completed_at=clock_timestamp() where id=$1",
        [row.id],
      );
      await client.query(
        "update lms_control.state set blocked=true,reason='recovered-offline'",
      );
      await client.query(
        "insert into lms_private.recovery_events(case_id,subject_id,operator_id,action) values($1,$2,$3,'completed')",
        [row.id, row.subject_id, row.approval.operatorId],
      );
      return { caseId: row.id, status: "completed", activationBlocked: true };
    }, input.caseId);
  }
  async verifyPassword(value: unknown) {
    const input = z
      .object({
        subjectId: id,
        password: z.string().min(1).max(128),
        confirmation: z.literal("VERIFY OFFLINE WITHOUT ACTIVATION"),
      })
      .strict()
      .parse(value);
    return this.run(async (client) => {
      const rows = (
        await client.query(
          'select a.password from lms_identity.account a join lms_identity."user" u on u.id=a."userId" where u.id=$1 and u.email like \'%@example.test\' and a."providerId"=\'credential\'',
          [input.subjectId],
        )
      ).rows;
      return {
        valid:
          rows.length === 1 &&
          !!rows[0].password &&
          (await passwordCodec.verify({
            hash: rows[0].password,
            password: input.password,
          })),
        activationBlocked: (
          await client.query("select lms_control.is_blocked() as blocked")
        ).rows[0].blocked,
      };
    });
  }
}
