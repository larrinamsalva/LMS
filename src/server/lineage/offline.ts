import type { Client } from "pg";
import { z } from "zod";
import { OfflineRecovery } from "../recovery/offline";
import { canonical, digest } from "../recovery/trust";
import { readPrivateText } from "../recovery/private-file";
import { EngineError } from "../../core/engine";
import {
  commitmentKeySchema,
  credentialVersions,
  checkpointSchema,
  entrySchema,
  hexDigest,
  verifyChain,
  verifyJournal,
  stateCommitment,
  assertFresh,
  type Entry,
  type Journal,
  type Checkpoint,
  type Payload,
} from "./protocol";
interface Options {
  databaseUrl: string;
  databaseName: string;
  trustFile: string;
  journalFile: string;
  commitmentKeyFile: string;
  expectedCheckpointDigest?: string;
}
interface Credential {
  accountId: string;
  subjectId: string;
  credentialVersion: string;
  material: string;
  fictional: boolean;
}
async function privateJson(file: string, max: number): Promise<unknown> {
  try {
    return JSON.parse(await readPrivateText(file, max));
  } catch {
    throw new EngineError(
      "Independent evidence is missing, insecure or invalid.",
      403,
    );
  }
}
async function supportedRestore(client: Client): Promise<boolean> {
  return (
    await client.query(
      "select to_regclass('lms_control.restore_blocker') is not null and exists(select 1 from pg_db_role_setting s where s.setdatabase=(select oid from pg_database where datname=current_database()) and s.setrole=0 and 'lms.restore_blocked=on'=any(s.setconfig)) as supported",
    )
  ).rows[0].supported;
}
async function snapshot(client: Client) {
  await client.query(
    "lock table lms_private.lineage_stream,lms_private.lineage_entries in access exclusive mode nowait",
  );
  const head = (
    await client.query(
      "select * from lms_private.lineage_stream where singleton",
    )
  ).rows[0];
  const rows = (
    await client.query(
      'select sequence,previous_digest as "previousDigest",payload,digest from lms_private.lineage_entries order by sequence limit 10001',
    )
  ).rows;
  if (!head || rows.length > 10000 || BigInt(head.sequence) > 10000n)
    throw new EngineError(
      "Lineage foundation limit exceeded or enrollment missing.",
      409,
    );
  const entries: Entry[] = rows.map((row) =>
    entrySchema.parse({ ...row, sequence: Number(row.sequence) }),
  );
  const chain = verifyChain(head.stream_id, entries);
  if (
    Number(head.sequence) !== entries.length ||
    head.head_digest !== chain.head
  )
    throw new EngineError("Database lineage head or entries are missing.", 409);
  const credentials = (
    await client.query<Credential>(
      'select a.id as "accountId",a."userId" as "subjectId",v.version as "credentialVersion",a.password as material,(u.email like \'%@example.test\') as fictional from lms_identity.account a left join lms_identity.credential_versions v on v.account_id=a.id left join lms_identity."user" u on u.id=a."userId" where a."providerId"=\'credential\' order by a.id limit 1001',
    )
  ).rows;
  if (
    credentials.length > 1000 ||
    credentials.some((c) => !c.material || !c.credentialVersion || !c.fictional)
  )
    throw new EngineError(
      "Only complete fictional credential records may be assessed.",
      403,
    );
  const versions = credentials.map(
    ({ accountId, subjectId, credentialVersion }) => ({
      accountId,
      subjectId,
      credentialVersion,
    }),
  );
  if (canonical(credentialVersions(chain.payloads)) !== canonical(versions))
    throw new EngineError(
      "Credential versions do not match their recorded lineage.",
      409,
    );
  const actual: Payload[] = [];
  for (const [table, kind] of [
    ["lms_identity.credential_events", "credential-event"],
    ["lms_private.recovery_events", "recovery-event"],
  ] as const) {
    for (const e of (
      await client.query(`select * from ${table} order by id limit 10001`)
    ).rows) {
      actual.push({
        kind,
        eventId: e.id,
        subjectId: e.subject_id,
        accountId: null,
        credentialVersion: null,
        operationId: kind === "credential-event" ? e.operation_id : null,
        caseId: kind === "recovery-event" ? e.case_id : null,
        operatorId: kind === "recovery-event" ? e.operator_id : null,
        action: e.action,
        occurredAt: e.occurred_at.toISOString(),
      });
    }
  }
  const metadata = chain.payloads.filter(
    (p) => p.kind === "credential-event" || p.kind === "recovery-event",
  );
  const ordered = (rows: Payload[]) => rows.map((p) => canonical(p)).sort();
  if (canonical(ordered(actual)) !== canonical(ordered(metadata)))
    throw new EngineError(
      "Credential or recovery audit history is missing or mismatched.",
      409,
    );
  const control = (
    await client.query(
      "select *,lms_control.is_blocked() as quarantined,clock_timestamp() as now from lms_control.state where singleton",
    )
  ).rows[0];
  return { head, entries, versions, credentials, control };
}
export class CredentialLineage extends OfflineRecovery {
  constructor(private readonly lineageOptions: Options) {
    super(lineageOptions);
  }
  async propose(value: unknown) {
    const input = z
      .object({
        mode: z.enum(["genesis", "advance"]),
        confirmation: z.literal(
          "CAPTURE FICTIONAL LINEAGE FOR INDEPENDENT REVIEW",
        ),
      })
      .strict()
      .parse(value);
    return this.run(
      async (client, trust) => {
        await this.enrolled(client, trust);
        const key = commitmentKeySchema.parse(
          await privateJson(this.lineageOptions.commitmentKeyFile, 4096),
        );
        const state = await snapshot(client);
        const materials = state.credentials.map(({ fictional, ...c }) => c);
        const credentialStates = materials.map(({ material, ...c }) => ({
          ...c,
          commitment: stateCommitment(key.secret, state.head.stream_id, [
            { ...c, material },
          ]),
        }));
        const keyFingerprint = stateCommitment(
          key.secret,
          key.id,
          "lms-lineage-key-custody-v1",
        );
        let previous: Journal | null = null;
        if (!state.head.genesis_eligible)
          throw new EngineError(
            "Unenrolled legacy or quarantined history cannot be rebased.",
            409,
          );
        if (input.mode === "genesis") {
          if (
            this.lineageOptions.expectedCheckpointDigest ||
            state.control.quarantined
          )
            throw new EngineError(
              "Genesis cannot replace existing or quarantined history.",
              403,
            );
          try {
            await readPrivateText(
              this.lineageOptions.journalFile,
              16 * 1024 * 1024,
            );
            throw new EngineError(
              "Existing external history requires a trusted latest pin.",
              403,
            );
          } catch (error) {
            if (!(
              error &&
              typeof error === "object" &&
              "code" in error &&
              error.code === "ENOENT"
            ))
              throw error;
          }
        } else {
          if (!this.lineageOptions.expectedCheckpointDigest)
            throw new EngineError(
              "Independent latest checkpoint pin required.",
              403,
            );
          previous = verifyJournal(
            await privateJson(
              this.lineageOptions.journalFile,
              16 * 1024 * 1024,
            ),
            trust.registry,
            trust.digest,
            this.lineageOptions.expectedCheckpointDigest,
            state.control.now,
            true,
          ).journal;
          if (
            previous.streamId !== state.head.stream_id ||
            previous.entries.length > state.entries.length ||
            previous.entries.some(
              (e, i) => canonical(e) !== canonical(state.entries[i]),
            )
          )
            throw new EngineError(
              "Database is an older snapshot or a different lineage fork.",
              409,
            );
          if (
            previous.checkpoints.at(-1)!.checkpoint.commitmentKeyId !==
              key.id ||
            previous.checkpoints.at(-1)!.checkpoint.commitmentKeyFingerprint !==
              keyFingerprint
          )
            throw new EngineError(
              "Commitment key rotation is not implemented.",
              403,
            );
        }
        if (previous) {
          if (
            previous.checkpoints.at(-1)!.checkpoint.capturedInstanceId !==
              state.control.instance_id &&
            !(await supportedRestore(client))
          )
            throw new EngineError(
              "Unsupported database instance or restore history.",
              409,
            );
          const priorStates =
            previous.checkpoints.at(-1)!.checkpoint.credentials;
          for (const current of credentialStates) {
            const prior = priorStates.find(
              (c) => c.accountId === current.accountId,
            );
            if (
              prior &&
              prior.credentialVersion === current.credentialVersion &&
              canonical(prior) !== canonical(current)
            )
              throw new EngineError(
                "Credential material changed without a recorded version change.",
                409,
              );
          }
        }
        const now = (await client.query("select clock_timestamp() as now"))
          .rows[0].now as Date;
        const checkpoint: Checkpoint = {
          protocol: "lms-lineage-checkpoint-v1",
          streamId: state.head.stream_id,
          capturedInstanceId: state.control.instance_id,
          epoch: (previous?.checkpoints.length ?? 0) + 1,
          sequence: state.entries.length,
          headDigest: state.head.head_digest,
          previousCheckpointDigest:
            input.mode === "advance"
              ? this.lineageOptions.expectedCheckpointDigest!
              : null,
          registryDigest: trust.digest,
          commitmentKeyId: key.id,
          commitmentKeyFingerprint: keyFingerprint,
          credentials: credentialStates,
          credentialCommitment: stateCommitment(
            key.secret,
            state.head.stream_id,
            state.credentials.map(({ fictional, ...c }) => c),
          ),
          versionsDigest: digest(canonical(state.versions)),
          issuedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 600000).toISOString(),
        };
        return {
          journal: {
            protocol: "lms-credential-lineage-v1" as const,
            streamId: state.head.stream_id,
            entries: state.entries,
            checkpoints: previous?.checkpoints ?? [],
          },
          checkpoint: checkpointSchema.parse(checkpoint),
          activationAllowed: false as const,
        };
      },
      undefined,
      false,
    );
  }
  async assess(value: unknown) {
    z.object({
      confirmation: z.literal("ASSESS OFFLINE LINEAGE WITHOUT ACTIVATION"),
    })
      .strict()
      .parse(value);
    return this.run(
      async (client, trust) => {
        await this.enrolled(client, trust);
        if (!this.lineageOptions.expectedCheckpointDigest)
          throw new EngineError(
            "Independent latest checkpoint pin required.",
            403,
          );
        hexDigest.parse(this.lineageOptions.expectedCheckpointDigest);
        const key = commitmentKeySchema.parse(
          await privateJson(this.lineageOptions.commitmentKeyFile, 4096),
        );
        const state = await snapshot(client);
        if (!state.control.quarantined || !state.head.genesis_eligible)
          throw new EngineError(
            "Only blocked databases with previously enrolled history may be assessed.",
            409,
          );
        const external = verifyJournal(
          await privateJson(this.lineageOptions.journalFile, 16 * 1024 * 1024),
          trust.registry,
          trust.digest,
          this.lineageOptions.expectedCheckpointDigest,
          state.control.now,
        );
        if (
          external.journal.streamId !== state.head.stream_id ||
          canonical(external.journal.entries) !== canonical(state.entries)
        )
          throw new EngineError(
            "Database snapshot is older, ahead of its witness or mismatched.",
            409,
          );
        if (
          external.latest.commitmentKeyId !== key.id ||
          external.latest.commitmentKeyFingerprint !==
            stateCommitment(key.secret, key.id, "lms-lineage-key-custody-v1") ||
          canonical(external.latest.credentials) !==
            canonical(
              state.credentials.map(({ fictional, material, ...c }) => ({
                ...c,
                commitment: stateCommitment(key.secret, state.head.stream_id, [
                  { ...c, material },
                ]),
              })),
            ) ||
          external.latest.versionsDigest !==
            digest(canonical(state.versions)) ||
          external.latest.credentialCommitment !==
            stateCommitment(
              key.secret,
              state.head.stream_id,
              state.credentials.map(({ fictional, ...c }) => c),
            )
        )
          throw new EngineError(
            "Current credential state or commitment key does not match the trusted checkpoint.",
            409,
          );
        const restored = await supportedRestore(client);
        if (
          external.latest.capturedInstanceId !== state.control.instance_id &&
          !restored
        )
          throw new EngineError(
            "Unsupported database instance or restore history.",
            409,
          );
        const pending = (
          await client.query(
            "select (select count(*) from lms_identity.session)+(select count(*) from lms_identity.verification)+(select count(*) from lms_private.membership_reviews)+(select count(*) from lms_private.recovery_cases where status<>'completed') as count",
          )
        ).rows[0].count;
        if (BigInt(pending) !== 0n)
          throw new EngineError(
            "Sessions or pending approvals remain. Use the approved offline revocation procedure.",
            409,
          );
        assertFresh(
          external.latest,
          (await client.query("select clock_timestamp() as now")).rows[0].now,
        );
        return {
          lineageVerified: true as const,
          credentialStateVerified: true as const,
          epoch: external.latest.epoch,
          sequence: external.latest.sequence,
          restoredSnapshot:
            external.latest.capturedInstanceId !== state.control.instance_id,
          activationAllowed: false as const,
          blockers: ["RECOVERY_ACCEPTANCE_AND_ACTIVATION_NOT_IMPLEMENTED"],
        };
      },
      undefined,
      false,
    );
  }
}
