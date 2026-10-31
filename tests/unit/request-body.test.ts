import { expect, it } from "vitest";
import { readJson } from "../../src/server/request-body";
it("bounds actual bytes, rejects wrong content type, invalid UTF-8 and malformed JSON", async () => {
  await expect(
    readJson(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"value":"123456"}',
      }),
      4,
    ),
  ).rejects.toMatchObject({ status: 413 });
  await expect(
    readJson(new Request("http://localhost", { method: "POST", body: "{}" })),
  ).rejects.toMatchObject({ status: 415 });
  await expect(
    readJson(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: new Uint8Array([255]),
      }),
    ),
  ).rejects.toThrow(/UTF-8/);
  await expect(
    readJson(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    ),
  ).rejects.toThrow();
});
