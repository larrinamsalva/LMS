import { expect, it } from "vitest";
import {
  fictionalAccountSchema,
  passwordChangeSchema,
  validateAuthOptions,
} from "../../src/server/auth/config";
const base = {
  databaseUrl:
    "postgres://lms_auth_runtime:fictional_password_long_enough@127.0.0.1/lms_test_config",
  databaseName: "lms_test_config",
  origin: "http://127.0.0.1:3000",
  secret: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
};
it("requires explicit local identity credentials, origin and private secret", () => {
  expect(validateAuthOptions(base).secure).toBe(false);
  expect(
    validateAuthOptions({ ...base, origin: "https://localhost:3000" }).secure,
  ).toBe(true);
  for (const change of [
    {
      databaseUrl: base.databaseUrl.replace("lms_auth_runtime", "lms_runtime"),
    },
    { origin: "https://public.example.test" },
    { origin: base.origin + "/path" },
    { secret: "short" },
    { secret: "x".repeat(64) },
  ])
    expect(() => validateAuthOptions({ ...base, ...change })).toThrow();
});
it("only provisions fictional local accounts without granting requested roles", () => {
  const account = {
    name: "Fictional owner",
    email: "owner@example.test",
    password: "fictional-password-at-least-15",
  };
  expect(fictionalAccountSchema.parse(account).email).toBe(account.email);
  expect(() =>
    fictionalAccountSchema.parse({
      ...account,
      email: "person@real-company.com",
    }),
  ).toThrow();
  expect(() =>
    fictionalAccountSchema.parse({
      ...account,
      role: "owner",
      userId: "forged",
    }),
  ).toThrow();
  expect(() =>
    fictionalAccountSchema.parse({ ...account, password: "short" }),
  ).toThrow();
});

it("requires explicit confirmed self-service credential changes with bounded secret input", () => {
  const input = {
    operationId: "10000000-0000-4000-8000-000000000001",
    currentPassword: "fictional_current_password",
    newPassword: "fictional_new_password",
    confirmation: "CHANGE PASSWORD AND SIGN OUT",
  };
  expect(passwordChangeSchema.parse(input)).toEqual(input);
  for (const value of [
    { ...input, confirmation: undefined },
    { ...input, currentPassword: "" },
    { ...input, newPassword: "short" },
    { ...input, newPassword: "x".repeat(129) },
    { ...input, newPassword: input.currentPassword },
    { ...input, userId: input.operationId },
    { ...input, sessionId: input.operationId },
    { ...input, role: "owner" },
    { ...input, revokeOtherSessions: false },
    { ...input, operationId: "invalid" },
  ])
    expect(passwordChangeSchema.safeParse(value).success).toBe(false);
});
