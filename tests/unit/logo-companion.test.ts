import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  createLogoCompanion,
  inspectLogoCompanion,
  LOGO_COMPANION_LIMIT,
} from "../../src/core/logo-companion";
import {
  blueprintJson,
  sha256,
  importBlueprintPackage,
} from "../../src/core/blueprint";
import {
  blueprintText,
  readArchive,
  writeArchive,
} from "../../src/core/stored-archive";
import { writeStoredZip } from "../../src/core/blueprint-archive";
import { logoFixture } from "../helpers/logo-fixtures";
const metadata = { width: 128, height: 64, display: "rectangle" as const };
async function sample() {
  const image = await logoFixture(),
    archive = await createLogoCompanion(image, metadata);
  const { manifest } = await inspectLogoCompanion(archive);
  return { image, archive, manifest };
}
function pack(manifest: unknown, image: Uint8Array) {
  return writeArchive(
    [
      { path: "manifest.json", bytes: blueprintText(blueprintJson(manifest)) },
      { path: "logo.png", bytes: image },
    ],
    LOGO_COMPANION_LIMIT,
  );
}
it("round trips exact image bytes and layout deterministically, without an identity, publisher or configuration reference", async () => {
  const { image, archive, manifest } = await sample(),
    before = new Uint8Array(archive),
    result = await inspectLogoCompanion(archive);
  expect(result.image).toEqual(new Uint8Array(image));
  expect(result.manifest.display).toBe("rectangle");
  expect(result.manifest.image.sha256).toBe(await sha256(image));
  expect(await createLogoCompanion(image, metadata)).toEqual(archive);
  expect(archive).toEqual(before);
  expect(Object.keys(manifest).sort()).toEqual([
    "display",
    "format",
    "image",
    "version",
  ]);
  expect(JSON.stringify(manifest)).not.toMatch(
    /organization|assetId|publisher|blueprint|url/i,
  );
});
it.each([
  "../logo.png",
  "/logo.png",
  "folder/logo.png",
  "logo.PNG",
  "logo.png\0",
  "https://example.invalid/logo.png",
])("refuses unexpected path %s without extracting", async (path) => {
  const { image, manifest } = await sample();
  const bad = writeArchive(
    [
      { path: "manifest.json", bytes: blueprintText(blueprintJson(manifest)) },
      { path, bytes: image },
    ],
    LOGO_COMPANION_LIMIT,
  );
  await expect(inspectLogoCompanion(bad)).rejects.toThrow(
    /Invalid logo companion/,
  );
});
it("rejects duplicate and extra files, mismatched headers, compression, descriptors, trailing bytes and truncated archives", async () => {
  const { image, archive, manifest } = await sample();
  const entries = [
    { path: "manifest.json", bytes: blueprintText(blueprintJson(manifest)) },
    { path: "logo.png", bytes: image },
  ];
  for (const files of [
    [entries[0], entries[0]],
    [...entries, entries[1]],
    [...entries, { path: "README.txt", bytes: blueprintText("extra") }],
  ])
    await expect(
      inspectLogoCompanion(writeArchive(files, LOGO_COMPANION_LIMIT)),
    ).rejects.toThrow();
  for (const at of [4, 6, 8, 26, 28, 45, archive.length - 10]) {
    const bad = archive.slice();
    bad[at] ^= 1;
    await expect(inspectLogoCompanion(bad)).rejects.toThrow();
  }
  await expect(
    inspectLogoCompanion(new Uint8Array([...archive, 0])),
  ).rejects.toThrow();
  await expect(inspectLogoCompanion(archive.subarray(0, -1))).rejects.toThrow();
});
it("rejects unsupported versions, formats, layouts, dimensions, misleading MIME and publisher claims", async () => {
  const { image, manifest } = await sample();
  for (const change of [
    { version: 2 },
    { format: "lms-blueprint" },
    { display: "<script>" },
    { publisher: "Official" },
    { url: "https://example.invalid/a.png" },
    { image: { ...manifest.image, format: "jpeg" } },
    { image: { ...manifest.image, mime: "image/png" } },
    { image: { ...manifest.image, width: 513 } },
    { image: { ...manifest.image, height: 0 } },
    { image: { ...manifest.image, path: "../logo.png" } },
  ])
    await expect(
      inspectLogoCompanion(pack({ ...manifest, ...change }, image)),
    ).rejects.toThrow();
  await expect(
    inspectLogoCompanion(
      pack({ ...manifest, image: { ...manifest.image, width: 127 } }, image),
    ),
  ).rejects.toThrow(/integrity/);
});
it("rejects altered image bytes even with repaired ZIP CRC, swapped images, false digests and spoofed PNG declarations", async () => {
  const { image, manifest } = await sample(),
    bad = Buffer.from(image);
  bad[45] ^= 1;
  for (const bytes of [
    bad,
    await logoFixture("jpeg"),
    Buffer.from("<svg><script>evil()</script></svg>"),
  ])
    await expect(inspectLogoCompanion(pack(manifest, bytes))).rejects.toThrow();
  await expect(
    inspectLogoCompanion(
      pack(
        { ...manifest, image: { ...manifest.image, sha256: "0".repeat(64) } },
        image,
      ),
    ),
  ).rejects.toThrow(/integrity/);
  await expect(
    inspectLogoCompanion(
      pack(
        { ...manifest, image: { ...manifest.image, bytes: image.length + 1 } },
        image,
      ),
    ),
  ).rejects.toThrow(/integrity/);
});
it("bounds archive and individual file bytes; refuses duplicate JSON keys, alternate encoding, BOM and invalid UTF-8", async () => {
  const { image, manifest } = await sample(),
    text = blueprintJson(manifest);
  for (const bytes of [
    blueprintText(text.replace('"version":1', '"version":1,"version":1')),
    blueprintText("\ufeff" + text),
    blueprintText(JSON.stringify(manifest)),
    new Uint8Array([0xff]),
    new Uint8Array(2049),
  ])
    await expect(
      inspectLogoCompanion(
        writeArchive(
          [
            { path: "manifest.json", bytes },
            { path: "logo.png", bytes: image },
          ],
          LOGO_COMPANION_LIMIT,
        ),
      ),
    ).rejects.toThrow();
  await expect(
    inspectLogoCompanion(new Uint8Array(LOGO_COMPANION_LIMIT + 1)),
  ).rejects.toThrow(/260 KiB/);
  await expect(inspectLogoCompanion(new Uint8Array())).rejects.toThrow(
    /nonempty/,
  );
  await expect(
    inspectLogoCompanion(pack(manifest, new Uint8Array(262145))),
  ).rejects.toThrow();
});
it("keeps the legacy blueprint ZIP reader/writer profile and fixed v1 fixture bytes unchanged", async () => {
  const fixture = new Uint8Array(
    await readFile("tests/fixtures/blueprint-v1.zip"),
  );
  const files = readArchive(fixture, {
    paths: ["manifest.json", "buildplan.json", "README.txt"],
    limits: {
      "manifest.json": 8192,
      "buildplan.json": 49152,
      "README.txt": 16384,
    },
    bytes: 98304,
  });
  expect(
    writeStoredZip(
      Object.entries(files).map(([path, bytes]) => ({ path, bytes })),
    ),
  ).toEqual(fixture);
  expect((await importBlueprintPackage(fixture)).plan.version).toBe(1);
  expect(() =>
    writeStoredZip([{ path: "image.png", bytes: new Uint8Array(98304) }]),
  ).toThrow(/96 KiB/);
});
