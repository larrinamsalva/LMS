import { createHmac } from "node:crypto";
import { z } from "zod";
import { EngineError } from "../../core/engine";
import {
  canonical,
  digest,
  verifyOperatorSignature,
  type Trust,
} from "../recovery/trust";
export const zeroDigest = "0".repeat(64);
export const hexDigest = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.uuid(),
  maybeId = uuid.nullable();
export const payloadSchema = z
  .object({
    kind: z.enum([
      "credential-baseline",
      "credential-version",
      "credential-deleted",
      "credential-event",
      "recovery-event",
    ]),
    eventId: uuid,
    subjectId: maybeId,
    accountId: maybeId,
    credentialVersion: maybeId,
    operationId: maybeId,
    caseId: maybeId,
    operatorId: maybeId,
    action: z.enum([
      "adopted-baseline",
      "version-recorded",
      "removed",
      "password-changed",
      "trust-enrolled",
      "opened",
      "verified",
      "approved",
      "completed",
      "rejected",
    ]),
    occurredAt: z.iso.datetime(),
  })
  .strict();
export type Payload = z.infer<typeof payloadSchema>;
export const entrySchema = z
  .object({
    sequence: z.number().int().min(1).max(10000),
    previousDigest: hexDigest,
    payload: z.string().max(4096),
    digest: hexDigest,
  })
  .strict();
export type Entry = z.infer<typeof entrySchema>;
export const checkpointSchema = z
  .object({
    protocol: z.literal("lms-lineage-checkpoint-v1"),
    streamId: uuid,
    capturedInstanceId: uuid,
    epoch: z.number().int().min(1).max(1000),
    sequence: z.number().int().min(0).max(10000),
    headDigest: hexDigest,
    previousCheckpointDigest: hexDigest.nullable(),
    registryDigest: hexDigest,
    commitmentKeyId: uuid,
    commitmentKeyFingerprint: hexDigest,
    credentials: z
      .array(
        z
          .object({
            accountId: uuid,
            subjectId: uuid,
            credentialVersion: uuid,
            commitment: hexDigest,
          })
          .strict(),
      )
      .max(1000),
    credentialCommitment: hexDigest,
    versionsDigest: hexDigest,
    issuedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export type Checkpoint = z.infer<typeof checkpointSchema>;
const proofSchema = z
  .object({ operatorId: uuid, signature: z.string().max(100) })
  .strict();
export type Proof = z.infer<typeof proofSchema>;
export const signedCheckpointSchema = z
  .object({
    checkpoint: checkpointSchema,
    verification: proofSchema,
    approval: proofSchema,
  })
  .strict();
export type SignedCheckpoint = z.infer<typeof signedCheckpointSchema>;
export const journalSchema = z
  .object({
    protocol: z.literal("lms-credential-lineage-v1"),
    streamId: uuid,
    entries: z.array(entrySchema).max(10000),
    checkpoints: z.array(signedCheckpointSchema).min(1).max(1000),
  })
  .strict();
export type Journal = z.infer<typeof journalSchema>;
export const commitmentKeySchema = z
  .object({
    protocol: z.literal("lms-lineage-key-v1"),
    id: uuid,
    secret: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .refine((value) => new Set(value).size >= 8),
  })
  .strict();
export function entryDigest(streamId: string, entry: Omit<Entry, "digest">) {
  return digest(
    [
      "lms-credential-entry-v1",
      streamId,
      String(entry.sequence),
      entry.previousDigest,
      entry.payload,
    ].join("\n"),
  );
}
export function checkpointDigest(value: SignedCheckpoint) {
  return digest(canonical(value));
}
export function verificationMessage(
  checkpoint: Checkpoint,
  operatorId: string,
) {
  return canonical({
    purpose: "lms-lineage-checkpoint-verification-v1",
    checkpoint,
    operatorId,
  });
}
export function approvalMessage(
  checkpoint: Checkpoint,
  verification: Proof,
  operatorId: string,
) {
  return canonical({
    purpose: "lms-lineage-checkpoint-approval-v1",
    checkpoint,
    verificationDigest: digest(canonical(verification)),
    operatorId,
  });
}
export function stateCommitment(
  secret: string,
  streamId: string,
  rows: unknown,
) {
  return createHmac("sha256", Buffer.from(secret, "hex"))
    .update(
      canonical({
        protocol: "lms-private-credential-state-v1",
        streamId,
        rows,
      }),
    )
    .digest("hex");
}
function fail(message: string, status = 409): never {
  throw new EngineError(message, status);
}
export function verifyChain(streamId: string, entries: Entry[]) {
  let head = zeroDigest;
  const payloads: Payload[] = [],
    ids = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    entrySchema.parse(entry);
    if (
      entry.sequence !== index + 1 ||
      entry.previousDigest !== head ||
      entry.digest !== entryDigest(streamId, entry)
    )
      fail("Credential lineage is missing, reordered or corrupted.");
    const p = payloadSchema.parse(JSON.parse(entry.payload));
    const key = p.kind + ":" + p.eventId;
    if (ids.has(key)) fail("Duplicate lineage event.");
    ids.add(key);
    if (
      ["credential-baseline", "credential-version"].includes(p.kind) &&
      (!p.accountId ||
        !p.subjectId ||
        !p.credentialVersion ||
        p.eventId !== p.credentialVersion ||
        p.operationId ||
        p.caseId ||
        p.operatorId ||
        p.action !==
          (p.kind === "credential-baseline"
            ? "adopted-baseline"
            : "version-recorded"))
    )
      fail("Invalid credential lineage payload.");
    if (
      p.kind === "credential-deleted" &&
      (!p.accountId ||
        !p.credentialVersion ||
        p.subjectId ||
        p.operationId ||
        p.caseId ||
        p.operatorId ||
        p.action !== "removed")
    )
      fail("Invalid deletion lineage payload.");
    if (
      p.kind === "credential-event" &&
      (!p.subjectId ||
        p.accountId ||
        p.credentialVersion ||
        p.caseId ||
        p.operatorId ||
        p.action !== "password-changed")
    )
      fail("Invalid credential audit payload.");
    if (
      p.kind === "recovery-event" &&
      (p.accountId ||
        p.credentialVersion ||
        p.operationId ||
        ![
          "trust-enrolled",
          "opened",
          "verified",
          "approved",
          "completed",
          "rejected",
        ].includes(p.action))
    )
      fail("Invalid recovery audit payload.");
    head = entry.digest;
    payloads.push(p);
  }
  return { head, payloads };
}
export function assertFresh(checkpoint: Checkpoint, now: Date) {
  if (
    Date.parse(checkpoint.issuedAt) > now.getTime() ||
    Date.parse(checkpoint.expiresAt) <= now.getTime()
  )
    fail("External checkpoint is stale or future-dated.", 410);
}
export function verifyJournal(
  value: unknown,
  trust: Trust,
  registryDigest: string,
  pinnedDigest: string,
  now: Date,
  allowExpired = false,
) {
  const journal = journalSchema.parse(value);
  hexDigest.parse(pinnedDigest);
  const chain = verifyChain(journal.streamId, journal.entries);
  let previous: string | null = null,
    previousSequence = 0,
    previousTime = 0;
  for (const [index, signed] of journal.checkpoints.entries()) {
    const c = signed.checkpoint,
      issued = Date.parse(c.issuedAt),
      expires = Date.parse(c.expiresAt);
    if (
      c.streamId !== journal.streamId ||
      c.registryDigest !== registryDigest ||
      c.epoch !== index + 1 ||
      c.previousCheckpointDigest !== previous ||
      c.sequence < previousSequence ||
      (index > 0 &&
        (c.commitmentKeyId !==
          journal.checkpoints[0].checkpoint.commitmentKeyId ||
          c.commitmentKeyFingerprint !==
            journal.checkpoints[0].checkpoint.commitmentKeyFingerprint)) ||
      new Set(c.credentials.map((row) => row.accountId)).size !==
        c.credentials.length ||
      c.sequence > journal.entries.length ||
      c.headDigest !==
        (c.sequence ? journal.entries[c.sequence - 1].digest : zeroDigest) ||
      issued < previousTime ||
      issued > now.getTime() ||
      expires <= issued ||
      expires - issued > 600000
    )
      fail(
        "Unsupported checkpoint chain, epoch, key registry or history.",
        403,
      );
    verifyOperatorSignature(
      trust,
      signed.verification.operatorId,
      "verify",
      verificationMessage(c, signed.verification.operatorId),
      signed.verification.signature,
    );
    verifyOperatorSignature(
      trust,
      signed.approval.operatorId,
      "approve",
      approvalMessage(c, signed.verification, signed.approval.operatorId),
      signed.approval.signature,
    );
    if (signed.verification.operatorId === signed.approval.operatorId)
      fail("Independent checkpoint witnesses required.", 403);
    previous = checkpointDigest(signed);
    previousSequence = c.sequence;
    previousTime = issued;
  }
  const latest = journal.checkpoints.at(-1)!;
  if (
    previous !== pinnedDigest ||
    latest.checkpoint.sequence !== journal.entries.length ||
    latest.checkpoint.headDigest !== chain.head
  )
    fail(
      "The independently pinned latest checkpoint does not match this journal.",
      403,
    );
  if (!allowExpired) assertFresh(latest.checkpoint, now);
  return { journal, latest: latest.checkpoint, payloads: chain.payloads };
}
