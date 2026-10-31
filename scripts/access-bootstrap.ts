import { Client } from "pg";
import { localTarget } from "../src/server/postgres/targets";
import { bootstrapFictionalWorkspace } from "../src/server/access/bootstrap";

async function main() {
  const args = process.argv.slice(2);
  const index = args.indexOf("--database");
  const name = index >= 0 ? args[index + 1] : "";
  const target = localTarget(process.env.LMS_ADMIN_DATABASE_URL, name);
  let bytes = 0;
  const parts: Buffer[] = [];
  for await (const part of process.stdin) {
    const buffer = Buffer.from(part);
    bytes += buffer.length;
    if (bytes > 8192) throw new Error("Bootstrap input is too large.");
    parts.push(buffer);
  }
  const input: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
  const client = new Client({
    connectionString: target.toString(),
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  try {
    const result = await bootstrapFictionalWorkspace(client, input);
    console.log(
      `Fictional workspace ${result.replayed ? "already created" : "created"}: ${result.organizationId}. No HTTP routes enabled.`,
    );
  } finally {
    await client.end();
  }
}
void main().catch(() => {
  console.error(
    "Fictional workspace bootstrap failed. Check the local database, provisioned owner, operation ID and explicit confirmation. No credentials are logged.",
  );
  process.exitCode = 1;
});
