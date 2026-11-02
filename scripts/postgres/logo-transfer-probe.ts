/** Independent-process fictional test probe. No app route or arbitrary file loading. */
import { createHash, randomUUID } from "node:crypto";
import { openPrivateLogoStore } from "../../src/server/postgres/logo-assets";
import { createLocalAuth } from "../../src/server/auth/host";
import { fictionalBrandedBundle } from "../../tests/helpers/branded-logo";
async function main() {
  const [action, organizationId, operationId] = process.argv.slice(2);
  if (!["write", "read"].includes(action)) throw new Error("Unknown probe");
  const origin = "http://127.0.0.1:3200";
  const host = await createLocalAuth({
    databaseUrl: process.env.LMS_TEST_AUTH_URL ?? "",
    databaseName: process.env.LMS_TEST_DATABASE ?? "",
    origin,
    secret: process.env.LMS_TEST_AUTH_SECRET ?? "",
  });
  const store = await openPrivateLogoStore({
    databaseUrl: process.env.LMS_TEST_RUNTIME_URL ?? "",
    trustFile: process.env.LMS_TEST_LOGO_TRUST ?? "",
  });
  try {
    const login = await host.handle(
      new Request(origin + "/api/local-auth/sign-in/email", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          email: "transfer-operator@example.test",
          password: "fictional_transfer_account_password",
        }),
      }),
    );
    if (login.status !== 200) throw new Error("Sign in failed");
    const headers = new Headers({
      cookie: login.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    });
    const resolve = () => host.identity(headers);
    let receipt;
    if (action === "write") {
      const sample = await fictionalBrandedBundle();
      try {
        const { review } = await store.transfers.review(
          resolve,
          organizationId,
          sample.bundle,
        );
        receipt = await store.transfers.accept(
          resolve,
          organizationId,
          sample.bundle,
          {
            format: "lms-private-logo-transfer-command",
            version: 1,
            operationId: randomUUID(),
            review,
            confirmed: true,
          },
        );
      } finally {
        sample.image.fill(0);
      }
    } else
      receipt = (await store.transfers.history(resolve, organizationId)).find(
        (r) => r.operationId === operationId,
      );
    if (!receipt) throw new Error("Missing committed receipt");
    const identity = await resolve();
    if (!identity) throw new Error("Session expired");
    const image = await store.read(
      identity,
      organizationId,
      receipt.asset.id,
      receipt.asset.revision,
    );
    try {
      console.log(
        JSON.stringify({
          receipt,
          sha256: createHash("sha256").update(image.bytes).digest("hex"),
          bytes: image.bytes.length,
        }),
      );
    } finally {
      image.bytes.fill(0);
    }
  } finally {
    await store.close();
    await host.close();
  }
}
void main().catch(() => {
  console.error(
    "Fictional transfer probe failed; keep the lab private for inspection.",
  );
  process.exitCode = 1;
});
