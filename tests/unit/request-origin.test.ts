import { expect, it } from "vitest";
import { sameOrigin } from "../../src/server/request-origin";
it("preserves loopback Host despite Next URL normalization; rejects foreign/null/forwarded origins", () => {
  const make = (origin: string, host = "127.0.0.1:3100") =>
    new Request("http://localhost:3100/api/demo", {
      headers: {
        Host: host,
        Origin: origin,
        "X-Forwarded-Host": "attacker.invalid",
      },
    });
  expect(sameOrigin(make("http://127.0.0.1:3100"))).toBe(true);
  expect(sameOrigin(make("https://attacker.invalid"))).toBe(false);
  expect(sameOrigin(make("null"))).toBe(false);
  expect(sameOrigin(make("http://127.0.0.1:3000"))).toBe(false);
  expect(sameOrigin(make("http://attacker.invalid", "attacker.invalid"))).toBe(
    false,
  );
  expect(
    sameOrigin(make("https://demo.example.test"), "https://demo.example.test"),
  ).toBe(true);
  expect(
    sameOrigin(make("https://attacker.invalid"), "https://demo.example.test"),
  ).toBe(false);
  expect(
    sameOrigin(
      make("https://demo.example.test"),
      "https://demo.example.test/path",
    ),
  ).toBe(false);
});
