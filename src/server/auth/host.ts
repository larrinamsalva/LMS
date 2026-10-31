import { Pool } from "pg";
import { PostgresDialect } from "kysely";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { EngineError, type Principal } from "../../core/engine";
import { APIError } from "better-auth/api";
import {
  withSignInLock,
  passwordAttempt,
  credentialSnapshot,
  commitPasswordChange,
} from "./lifecycle";
import { connectionOptions } from "../postgres/adapter";
import { BodyError, readJson } from "../request-body";
import { z } from "zod";
import {
  authBasePath,
  passwordPolicy,
  passwordChangeSchema,
  credentialsSchema,
  fictionalAccountSchema,
  validateAuthOptions,
  type LocalAuthOptions,
} from "./config";
const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
async function identityPool(options: LocalAuthOptions, max = 3) {
  const pool = new Pool({
    ...connectionOptions({ connectionString: options.databaseUrl }),
    options: "-c search_path=lms_identity,pg_catalog -c role=lms_auth_service",
    max,
  });
  pool.on("error", () =>
    console.error("An idle local identity connection failed."),
  );
  try {
    const result = await pool.query<{
      safe: boolean;
    }>(`select current_user='lms_auth_service'
      and not r.rolsuper and not r.rolbypassrls and not r.rolcreatedb and not r.rolcreaterole and not r.rolinherit and r.rolcanlogin
      and not exists(select 1 from pg_namespace n where n.nspname in ('lms','lms_private','lms_meta','lms_identity') and pg_has_role(session_user,n.nspowner,'MEMBER'))
      and not exists(select 1 from pg_database d where d.datname=current_database() and pg_has_role(session_user,d.datdba,'MEMBER'))
      and not exists(select 1 from pg_roles p where p.rolname not in (session_user,'lms_auth_service') and pg_has_role(session_user,p.oid,'MEMBER')) as safe
      from pg_roles r where r.rolname=session_user`);
    if (!result.rows[0]?.safe)
      throw new Error(
        "Unsafe local identity credentials. Use the checked, separate auth runtime.",
      );
    return pool;
  } catch (error) {
    await pool.end();
    throw error;
  }
}
function authOptions(
  options: ReturnType<typeof validateAuthOptions>,
  pool: Pool,
  provisioning: boolean,
) {
  return {
    appName: "LMS local identity",
    baseURL: options.origin,
    basePath: authBasePath,
    secret: options.secret,
    database: {
      dialect: new PostgresDialect({ pool }),
      type: "postgres",
      transaction: true,
      schemaName: "lms_identity",
    },
    trustedOrigins: [options.origin],
    emailAndPassword: {
      enabled: true,
      disableSignUp: !provisioning,
      autoSignIn: false,
      minPasswordLength: passwordPolicy.minLength,
      maxPasswordLength: passwordPolicy.maxLength,
      requireEmailVerification: false,
    },
    session: {
      expiresIn: 7200,
      freshAge: passwordPolicy.recentSeconds,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rate_limit",
      window: 60,
      max: 100,
      customRules: { "/sign-in/email": { window: 60, max: 5 } },
    },
    advanced: {
      database: { generateId: "uuid" },
      ipAddress: { ipAddressHeaders: ["x-lms-local-bucket"] },
      useSecureCookies: options.secure,
      cookiePrefix: "lms_local_auth",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "strict",
        secure: options.secure,
        path: authBasePath,
      },
    },
    telemetry: { enabled: false },
    logger: { disabled: true },
  } satisfies BetterAuthOptions;
}
async function build(options: LocalAuthOptions, provisioning: boolean) {
  const valid = validateAuthOptions(options);
  const pool = await identityPool(valid);
  const auth = betterAuth(authOptions(valid, pool, provisioning));
  return { auth, pool, valid };
}
/** Trusted maintenance only: synthetic identities, no business membership and no auto-login. */
export async function provisionFictionalAccount(
  options: LocalAuthOptions,
  input: unknown,
) {
  const body = fictionalAccountSchema.parse(input);
  const { auth, pool } = await build(options, true);
  try {
    const result = await auth.api.signUpEmail({ body });
    const userId = z.uuid().parse(result.user.id);
    // Better Auth intentionally returns a synthetic user for some duplicate sign-ups.
    // Trusted provisioning must confirm a real inserted identity before reporting success.
    if (
      !(
        await pool.query(
          'select id from lms_identity."user" where id=$1 and email=$2',
          [userId, body.email],
        )
      ).rows.length
    )
      throw new Error("Fictional account was not provisioned.");
    return { userId };
  } finally {
    await pool.end();
  }
}
/** Unmounted host adapter. The public Next.js app never imports or exposes this handler. */
export async function createLocalAuth(options: LocalAuthOptions) {
  const { auth, pool, valid } = await build(options, false);
  // Separate bounded coordinator prevents checked-out lock waiters from starving auth queries.
  let coordinator: Pool;
  try {
    coordinator = await identityPool(valid, 1);
  } catch (error) {
    await pool.end();
    throw error;
  }
  async function identity(headers: Headers) {
    // No bearer plugin, user ID header, cached session data, or demo cookie can assert identity.
    const clean = new Headers();
    const cookie = headers.get("cookie");
    if (cookie) clean.set("cookie", cookie);
    const result = await auth.api.getSession({
      headers: clean,
      query: { disableCookieCache: true },
    });
    return result
      ? {
          userId: z.uuid().parse(result.user.id),
          sessionId: z.uuid().parse(result.session.id),
        }
      : null;
  }
  async function principal(headers: Headers): Promise<Principal | null> {
    const verified = await identity(headers);
    return verified ? { userId: verified.userId } : null;
  }
  return {
    principal,
    identity,
    /** Host-only self-service. Never accepts a target user, role or session from JSON. */
    async changePassword(headers: Headers, value: unknown) {
      const input = passwordChangeSchema.parse(value);
      // Capture credentials once; a caller must not switch the verifying account between awaits.
      const clean = new Headers();
      const cookie = headers.get("cookie");
      if (cookie) clean.set("cookie", cookie);
      const session = await identity(clean);
      if (!session)
        throw new EngineError("Sign in before changing credentials.", 401);
      await passwordAttempt(pool, session.userId);
      const expected = await credentialSnapshot(pool, session.userId);
      try {
        await auth.api.verifyPassword({
          headers: clean,
          body: { password: input.currentPassword },
        });
      } catch (error) {
        if (
          error instanceof APIError &&
          [400, 401, 403].includes(error.statusCode)
        )
          throw new EngineError(
            "Current credentials or session could not be verified.",
            401,
          );
        throw error;
      }
      const hash = await (await auth.$context).password.hash(input.newPassword);
      return commitPasswordChange(
        coordinator,
        session,
        expected,
        hash,
        input.operationId,
      );
    },
    async handle(request: Request) {
      try {
        const url = new URL(request.url);
        const route = url.pathname.slice(authBasePath.length);
        const post = request.method === "POST";
        if (
          url.origin !== valid.origin ||
          !url.pathname.startsWith(authBasePath + "/") ||
          url.search ||
          !(
            (request.method === "GET" && route === "/get-session") ||
            (post &&
              [
                "/sign-in/email",
                "/sign-out",
                "/revoke-sessions",
                "/revoke-other-sessions",
              ].includes(route))
          )
        )
          return Response.json(
            { error: "Endpoint unavailable." },
            { status: 404, headers: privateHeaders },
          );
        const origin = request.headers.get("origin");
        if (
          (post && origin !== valid.origin) ||
          (origin && origin !== valid.origin) ||
          ["cross-site", "same-site"].includes(
            request.headers.get("sec-fetch-site") ?? "",
          )
        )
          return Response.json(
            { error: "Origin rejected." },
            { status: 403, headers: privateHeaders },
          );
        // One conservative shared local bucket. Client forwarding/IP headers cannot evade it.
        const headers = new Headers({ "x-lms-local-bucket": "127.0.0.1" });
        const cookie = request.headers.get("cookie");
        if (cookie) headers.set("cookie", cookie);
        if (origin) headers.set("origin", origin);
        let body: string | undefined;
        if (post) {
          const input = await readJson(request, 8192);
          body = JSON.stringify(
            route === "/sign-in/email"
              ? credentialsSchema.parse(input)
              : z.object({}).strict().parse(input),
          );
          headers.set("content-type", "application/json");
        }
        const invoke = () =>
          auth.handler(
            new Request(url, { method: request.method, headers, body }),
          );
        const response =
          route === "/sign-in/email"
            ? await withSignInLock(coordinator, JSON.parse(body!).email, invoke)
            : await invoke();
        const outputHeaders = new Headers(response.headers);
        for (const name of ["content-length", "content-encoding", "etag"])
          outputHeaders.delete(name);
        for (const [name, value] of Object.entries(privateHeaders))
          outputHeaders.set(name, value);
        // Keep raw tokens out of response JSON; only the library's HttpOnly cookie transports them.
        const output = await response.json();
        const sanitized = response.ok
          ? route === "/get-session"
            ? output
              ? {
                  user: { id: output.user.id },
                  session: {
                    id: output.session.id,
                    expiresAt: output.session.expiresAt,
                  },
                }
              : null
            : { success: true }
          : {
              error:
                response.status === 429
                  ? "Try again later."
                  : "Authentication failed.",
            };
        return Response.json(sanitized, {
          status: response.status,
          headers: outputHeaders,
        });
      } catch (error) {
        const status =
          error instanceof BodyError
            ? error.status
            : error instanceof z.ZodError || error instanceof SyntaxError
              ? 400
              : 503;
        return Response.json(
          {
            error:
              status === 503
                ? "Identity service unavailable."
                : "Check the request.",
          },
          { status, headers: privateHeaders },
        );
      }
    },
    close: async () => {
      await Promise.all([pool.end(), coordinator.end()]);
    },
  };
}
