import { z } from "zod";
import { localTarget } from "../postgres/targets";
export const authBasePath = "/api/local-auth";
export interface LocalAuthOptions {
  databaseUrl: string;
  databaseName: string;
  origin: string;
  secret: string;
}
export function validateAuthOptions(options: LocalAuthOptions) {
  const target = localTarget(options.databaseUrl, options.databaseName);
  if (target.username !== "lms_auth_runtime")
    throw new Error(
      "Use the separate lms_auth_runtime login for identity storage.",
    );
  const origin = new URL(options.origin);
  if (
    origin.origin !== options.origin ||
    !["http:", "https:"].includes(origin.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)
  )
    throw new Error(
      "This experimental auth host requires an exact loopback origin.",
    );
  if (
    options.secret.length < 32 ||
    options.secret.includes("REPLACE_WITH") ||
    new Set(options.secret).size < 8
  )
    throw new Error(
      "Generate a private authentication secret with at least 32 random bytes.",
    );
  return { ...options, secure: origin.protocol === "https:" };
}
export const credentialsSchema = z
  .object({ email: z.email().max(254), password: z.string().min(1).max(128) })
  .strict();
export const fictionalAccountSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    email: z.email().toLowerCase().endsWith("@example.test"),
    password: z.string().min(15).max(128),
  })
  .strict();
