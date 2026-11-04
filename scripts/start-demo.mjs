import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const port = args.length === 0 ? "3000" : args[1];
if (
  (args.length !== 0 && (args.length !== 2 || args[0] !== "--port")) ||
  !/^[1-9][0-9]{0,4}$/.test(port ?? "") ||
  Number(port) > 65535
) {
  fail("Usage: npm run demo -- [--port 3000]. Choose a port from 1 to 65535.");
}

const root = new URL("../", import.meta.url);
process.chdir(fileURLToPath(root));
for (const file of [
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
]) {
  if (existsSync(file)) {
    fail(
      "Use a clean LMS checkout without Next.js environment files for the fictional demo.",
    );
  }
}
if (!existsSync(".next/BUILD_ID")) {
  fail("Build the fictional demo first with npm ci and npm run build.");
}

let next;
try {
  next = createRequire(import.meta.url).resolve("next/dist/bin/next");
  if (!readFileSync(".next/BUILD_ID", "utf8").trim()) throw new Error();
} catch {
  fail(
    "The demo install or build is incomplete. Run npm ci and npm run build again.",
  );
}

const origin = `http://127.0.0.1:${port}`;
process.env.NODE_ENV = "production";
process.env.LMS_APP_ORIGIN = origin;
process.env.NEXT_TELEMETRY_DISABLED = "1";
console.log(
  `Starting fictional LMS demo at ${origin}. Use made-up data only. Sessions expire after two hours and reset on restart.`,
);

// Keep Next in this process so the normal stop signal reaches the HTTP server.
process.argv = [
  process.execPath,
  next,
  "start",
  "--hostname",
  "127.0.0.1",
  "--port",
  port,
];
await import(pathToFileURL(next).href);
