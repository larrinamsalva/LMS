/** Test-only independent-process probe. Never mounted, never accepts a real account or image path. */
import { openPrivateLogoStore } from "../../src/server/postgres/logo-assets";
import { logoFixture } from "../../tests/helpers/logo-fixtures";
import { createHash } from "node:crypto";
async function main() {
  const [action, actor, org, operationOrAsset, revision] =
    process.argv.slice(2);
  if (!["write", "read"].includes(action)) throw new Error("Unknown probe");
  const store = await openPrivateLogoStore({
    databaseUrl: process.env.LMS_TEST_RUNTIME_URL ?? "",
    trustFile: process.env.LMS_TEST_LOGO_TRUST ?? "",
  });
  try {
    if (action === "write") {
      const receipt = await store.store(
        { userId: actor },
        org,
        await logoFixture(),
        {
          version: 1,
          operationId: operationOrAsset,
          expectedRevision: 0,
          display: "rectangle",
        },
      );
      console.log(JSON.stringify(receipt));
    } else {
      const image = await store.read(
        { userId: actor },
        org,
        operationOrAsset,
        Number(revision),
      );
      console.log(
        JSON.stringify({
          id: image.metadata.id,
          revision: image.metadata.revision,
          sha256: createHash("sha256").update(image.bytes).digest("hex"),
          bytes: image.bytes.length,
        }),
      );
      image.bytes.fill(0);
    }
  } finally {
    await store.close();
  }
}
void main().catch(() => {
  console.error(
    "Fictional private-logo probe failed. Keep targets offline for inspection.",
  );
  process.exitCode = 1;
});
