import type { Pool, PoolClient } from "pg";
import type { VerifiedSession } from "../../core/access";
import { EngineError } from "../../core/engine";

export async function identityTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Lock coordination only; Better Auth still performs all login/password verification. */
export function withSignInLock<T>(
  pool: Pool,
  email: string,
  signIn: () => Promise<T>,
) {
  return identityTransaction(pool, async (client) => {
    await client.query(
      `select a.id from lms_identity.account a join lms_identity."user" u on u.id=a."userId"
      where u.email=lower($1) and a."providerId"='credential' order by a.id for share of a`,
      [email],
    );
    return signIn();
  });
}

/** Count even incorrect-password attempts atomically, using existing throttle storage. */
export async function passwordAttempt(pool: Pool, userId: string) {
  const attempt = (
    await pool.query<{ count: number }>(
      `
    insert into lms_identity.rate_limit(key,count,"lastRequest")
    values($1,1,floor(extract(epoch from statement_timestamp())*1000)::bigint)
    on conflict(key) do update set
      count=case when rate_limit."lastRequest"<=excluded."lastRequest"-60000 then 1 else least(rate_limit.count,5)+1 end,
      "lastRequest"=case when rate_limit."lastRequest"<=excluded."lastRequest"-60000 then excluded."lastRequest" else rate_limit."lastRequest" end
    returning count`,
      ["lms:credential-change:" + userId],
    )
  ).rows[0];
  if (attempt.count > 5) throw new EngineError("Try again later.", 429);
}

export interface CredentialSnapshot {
  id: string;
  password: string;
}
/** A private snapshot for compare-and-swap, never a return value from the host API. */
export async function credentialSnapshot(
  pool: Pool,
  userId: string,
): Promise<CredentialSnapshot> {
  const rows = (
    await pool.query<CredentialSnapshot>(
      `
    select a.id,a.password from lms_identity.account a join lms_identity."user" u on u.id=a."userId"
    where u.id=$1 and u.email like '%@example.test' and a."providerId"='credential'`,
      [userId],
    )
  ).rows;
  if (rows.length !== 1 || !rows[0].password)
    throw new EngineError("Fictional credential account unavailable.", 403);
  return rows[0];
}

/** Password hashing/verification happens in Better Auth; only this final transaction mutates. */
export async function commitPasswordChange(
  pool: Pool,
  session: VerifiedSession,
  expected: CredentialSnapshot,
  newHash: string,
  operationId: string,
) {
  try {
    return await identityTransaction(pool, async (client) => {
      const locked = await client.query(
        `select id from lms_identity.account
        where id=$1 and "userId"=$2 and password=$3 for update`,
        [expected.id, session.userId, expected.password],
      );
      if (!locked.rows.length)
        throw new EngineError(
          "Credentials changed. Sign in and review again.",
          409,
        );
      await client.query(
        "select lms_identity.require_recent_session($1,$2,true)",
        [session.userId, session.sessionId],
      );
      await replaceCredential(
        client,
        expected.id,
        session.userId,
        newHash,
        operationId,
      );
      return {
        success: true as const,
        signInRequired: true as const,
        operationId,
      };
    });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    if (code === "28000")
      throw new EngineError("Sign in again before changing credentials.", 401);
    if (code === "23505")
      throw new EngineError(
        "Credential operation already used. Sign in and review again.",
        409,
      );
    throw error;
  }
}

/** Shared atomic mutation; callers must first lock and authorize the credential/session or recovery case. */
export async function replaceCredential(
  client: Pick<PoolClient, "query">,
  accountId: string,
  userId: string,
  newHash: string,
  operationId: string,
) {
  await client.query("select set_config('lms.credential_operation',$1,true)", [
    operationId,
  ]);
  await client.query('delete from lms_identity.session where "userId"=$1', [
    userId,
  ]);
  await client.query(
    'update lms_identity.account set password=$1,"updatedAt"=clock_timestamp() where id=$2 and "userId"=$3',
    [newHash, accountId, userId],
  );
}
