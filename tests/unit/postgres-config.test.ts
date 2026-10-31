import { expect, it } from "vitest";
import { connectionOptions } from "../../src/server/postgres/adapter";
import { localTarget, sameDatabase } from "../../src/server/postgres/targets";
it("keeps maintenance local, explicitly named, and away from ordinary database names", () => {
  for (const name of [
    "postgres",
    "production",
    "lms",
    "lms_test_",
    "template1",
  ])
    expect(() =>
      localTarget(`postgres://user@127.0.0.1/${name}`, name),
    ).toThrow();
  expect(() =>
    localTarget(
      "postgres://user@remote.invalid/lms_development",
      "lms_development",
    ),
  ).toThrow();
  expect(() =>
    localTarget("postgres://user@127.0.0.1/lms_development", "lms_test_wrong"),
  ).toThrow();
  const admin = localTarget(
    "postgres://admin@127.0.0.1:5433/lms_development",
    "lms_development",
  );
  expect(() =>
    sameDatabase(
      admin,
      new URL("postgres://runtime@127.0.0.1:5432/lms_development"),
    ),
  ).toThrow();
});
it("bounds pools and requires verified remote TLS without URL overrides", () => {
  expect(
    connectionOptions({
      connectionString: "postgres://runtime:secret@127.0.0.1/lms_development",
    }).ssl,
  ).toBe(false);
  expect(
    connectionOptions({
      connectionString: "postgres://runtime:secret@db.example.test/lms",
    }).ssl,
  ).toEqual({ rejectUnauthorized: true });
  expect(() =>
    connectionOptions({
      connectionString:
        "postgres://runtime:secret@db.example.test/lms?sslmode=no-verify",
    }),
  ).toThrow();
  expect(() =>
    connectionOptions({
      connectionString: "postgres://runtime:secret@localhost/lms",
      maxConnections: 100,
    }),
  ).toThrow();
});
