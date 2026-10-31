import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash, createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import { EngineError } from "../../core/engine";
export const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
const instant = z.iso.datetime();
export const trustSchema = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    createdAt: instant,
    operators: z
      .array(
        z
          .object({
            id: z.uuid(),
            personId: z.uuid(),
            enrolledAt: instant,
            publicKey: z
              .string()
              .max(512)
              .startsWith("-----BEGIN PUBLIC KEY-----"),
            capabilities: z
              .array(z.enum(["verify", "approve"]))
              .min(1)
              .max(2),
          })
          .strict(),
      )
      .min(2)
      .max(20),
    evidence: z
      .array(
        z
          .object({
            id: z.uuid(),
            subjectId: z.uuid(),
            establishedAt: instant,
            kind: z.enum([
              "offline-identity-record",
              "offline-recovery-factor",
            ]),
            recordDigest: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();
export type Trust = z.infer<typeof trustSchema>;
export async function readTrust(file: string) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (
      !process.getuid ||
      !stat.isFile() ||
      stat.uid !== process.getuid() ||
      (stat.mode & 0o077) !== 0 ||
      stat.size > 65536
    )
      throw new EngineError(
        "Use a private, process-owned regular trust file on a supported POSIX host.",
        403,
      );
    const registry = trustSchema.parse(
      JSON.parse(await handle.readFile("utf8")),
    );
    const identities = new Set<string>(),
      keys = new Set<string>(),
      ids = new Set<string>();
    for (const op of registry.operators) {
      const key = createPublicKey(op.publicKey);
      const fingerprint = digest(
        key.export({ type: "spki", format: "der" }).toString("base64"),
      );
      if (
        key.asymmetricKeyType !== "ed25519" ||
        identities.has(op.personId) ||
        keys.has(fingerprint) ||
        ids.has(op.id) ||
        Date.parse(op.enrolledAt) > Date.parse(registry.createdAt)
      )
        throw new EngineError("Invalid or duplicated operator trust.", 403);
      identities.add(op.personId);
      keys.add(fingerprint);
      ids.add(op.id);
    }
    if (
      !registry.operators.some(
        (a) =>
          a.capabilities.includes("verify") &&
          registry.operators.some(
            (b) => b.id !== a.id && b.capabilities.includes("approve"),
          ),
      )
    )
      throw new EngineError(
        "Two independently enrolled verification/approval authorities are required.",
        403,
      );
    const evidence = new Set<string>();
    for (const item of registry.evidence) {
      if (
        evidence.has(item.id) ||
        Date.parse(item.establishedAt) > Date.parse(registry.createdAt)
      )
        throw new EngineError("Invalid pre-established evidence.", 403);
      evidence.add(item.id);
    }
    return { registry, digest: digest(canonical(registry)) };
  } finally {
    await handle.close();
  }
}
export function verifyAttestation(
  trust: Trust,
  operatorId: string,
  subjectId: string,
  purpose: "verify" | "approve",
  message: string,
  signature: string,
) {
  const op = trust.operators.find((op) => op.id === operatorId);
  if (
    !op ||
    op.personId === subjectId ||
    !op.capabilities.includes(purpose) ||
    !/^[A-Za-z0-9+/]{86}==$/.test(signature) ||
    !verify(
      null,
      Buffer.from(message),
      createPublicKey(op.publicKey),
      Buffer.from(signature, "base64"),
    )
  )
    throw new EngineError(
      "Independent signed verification or approval unavailable.",
      403,
    );
  return op;
}
