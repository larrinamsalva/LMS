import { describe, expect, it } from "vitest";
import {
  AccessService,
  accessChangeSchema,
  accessConfirmationSchema,
} from "../../src/core/access";
import { Engine, type SqlDatabase } from "../../src/core/engine";
import { bootstrapSchema } from "../../src/server/access/bootstrap";
const uuid = "10000000-0000-4000-8000-000000000001";
const input = {
  organizationId: uuid,
  targetUserId: uuid,
  action: "set-role",
  role: "staff",
  revision: 0,
  reason: "Fictional staff access",
};
describe("owner access host contracts", () => {
  it("rejects owner escalation, extra identity fields and unconfirmed changes", () => {
    expect(accessChangeSchema.parse(input)).toEqual(input);
    for (const value of [
      { ...input, role: "owner" },
      { ...input, userId: uuid },
      { ...input, sessionId: uuid },
      { ...input, revision: -1 },
      { ...input, reason: " " },
      { ...input, action: "remove" },
    ])
      expect(accessChangeSchema.safeParse(value).success).toBe(false);
    expect(accessConfirmationSchema.safeParse({ reviewId: uuid }).success).toBe(
      false,
    );
    expect(
      accessConfirmationSchema.safeParse({ reviewId: uuid, confirmation: true })
        .success,
    ).toBe(false);
    expect(
      accessConfirmationSchema.parse({
        reviewId: uuid,
        confirmation: "CONFIRM ACCESS CHANGE",
      }).reviewId,
    ).toBe(uuid);
    const boot = {
      ownerId: uuid,
      operationId: uuid,
      preset: "property",
      name: "Fictional workspace",
      confirmation: "CREATE FICTIONAL WORKSPACE",
    };
    expect(bootstrapSchema.parse(boot)).toEqual(boot);
    expect(
      bootstrapSchema.safeParse({ ...boot, confirmation: undefined }).success,
    ).toBe(false);
    expect(
      bootstrapSchema.safeParse({ ...boot, organizationId: uuid }).success,
    ).toBe(false);
  });
  it("never touches the business database without a freshly resolved session", async () => {
    let calls = 0;
    const db = {
      transaction: async () => {
        calls++;
        throw new Error("Database must not be reached");
      },
    } as unknown as SqlDatabase;
    let resolved = 0;
    const access = new AccessService(new Engine(db), async () => {
      resolved++;
      return null;
    });
    await expect(access.snapshot(new Headers(), uuid)).rejects.toMatchObject({
      status: 401,
    });
    await expect(access.prepare(new Headers(), input)).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      access.confirm(new Headers(), {
        reviewId: uuid,
        confirmation: "CONFIRM ACCESS CHANGE",
      }),
    ).rejects.toMatchObject({ status: 401 });
    // All host methods keep their Promise contract, including schema failures.
    await expect(access.snapshot(new Headers(), "invalid")).rejects.toThrow();
    await expect(
      access.prepare(new Headers(), { ...input, userId: uuid }),
    ).rejects.toThrow();
    await expect(
      access.confirm(new Headers(), { reviewId: uuid }),
    ).rejects.toThrow();
    expect(resolved).toBe(3);
    expect(calls).toBe(0);
  });
});
