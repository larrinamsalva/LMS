import { open } from "node:fs/promises";
import { readPrivateText } from "../src/server/recovery/private-file";
import { UpgradeLifecycle } from "../src/server/postgres/upgrade-lifecycle";
async function main() {
  const [action, ...args] = process.argv.slice(2),
    values = new Map<string, string>(),
    allowed = [
      "--trust",
      "--work-directory",
      "--store",
      "--report",
      "--request",
      "--root",
      "--head",
      "--confirm",
    ];
  if (!["prepare", "copy", "inspect", "retire", "status"].includes(action))
    throw new Error("Unknown action");
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || !args[i + 1] || values.has(args[i]))
      throw new Error("Invalid arguments");
    values.set(args[i], args[i + 1]);
  }
  for (const name of [
    "--trust",
    "--work-directory",
    "--store",
    "--report",
    ...(action === "prepare" ? ["--request"] : ["--root", "--head"]),
  ])
    if (!values.has(name)) throw new Error("Missing argument");
  if (action !== "prepare" && values.has("--request"))
    throw new Error("Proposal replacement refused");
  const controller = new AbortController(),
    interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    const file = await open(values.get("--report")!, "wx", 0o600);
    try {
      const workflow = new UpgradeLifecycle({
        directory: values.get("--store")!,
        rootDigest: values.get("--root"),
        native: {
          trustFile: values.get("--trust")!,
          workDirectory: values.get("--work-directory")!,
          sourceUrl: process.env.LMS_ADMIN_DATABASE_URL ?? "",
          targetUrl: process.env.LMS_RESTORE_DATABASE_URL ?? "",
          binDirectory: process.env.LMS_PG_BIN,
          signal: controller.signal,
        },
      });
      const head = values.get("--head")!;
      const result =
        action === "prepare"
          ? await workflow.prepare(
              JSON.parse(
                await readPrivateText(values.get("--request")!, 65536),
              ),
            )
          : action === "copy"
            ? await workflow.copy(head, values.get("--confirm") ?? "")
            : action === "status"
              ? await workflow.status(head)
              : await workflow.inspect(
                  head,
                  action === "retire"
                    ? (values.get("--confirm") ?? "")
                    : undefined,
                );
      await file.writeFile(JSON.stringify(result, null, 2) + "\n");
      await file.sync();
      console.log(
        result.lifecycle +
          ". No publication, transformation, database deletion or activation performed.",
      );
      if (result.lifecycle === "blocked-pending-manual-disposition")
        process.exitCode = 1;
    } finally {
      await file.close();
    }
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}
void main().catch(() => {
  console.error(
    "Upgrade blueprint unavailable: stale, incomplete, busy or unsupported evidence. Keep quarantine and inspect private operator state; no older checkpoint or force option is accepted.",
  );
  process.exitCode = 1;
});
