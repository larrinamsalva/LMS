import { Client, type ClientConfig } from "pg";
const offlineKey = 74021906;
/** A separate connection holds this lease; no request-pool slot is consumed. */
export async function runtimeLease(
  config: ClientConfig,
  role: "lms_app" | "lms_auth_service",
  required = true,
) {
  const client = new Client({ ...config, options: `-c role=${role}` });
  let healthy = true;
  client.on("error", () => {
    healthy = false;
  });
  try {
    await client.connect();
    if (
      !(
        await client.query("select pg_try_advisory_lock_shared($1) as held", [
          offlineKey,
        ])
      ).rows[0].held
    )
      throw new Error("Offline recovery in progress. Stop runtime hosts.");
    if (
      (
        await client.query(
          "select exists(select 1 from pg_db_role_setting s where s.setdatabase=(select oid from pg_database where datname=current_database()) and s.setrole=0 and 'lms.restore_blocked=on'=any(s.setconfig)) as blocked",
        )
      ).rows[0].blocked
    )
      throw new Error(
        "Recovery activation blocked by durable restore quarantine.",
      );
    if (
      (
        await client.query(
          "select to_regclass('lms_control.restore_blocker') as marker",
        )
      ).rows[0].marker
    )
      throw new Error(
        "Recovery activation blocked by restore marker. Offline verification only.",
      );
    const found = (
      await client.query("select to_regclass('lms_control.state') as state")
    ).rows[0].state;
    if (!found && !required) {
      await client.end();
      return { assertOpen() {}, async close() {} };
    }
    if (
      !found ||
      !(
        await client.query(
          "select not blocked as ready from lms_control.state where singleton",
        )
      ).rows[0]?.ready
    )
      throw new Error(
        "Recovery activation blocked. Offline verification only; no activation override is provided.",
      );
    return {
      assertOpen() {
        if (!healthy)
          throw new Error(
            "Runtime lease lost. Restart only after offline review.",
          );
      },
      async close() {
        healthy = false;
        await client.end();
      },
    };
  } catch (error) {
    await client.end();
    throw error;
  }
}
