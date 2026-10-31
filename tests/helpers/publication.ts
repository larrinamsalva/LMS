import { randomUUID, sign } from "node:crypto";
import { canonical, digest } from "../../src/server/recovery/trust";
import {
  checkpointDigest,
  zeroDigest,
  type Journal,
  type Checkpoint,
} from "../../src/server/lineage/protocol";
import {
  publicationVerificationMessage,
  publicationApprovalMessage,
  type PublicationRequest,
  type Publication,
} from "../../src/server/publication/protocol";
import { custodians } from "./lineage";
export function signPublication(
  authority: ReturnType<typeof custodians>,
  request: PublicationRequest,
): Publication {
  const operatorId = authority.registry.operators[0].id;
  const verification = {
    operatorId,
    signature: sign(
      null,
      Buffer.from(publicationVerificationMessage(request, operatorId)),
      authority.keys[0].privateKey,
    ).toString("base64"),
  };
  const approverId = authority.registry.operators[1].id;
  return {
    request,
    verification,
    approval: {
      operatorId: approverId,
      signature: sign(
        null,
        Buffer.from(
          publicationApprovalMessage(request, verification, approverId),
        ),
        authority.keys[1].privateKey,
      ).toString("base64"),
    },
  };
}
export function publicationJournal(
  authority: ReturnType<typeof custodians>,
  prior?: Journal,
  changes: Partial<Checkpoint> = {},
): Journal {
  const now = new Date(Date.now() - 1000);
  const cp: Checkpoint = prior
    ? {
        ...prior.checkpoints.at(-1)!.checkpoint,
        epoch: prior.checkpoints.length + 1,
        previousCheckpointDigest: checkpointDigest(prior.checkpoints.at(-1)!),
        issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 600000).toISOString(),
        ...changes,
      }
    : {
        protocol: "lms-lineage-checkpoint-v1",
        streamId: randomUUID(),
        capturedInstanceId: randomUUID(),
        epoch: 1,
        sequence: 0,
        headDigest: zeroDigest,
        previousCheckpointDigest: null,
        registryDigest: authority.registryDigest,
        commitmentKeyId: randomUUID(),
        commitmentKeyFingerprint: digest("fictional key fingerprint"),
        credentials: [],
        credentialCommitment: digest("fictional opaque state"),
        versionsDigest: digest(canonical([])),
        issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 600000).toISOString(),
        ...changes,
      };
  return {
    protocol: "lms-credential-lineage-v1",
    streamId: cp.streamId,
    entries: prior?.entries ?? [],
    checkpoints: [...(prior?.checkpoints ?? []), authority.seal(cp)],
  };
}
