import { expect, it } from "vitest";
import { randomBytes, randomUUID, sign } from "node:crypto";
import { custodians } from "../helpers/lineage";
import { canonical, digest } from "../../src/server/recovery/trust";
import {
  verifyChain,
  verifyJournal,
  entryDigest,
  zeroDigest,
  checkpointDigest,
  approvalMessage,
  stateCommitment,
  type Entry,
  type Checkpoint,
  type Journal,
} from "../../src/server/lineage/protocol";
const authority = custodians(),
  now = new Date("2026-01-01T00:00:00.000Z"),
  streamId = randomUUID();
function fixture() {
  const version = randomUUID();
  const entry: Entry = {
    sequence: 1,
    previousDigest: zeroDigest,
    payload: JSON.stringify({
      kind: "credential-baseline",
      eventId: version,
      subjectId: randomUUID(),
      accountId: randomUUID(),
      credentialVersion: version,
      operationId: null,
      caseId: null,
      operatorId: null,
      action: "adopted-baseline",
      occurredAt: now.toISOString(),
    }),
    digest: zeroDigest,
  };
  entry.digest = entryDigest(streamId, entry);
  const cp: Checkpoint = {
    protocol: "lms-lineage-checkpoint-v1",
    streamId,
    capturedInstanceId: randomUUID(),
    epoch: 1,
    sequence: 1,
    headDigest: entry.digest,
    previousCheckpointDigest: null,
    registryDigest: authority.registryDigest,
    commitmentKeyId: randomUUID(),
    commitmentKeyFingerprint: digest("fictional key fingerprint"),
    credentials: [],
    credentialCommitment: digest("opaque commitment"),
    versionsDigest: digest("versions"),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 600000).toISOString(),
  };
  const signed = authority.seal(cp);
  const journal: Journal = {
    protocol: "lms-credential-lineage-v1",
    streamId,
    entries: [entry],
    checkpoints: [signed],
  };
  return { cp, journal, pin: checkpointDigest(signed) };
}
function check(j: unknown, pin: string, at = now) {
  return verifyJournal(
    j,
    authority.registry,
    authority.registryDigest,
    pin,
    at,
  );
}
it("verifies two purpose-bound witness signatures and rejects prefix rollback against the independent latest pin", () => {
  const { journal, cp, pin } = fixture();
  expect(check(journal, pin).latest.epoch).toBe(1);
  const next = authority.seal({
    ...cp,
    epoch: 2,
    previousCheckpointDigest: pin,
  });
  const latest = checkpointDigest(next);
  expect(
    check({ ...journal, checkpoints: [...journal.checkpoints, next] }, latest)
      .latest.epoch,
  ).toBe(2);
  expect(() => check(journal, latest)).toThrow(/pinned/);
  expect(() => check({ ...journal, checkpoints: [next] }, latest)).toThrow();
});
it("rejects missing, corrupt, reordered and duplicate lineage entries including secretly added fields", () => {
  const { journal, pin } = fixture();
  for (const entries of [
    [],
    [{ ...journal.entries[0], sequence: 2 }],
    [{ ...journal.entries[0], payload: journal.entries[0].payload + " " }],
    [journal.entries[0], journal.entries[0]],
  ])
    expect(() => check({ ...journal, entries }, pin)).toThrow();
  const e = {
    ...journal.entries[0],
    payload: JSON.stringify({
      ...JSON.parse(journal.entries[0].payload),
      password: "forbidden",
    }),
  };
  e.digest = entryDigest(streamId, e);
  expect(() => verifyChain(streamId, [e])).toThrow();
});
it("rejects forged approvals, one-person approvals and signatures reused for another epoch or purpose", () => {
  const { journal, pin, cp } = fixture();
  const bad = structuredClone(journal);
  bad.checkpoints[0].approval.signature = Buffer.alloc(64).toString("base64");
  expect(() => check(bad, pin)).toThrow();
  const single = structuredClone(journal),
    v = single.checkpoints[0].verification;
  single.checkpoints[0].approval = {
    operatorId: v.operatorId,
    signature: sign(
      null,
      Buffer.from(approvalMessage(cp, v, v.operatorId)),
      authority.keys[0].privateKey,
    ).toString("base64"),
  };
  expect(() => check(single, checkpointDigest(single.checkpoints[0]))).toThrow(
    /Independent/,
  );
  const replay = structuredClone(journal);
  replay.checkpoints[0].checkpoint.epoch = 2;
  expect(() => check(replay, pin)).toThrow();
  const swapped = structuredClone(journal);
  swapped.checkpoints[0].approval = swapped.checkpoints[0].verification;
  expect(() => check(swapped, pin)).toThrow();
});
it("expires assessment evidence, permits historical renewal only with a pinned valid signature chain, and rejects future or overlong approvals", () => {
  const { journal, pin, cp } = fixture();
  expect(() => check(journal, pin, new Date(now.getTime() + 600000))).toThrow(
    /stale/,
  );
  expect(
    verifyJournal(
      journal,
      authority.registry,
      authority.registryDigest,
      pin,
      new Date(now.getTime() + 600000),
      true,
    ).latest.epoch,
  ).toBe(1);
  for (const c of [
    { ...cp, issuedAt: new Date(now.getTime() + 1).toISOString() },
    { ...cp, expiresAt: new Date(now.getTime() + 600001).toISOString() },
  ]) {
    const signed = authority.seal(c);
    expect(() =>
      check({ ...journal, checkpoints: [signed] }, checkpointDigest(signed)),
    ).toThrow();
  }
});
it("binds commitments to the secret, stream and full private credential state without serializing the private input", () => {
  const secret = randomBytes(32).toString("hex"),
    rows = [
      {
        accountId: randomUUID(),
        material: "fictional-private-hash",
        credentialVersion: randomUUID(),
      },
    ];
  const commitment = stateCommitment(secret, streamId, rows);
  expect(commitment).toMatch(/^[a-f0-9]{64}$/);
  expect(commitment).not.toContain(rows[0].material);
  for (const actual of [
    stateCommitment(randomBytes(32).toString("hex"), streamId, rows),
    stateCommitment(secret, randomUUID(), rows),
    stateCommitment(secret, streamId, [{ ...rows[0], material: "changed" }]),
  ])
    expect(actual).not.toBe(commitment);
  expect(canonical({ a: 1, b: 2 })).toBe(canonical({ b: 2, a: 1 }));
});
