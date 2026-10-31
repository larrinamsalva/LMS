import { z } from "zod";
import {
  canonical,
  digest,
  verifyOperatorSignature,
  type Trust,
} from "../recovery/trust";
import {
  credentialVersions,
  verifyChain,
  hexDigest,
  journalSchema,
  verifyJournal,
  checkpointDigest,
  type Journal,
} from "../lineage/protocol";
import { EngineError } from "../../core/engine";
export const rootSchema = z
  .object({
    protocol: z.literal("lms-publication-root-v1"),
    id: z.uuid(),
    streamId: z.uuid(),
    registryDigest: hexDigest,
    initialCheckpointDigest: hexDigest,
    fictionalOnly: z.literal(true),
  })
  .strict();
export type Root = z.infer<typeof rootSchema>;
export const requestSchema = z
  .object({
    protocol: z.literal("lms-checkpoint-publication-v1"),
    storeId: z.uuid(),
    streamId: z.uuid(),
    registryDigest: hexDigest,
    publicationId: z.uuid(),
    generation: z.number().int().min(1).max(128),
    previousReceiptDigest: hexDigest.nullable(),
    checkpointDigest: hexDigest,
    journalDigest: hexDigest,
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export type PublicationRequest = z.infer<typeof requestSchema>;
const proof = z
  .object({ operatorId: z.uuid(), signature: z.string().max(100) })
  .strict();
export const publicationSchema = z
  .object({ request: requestSchema, verification: proof, approval: proof })
  .strict();
export type Publication = z.infer<typeof publicationSchema>;
export const recordSchema = z
  .object({
    protocol: z.literal("lms-publication-record-v1"),
    publication: publicationSchema,
    journal: journalSchema,
  })
  .strict();
export type PublicationRecord = z.infer<typeof recordSchema>;
export const receiptDigest = (publication: Publication) =>
  digest(canonical(publication));
export function publicationVerificationMessage(
  request: PublicationRequest,
  operatorId: string,
) {
  return canonical({
    purpose: "lms-publication-verification-v1",
    request,
    operatorId,
  });
}
export function publicationApprovalMessage(
  request: PublicationRequest,
  verification: z.infer<typeof proof>,
  operatorId: string,
) {
  return canonical({
    purpose: "lms-publication-approval-v1",
    request,
    verificationDigest: digest(canonical(verification)),
    operatorId,
  });
}
export function verifyPublication(
  record: PublicationRecord,
  root: Root,
  trust: Trust,
  now: Date,
) {
  const { publication: p, journal } = record,
    r = p.request;
  if (
    r.storeId !== root.id ||
    r.streamId !== root.streamId ||
    r.registryDigest !== root.registryDigest ||
    r.journalDigest !== digest(canonical(journal))
  )
    throw new EngineError(
      "Publication context or journal differs from its approved content.",
      403,
    );
  const { latest } = verifyJournal(
    journal,
    trust,
    root.registryDigest,
    r.checkpointDigest,
    now,
    true,
  );
  const created = Date.parse(r.createdAt),
    expires = Date.parse(r.expiresAt);
  if (
    created > now.getTime() ||
    expires <= created ||
    expires - created > 300000 ||
    created < Date.parse(latest.issuedAt) ||
    expires > Date.parse(latest.expiresAt)
  )
    throw new EngineError(
      "Publication approval has an invalid time window.",
      403,
    );
  verifyOperatorSignature(
    trust,
    p.verification.operatorId,
    "verify",
    publicationVerificationMessage(r, p.verification.operatorId),
    p.verification.signature,
  );
  verifyOperatorSignature(
    trust,
    p.approval.operatorId,
    "approve",
    publicationApprovalMessage(r, p.verification, p.approval.operatorId),
    p.approval.signature,
  );
  if (p.verification.operatorId === p.approval.operatorId)
    throw new EngineError("Independent publication approval required.", 403);
  return latest;
}
/** A publisher has no DB or HMAC secret: instance transitions cannot be accepted by inference. */
export function verifySuccessor(
  journal: Journal,
  root: Root,
  prior?: PublicationRecord,
) {
  const current = journal.checkpoints.at(-1)!.checkpoint;
  const payloads = verifyChain(journal.streamId, journal.entries).payloads;
  for (const { checkpoint: c } of journal.checkpoints) {
    const versions = credentialVersions(payloads.slice(0, c.sequence));
    if (
      canonical(c.credentials.map(({ commitment, ...v }) => v)) !==
        canonical(versions) ||
      c.versionsDigest !== digest(canonical(versions))
    )
      throw new EngineError(
        "Checkpoint credential versions do not match the event history.",
        409,
      );
  }

  if (
    journal.streamId !== root.streamId ||
    journal.checkpoints.some(
      (c) =>
        c.checkpoint.capturedInstanceId !==
        journal.checkpoints[0].checkpoint.capturedInstanceId,
    )
  )
    throw new EngineError(
      "Instance transitions require a separately reviewed restore publication protocol.",
      409,
    );
  if (!prior) {
    if (
      checkpointDigest(journal.checkpoints.at(-1)!) !==
      root.initialCheckpointDigest
    )
      throw new EngineError(
        "Initial checkpoint differs from independently enrolled baseline.",
        409,
      );
    return;
  }
  const old = prior.journal,
    previous = old.checkpoints.at(-1)!.checkpoint;
  if (
    journal.checkpoints.length !== old.checkpoints.length + 1 ||
    old.checkpoints.some(
      (c, i) => canonical(c) !== canonical(journal.checkpoints[i]),
    ) ||
    old.entries.length > journal.entries.length ||
    old.entries.some((e, i) => canonical(e) !== canonical(journal.entries[i]))
  )
    throw new EngineError(
      "Missing, conflicting, older or altered publication history.",
      409,
    );
  if (
    canonical(current.credentials) === canonical(previous.credentials) &&
    current.credentialCommitment !== previous.credentialCommitment
  )
    throw new EngineError(
      "Aggregate commitment changed without credential changes.",
      409,
    );
  for (const c of current.credentials) {
    const p = previous.credentials.find((p) => p.accountId === c.accountId);
    if (
      p &&
      p.credentialVersion === c.credentialVersion &&
      canonical(p) !== canonical(c)
    )
      throw new EngineError(
        "Credential commitment changed without a new version.",
        409,
      );
  }
}
