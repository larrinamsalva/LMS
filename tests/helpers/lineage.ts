// Synthetic custodians share one test process. This does not demonstrate physical key separation.
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import {
  canonical,
  digest,
  trustSchema,
} from "../../src/server/recovery/trust";
import {
  approvalMessage,
  verificationMessage,
  checkpointDigest,
  type Checkpoint,
  type SignedCheckpoint,
} from "../../src/server/lineage/protocol";
export function custodians(subjectId: string = randomUUID()) {
  const keys = [generateKeyPairSync("ed25519"), generateKeyPairSync("ed25519")];
  const registry = trustSchema.parse({
    version: 1,
    id: randomUUID(),
    createdAt: "2024-01-01T00:00:00.000Z",
    operators: keys.map((key) => ({
      id: randomUUID(),
      personId: randomUUID(),
      enrolledAt: "2020-01-01T00:00:00.000Z",
      publicKey: key.publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
      capabilities: ["verify", "approve"],
    })),
    evidence: [
      {
        id: randomUUID(),
        subjectId,
        establishedAt: "2023-01-01T00:00:00.000Z",
        kind: "offline-identity-record",
        recordDigest: digest(
          "fictional independently verified offline evidence",
        ),
      },
    ],
  });
  function seal(checkpoint: Checkpoint): SignedCheckpoint {
    const operatorId = registry.operators[0].id;
    const verification = {
      operatorId,
      signature: sign(
        null,
        Buffer.from(verificationMessage(checkpoint, operatorId)),
        keys[0].privateKey,
      ).toString("base64"),
    };
    const approverId = registry.operators[1].id;
    const approval = {
      operatorId: approverId,
      signature: sign(
        null,
        Buffer.from(approvalMessage(checkpoint, verification, approverId)),
        keys[1].privateKey,
      ).toString("base64"),
    };
    return { checkpoint, verification, approval };
  }
  return {
    registry,
    keys,
    seal,
    registryDigest: digest(canonical(registry)),
    checkpointDigest,
  };
}
