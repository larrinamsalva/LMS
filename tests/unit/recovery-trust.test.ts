import { afterAll, beforeAll, expect, it } from "vitest";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { mkdtemp, writeFile, chmod, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  readTrust,
  canonical,
  digest,
  verifyAttestation,
  trustSchema,
} from "../../src/server/recovery/trust";
import {
  openCaseSchema,
  signedCaseSchema,
  applyCaseSchema,
} from "../../src/server/recovery/offline";
let dir: string;
const a = generateKeyPairSync("ed25519"),
  b = generateKeyPairSync("ed25519"),
  subject = randomUUID(),
  operator = randomUUID();
const registry = {
  version: 1,
  id: randomUUID(),
  createdAt: "2024-01-01T00:00:00.000Z",
  operators: [
    {
      id: operator,
      personId: randomUUID(),
      enrolledAt: "2020-01-01T00:00:00.000Z",
      publicKey: a.publicKey.export({ type: "spki", format: "pem" }).toString(),
      capabilities: ["verify", "approve"],
    },
    {
      id: randomUUID(),
      personId: randomUUID(),
      enrolledAt: "2020-01-01T00:00:00.000Z",
      publicKey: b.publicKey.export({ type: "spki", format: "pem" }).toString(),
      capabilities: ["approve"],
    },
  ],
  evidence: [
    {
      id: randomUUID(),
      subjectId: subject,
      establishedAt: "2023-01-01T00:00:00.000Z",
      kind: "offline-identity-record",
      recordDigest: digest("fictional evidence reference"),
    },
  ],
};
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "lms-trust-unit-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
it("requires a private regular trust file and rejects duplicate keys or people", async () => {
  const file = path.join(dir, "trust.json");
  await writeFile(file, JSON.stringify(registry), { mode: 0o600 });
  expect((await readTrust(file)).digest).toBe(digest(canonical(registry)));
  await chmod(file, 0o644);
  await expect(readTrust(file)).rejects.toMatchObject({ status: 403 });
  await chmod(file, 0o600);
  const link = path.join(dir, "link.json");
  await symlink(file, link);
  await expect(readTrust(link)).rejects.toThrow();
  for (const ops of [
    [
      registry.operators[0],
      { ...registry.operators[1], publicKey: registry.operators[0].publicKey },
    ],
    [
      registry.operators[0],
      { ...registry.operators[1], personId: registry.operators[0].personId },
    ],
  ]) {
    const bad = path.join(dir, randomUUID() + ".json");
    await writeFile(bad, JSON.stringify({ ...registry, operators: ops }), {
      mode: 0o600,
    });
    await expect(readTrust(bad)).rejects.toMatchObject({ status: 403 });
  }
});
it("cryptographically binds attestation to the precise message and an enrolled independent operator", () => {
  const trust = trustSchema.parse(registry),
    message = canonical({
      caseId: randomUUID(),
      subjectId: subject,
      stage: "verification",
    }),
    signature = sign(null, Buffer.from(message), a.privateKey).toString(
      "base64",
    );
  expect(
    verifyAttestation(trust, operator, subject, "verify", message, signature)
      .id,
  ).toBe(operator);
  for (const [who, target, body] of [
    [randomUUID(), subject, message],
    [operator, trust.operators[0].personId, message],
    [operator, subject, message + " "],
  ])
    expect(() =>
      verifyAttestation(trust, who, target, "verify", body, signature),
    ).toThrow();
});
it("rejects unverified email as evidence and forged authority or missing confirmation fields", () => {
  expect(
    trustSchema.safeParse({
      ...registry,
      evidence: [{ ...registry.evidence[0], kind: "email" }],
    }).success,
  ).toBe(false);
  expect(
    openCaseSchema.safeParse({
      subjectId: subject,
      evidenceId: randomUUID(),
      confirmation: "OPEN OFFLINE RECOVERY AND BLOCK ACTIVATION",
      verified: true,
    }).success,
  ).toBe(false);
  expect(
    signedCaseSchema.safeParse({
      caseId: randomUUID(),
      operatorId: operator,
      verified: true,
    }).success,
  ).toBe(false);
  expect(
    applyCaseSchema.safeParse({
      caseId: randomUUID(),
      newPassword: "fictional_recovered_password",
      confirmation: "RECOVER FICTIONAL ACCOUNT AND REVOKE ALL SESSIONS",
      role: "owner",
    }).success,
  ).toBe(false);
});
