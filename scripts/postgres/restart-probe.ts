import { Engine } from "../../src/core/engine";
import { connectPostgres } from "../../src/server/postgres/adapter";
import { localTarget } from "../../src/server/postgres/targets";
// A fresh OS process opens an independent pool, reads or writes, then closes completely.
const [action, userId, organizationId, databaseName] = process.argv.slice(2);
const target = localTarget(process.env.LMS_TEST_RUNTIME_URL, databaseName);
const db = await connectPostgres({
  connectionString: target.toString(),
  maxConnections: 1,
});
try {
  const engine = new Engine(db);
  if (action === "write")
    await engine.saveRecord({ userId }, organizationId, "customers", {
      name: "Survives process restart",
      notes: "Fictional subprocess record.",
    });
  else if (action !== "read") throw new Error("Unknown probe action.");
  const snapshot = await engine.snapshot({ userId }, organizationId);
  console.log(
    JSON.stringify(
      snapshot.records.map((r) => ({ id: r.id, name: r.data.name })),
    ),
  );
} finally {
  await db.close();
}
