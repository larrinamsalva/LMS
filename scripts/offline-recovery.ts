import { OfflineRecovery } from "../src/server/recovery/offline";
async function main() {
  const [action, ...args] = process.argv.slice(2),
    index = args.indexOf("--database");
  const recovery = new OfflineRecovery({
    databaseUrl: process.env.LMS_ADMIN_DATABASE_URL ?? "",
    databaseName: index >= 0 ? args[index + 1] : "",
    trustFile: process.env.LMS_RECOVERY_TRUST_FILE ?? "",
  });
  let bytes = 0;
  const parts: Buffer[] = [];
  for await (const part of process.stdin) {
    const b = Buffer.from(part);
    bytes += b.length;
    if (bytes > 65536) throw new Error("Input exceeds limit.");
    parts.push(b);
  }
  const input: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
  const result =
    action === "enroll"
      ? await recovery.enroll(input)
      : action === "open"
        ? await recovery.open(input)
        : action === "review"
          ? await recovery.review(input)
          : action === "verify"
            ? await recovery.attest("verification", input)
            : action === "approve"
              ? await recovery.attest("approval", input)
              : action === "apply"
                ? await recovery.apply(input)
                : action === "check-password"
                  ? await recovery.verifyPassword(input)
                  : null;
  if (!result) throw new Error("Unknown recovery action.");
  console.log(JSON.stringify(result, null, 2));
}
void main().catch(() => {
  console.error(
    "Offline recovery failed. Check local target, stopped hosts, prior trust, signed evidence, expiry and confirmation. No credentials are logged.",
  );
  process.exitCode = 1;
});
