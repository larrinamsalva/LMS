import { z } from "zod";
import { Engine, EngineError } from "./engine";
export interface VerifiedSession {
  userId: string;
  sessionId: string;
}
/** Supplied by the trusted identity host, never a body/header identity assertion. */
export type SessionResolver = (
  headers: Headers,
) => Promise<VerifiedSession | null>;
const base = {
  organizationId: z.uuid(),
  targetUserId: z.uuid(),
  revision: z.number().int().min(0),
  reason: z.string().trim().min(3).max(300),
};
export const accessChangeSchema = z.discriminatedUnion("action", [
  z
    .object({
      ...base,
      action: z.literal("set-role"),
      role: z.enum(["admin", "staff", "viewer"]),
    })
    .strict(),
  z.object({ ...base, action: z.literal("remove") }).strict(),
  z.object({ ...base, action: z.literal("transfer") }).strict(),
]);
export const accessConfirmationSchema = z
  .object({
    reviewId: z.uuid(),
    confirmation: z.literal("CONFIRM ACCESS CHANGE"),
  })
  .strict();
export interface AccessReview {
  reviewId: string;
  organizationId: string;
  actorId: string;
  targetUserId: string;
  targetName: string;
  action: "set-role" | "remove" | "transfer";
  previousRole: string | null;
  role: string | null;
  revision: number;
  reason: string;
  expiresAt: string;
  actorRoleAfter: string;
}
export interface AccessReceipt {
  reviewId: string;
  organizationId: string;
  targetUserId: string;
  action: "set-role" | "remove" | "transfer";
  previousRole: string | null;
  role: string | null;
  revision: number;
  reason: string;
  actorRoleAfter: string;
}
export interface AccessSnapshot {
  organizationId: string;
  revision: number;
  members: { userId: string; name: string; role: string }[];
}
export class AccessService {
  constructor(
    private readonly engine: Engine,
    private readonly resolve: SessionResolver,
  ) {}
  private async call<T>(
    headers: Headers,
    sql: string,
    values: (session: VerifiedSession) => unknown[],
  ) {
    const session = await this.resolve(headers);
    if (!session) throw new EngineError("Sign in before managing access.", 401);
    z.uuid().parse(session.userId);
    z.uuid().parse(session.sessionId);
    try {
      return await this.engine.asUser(
        session,
        async (tx) =>
          (await tx.query<{ result: T }>(sql, values(session))).rows[0].result,
      );
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      const status: Record<string, number> = {
        "28000": 401,
        "42501": 403,
        "40001": 409,
        "22023": 400,
        "54000": 409,
      };
      if (status[code])
        throw new EngineError(
          status[code] === 409
            ? "Access changed or review expired. Review the change again."
            : status[code] === 401
              ? "Sign in before managing access."
              : status[code] === 403
                ? "This access operation is unavailable for your current role."
                : "Check the requested access change.",
          status[code],
        );
      throw error;
    }
  }
  async snapshot(headers: Headers, organizationId: string) {
    z.uuid().parse(organizationId);
    return this.call<AccessSnapshot>(
      headers,
      "select lms.owner_access_snapshot($1,$2) as result",
      (s) => [organizationId, s.sessionId],
    );
  }
  async prepare(headers: Headers, value: unknown) {
    const change = accessChangeSchema.parse(value);
    return this.call<AccessReview>(
      headers,
      "select lms.prepare_membership($1,$2,$3,$4,$5,$6,$7) as result",
      (s) => [
        change.organizationId,
        s.sessionId,
        change.action,
        change.targetUserId,
        "role" in change ? change.role : null,
        change.revision,
        change.reason,
      ],
    );
  }
  async confirm(headers: Headers, value: unknown) {
    const confirmation = accessConfirmationSchema.parse(value);
    return this.call<AccessReceipt>(
      headers,
      "select lms.confirm_membership($1,$2) as result",
      (s) => [confirmation.reviewId, s.sessionId],
    );
  }
}
