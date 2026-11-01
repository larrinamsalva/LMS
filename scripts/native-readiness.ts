import { open } from "node:fs/promises";
import { nativeReadiness } from "../src/server/postgres/native-readiness";

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode !== "preflight" && mode !== "rehearse")
    throw new Error("Choose preflight or rehearse.");
  const allowed = new Set([
      "--trust",
      "--work-directory",
      "--report",
      "--confirm",
    ]),
    values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || values.has(args[i]))
      throw new Error("Invalid or duplicate option.");
    values.set(args[i], args[i + 1]);
  }
  for (const required of ["--trust", "--work-directory", "--report"])
    if (!values.has(required)) throw new Error("Missing required option.");
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    // Reserve a private, new report before running. Never overwrite earlier evidence.
    const file = await open(values.get("--report")!, "wx", 0o600);
    try {
      const result = await nativeReadiness({
        mode,
        trustFile: values.get("--trust")!,
        workDirectory: values.get("--work-directory")!,
        sourceUrl: process.env.LMS_ADMIN_DATABASE_URL ?? "",
        targetUrl: process.env.LMS_RESTORE_DATABASE_URL ?? "",
        confirmation: values.get("--confirm"),
        binDirectory: process.env.LMS_PG_BIN,
        signal: controller.signal,
      });
      await file.writeFile(JSON.stringify(result, null, 2) + "\n");
      await file.sync();
      console.log(
        result.result +
          "; backup readiness: " +
          result.backupReadiness +
          ". Review the private report; activation remains blocked.",
      );
      if (result.result === "blocked") process.exitCode = 1;
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
    "Native readiness did not complete. Inspect the private allowlist, report/work paths, stopped hosts, maintenance credentials and PostgreSQL tools locally. No success or activation is authorized.",
  );
  process.exitCode = 1;
});
