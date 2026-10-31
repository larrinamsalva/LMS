import { CheckpointPublisher } from "../src/server/publication/store";
import { readPrivateText } from "../src/server/recovery/private-file";
import { journalSchema } from "../src/server/lineage/protocol";
async function main() {
  const [action, ...extra] = process.argv.slice(2);
  if (
    extra.length ||
    !["init", "review", "publish", "resume", "verify"].includes(action)
  )
    throw new Error("Unknown publication command.");
  const publisher = new CheckpointPublisher({
    directory: process.env.LMS_PUBLICATION_DIRECTORY ?? "",
    trustFile: process.env.LMS_RECOVERY_TRUST_FILE ?? "",
    expectedRootDigest: process.env.LMS_PUBLICATION_ROOT_DIGEST,
  });
  const parts: Buffer[] = [];
  let count = 0;
  for await (const part of process.stdin) {
    const b = Buffer.from(part);
    count += b.length;
    if (count > 65536) throw new Error("Input exceeds limit.");
    parts.push(b);
  }
  const input: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
  const journal = ["init", "review", "publish"].includes(action)
    ? journalSchema.parse(
        JSON.parse(
          await readPrivateText(
            process.env.LMS_PUBLICATION_CANDIDATE_FILE ?? "",
            16 * 1024 * 1024,
          ),
        ),
      )
    : undefined;
  const result =
    action === "init"
      ? await publisher.initialize(journal!, input)
      : action === "review"
        ? await publisher.review(journal!, input)
        : action === "publish"
          ? await publisher.publish(journal!, input)
          : action === "resume"
            ? await publisher.resume(input)
            : await publisher.verify(input);
  console.log(JSON.stringify(result, null, 2));
}
void main().catch(() => {
  console.error(
    "Checkpoint publication refused. Check independent root/receipt custody, exact approvals, private Linux storage, clock, complete history and pending intent. No older checkpoint is accepted automatically; activation remains blocked.",
  );
  process.exitCode = 1;
});
