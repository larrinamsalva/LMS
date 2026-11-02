/** Independent-process fictional test probe only. Not mounted by the application. */
import { randomUUID, createHash } from "node:crypto";
import { openPrivateLogoStore } from "../../src/server/postgres/logo-assets";
import { logoFixture } from "../../tests/helpers/logo-fixtures";
async function main() {
  const [action, userId, org] = process.argv.slice(2);
  if (!["write", "read"].includes(action)) throw new Error("Unknown probe");
  const store = await openPrivateLogoStore({
    databaseUrl: process.env.LMS_TEST_RUNTIME_URL ?? "",
    trustFile: process.env.LMS_TEST_LOGO_TRUST ?? "",
  });
  const actor = { userId };
  try {
    if (action === "write") {
      const stored = await store.store(actor, org, await logoFixture(), {
        version: 1,
        operationId: randomUUID(),
        expectedRevision: 0,
        display: "rectangle",
      });
      await store.change(actor, org, {
        version: 1,
        operationId: randomUUID(),
        expectedRevision: stored.revision,
        assetId: stored.assetId,
        assetRevision: stored.assetRevision,
        action: "select",
      });
      const review = await store.associations.review(actor, org, {
        mode: "image",
        display: "rectangle",
        historyRevision: null,
      });
      await store.associations.apply(actor, org, {
        format: "lms-private-logo-association-command",
        version: 1,
        operationId: randomUUID(),
        review,
        confirmed: true,
      });
    }
    const read = await store.associations.read(actor, org);
    if (!read.logo)
      throw new Error("Expected explicitly associated fictional image");
    console.log(
      JSON.stringify({
        association: read.inspection.association,
        sha256: createHash("sha256").update(read.logo.bytes).digest("hex"),
        bytes: read.logo.bytes.length,
      }),
    );
    read.logo.bytes.fill(0);
  } finally {
    await store.close();
  }
}
void main().catch(() => {
  console.error(
    "Fictional association probe failed; keep the lab private for inspection.",
  );
  process.exitCode = 1;
});
