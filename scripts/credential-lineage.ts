import { CredentialLineage } from "../src/server/lineage/offline";
async function main() {
  const [action, flag, databaseName, ...extra] = process.argv.slice(2);
  if (
    !["propose", "assess"].includes(action) ||
    flag !== "--database" ||
    !databaseName ||
    extra.length
  )
    throw new Error("Use propose or assess --database lms_fictional_*");
  const service = new CredentialLineage({
    databaseUrl: process.env.LMS_ADMIN_DATABASE_URL ?? "",
    databaseName,
    trustFile: process.env.LMS_RECOVERY_TRUST_FILE ?? "",
    journalFile: process.env.LMS_LINEAGE_JOURNAL_FILE ?? "",
    commitmentKeyFile: process.env.LMS_LINEAGE_COMMITMENT_KEY_FILE ?? "",
    expectedCheckpointDigest: process.env.LMS_LINEAGE_EXPECTED_CHECKPOINT,
  });
  const parts: Buffer[] = [];
  let bytes = 0;
  for await (const part of process.stdin) {
    const buffer = Buffer.from(part);
    bytes += buffer.length;
    if (bytes > 65536) throw new Error("Input exceeds limit");
    parts.push(buffer);
  }
  const input: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
  console.log(
    JSON.stringify(
      action === "propose"
        ? await service.propose(input)
        : await service.assess(input),
      null,
      2,
    ),
  );
}
void main().catch(() => {
  console.error(
    "Offline lineage check failed. Check stopped hosts, prior trust, independent latest pin, evidence, key custody and expiry. Activation remains blocked; no secrets are logged.",
  );
  process.exitCode = 1;
});
