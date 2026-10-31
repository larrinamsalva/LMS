import { Client } from "pg";
import {
  migrate,
  provisionAuthRuntime,
} from "../src/server/postgres/migrations";
import { localTarget, sameDatabase } from "../src/server/postgres/targets";
import {
  createLocalAuth,
  provisionFictionalAccount,
} from "../src/server/auth/host";
import { validateAuthOptions } from "../src/server/auth/config";
import { z } from "zod";
async function main() {
  const [action, ...args] = process.argv.slice(2);
  const index = args.indexOf("--database");
  const name = index >= 0 ? args[index + 1] : "";
  const target = localTarget(process.env.LMS_AUTH_DATABASE_URL, name);
  const options = validateAuthOptions({
    databaseUrl: target.toString(),
    databaseName: name,
    origin: process.env.LMS_AUTH_ORIGIN ?? "",
    secret: process.env.LMS_AUTH_SECRET ?? "",
  });
  if (action === "provision") {
    let bytes = 0;
    const parts: Buffer[] = [];
    for await (const part of process.stdin) {
      const buffer = Buffer.from(part);
      bytes += buffer.length;
      if (bytes > 8192) throw new Error("Provisioning input is too large.");
      parts.push(buffer);
    }
    const account = await provisionFictionalAccount(
      options,
      JSON.parse(Buffer.concat(parts).toString("utf8")),
    );
    console.log(
      `Fictional local identity created: ${account.userId}. No business membership or session was granted.`,
    );
    return;
  }
  if (!["init", "revoke-all"].includes(action))
    throw new Error("Choose init, provision or revoke-all.");
  const admin = localTarget(process.env.LMS_ADMIN_DATABASE_URL, name);
  sameDatabase(admin, target);
  if (admin.password === target.password)
    throw new Error("Use separate administrator and identity passwords.");
  const client = new Client({
    connectionString: admin.toString(),
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  try {
    if (
      !(
        await client.query(
          "select rolsuper from pg_roles where rolname=current_user",
        )
      ).rows[0]?.rolsuper
    )
      throw new Error("Use the separate local administrator.");
    if (action === "init") {
      await migrate(client);
      await provisionAuthRuntime(client, target.toString());
      const host = await createLocalAuth(options);
      await host.close();
      console.log(
        `Local identity storage initialized for ${name}. No HTTP routes enabled.`,
      );
    } else {
      const userIndex = args.indexOf("--user");
      const user = z
        .uuid()
        .parse(userIndex >= 0 ? args[userIndex + 1] : undefined);
      await client.query('delete from lms_identity.session where "userId"=$1', [
        user,
      ]);
      console.log(
        "Local sessions revoked for the confirmed fictional identity.",
      );
    }
  } finally {
    await client.end();
  }
}
void main().catch(() => {
  console.error(
    "Local identity maintenance failed. Check the private configuration, command and fictional input. No credentials are logged.",
  );
  process.exitCode = 1;
});
