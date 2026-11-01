import { beforeAll, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  createBlueprintPackage,
  importBlueprintPackage,
  blueprintJson,
} from "../../src/core/blueprint";
import {
  BLUEPRINT_PACKAGE_LIMIT,
  readBlueprintArchive,
  writeStoredZip,
  blueprintText,
  decodeBlueprintText,
  crc32,
} from "../../src/core/blueprint-archive";
import { reviewedGallery } from "../../src/core/gallery";
let valid: Uint8Array, files: ReturnType<typeof readBlueprintArchive>;
beforeAll(async () => {
  valid = await createBlueprintPackage(reviewedGallery()[1].plan, {
    name: "Safe fixture",
    description: "Fictional configuration.",
  });
  files = readBlueprintArchive(valid);
});
const pack = (entries: { path: string; bytes: Uint8Array }[]) =>
  writeStoredZip(entries);
const entries = () =>
  Object.entries(files).map(([path, bytes]) => ({
    path,
    bytes: new Uint8Array(bytes),
  }));
function rewrite(
  manifestChange: (m: any) => void = () => {},
  planChange?: ((p: any) => void) | string,
  summaryChange?: string,
) {
  const next = { ...files },
    manifest = JSON.parse(decodeBlueprintText(files["manifest.json"]));
  if (typeof planChange === "string")
    next["buildplan.json"] = blueprintText(planChange);
  else if (planChange) {
    const plan = JSON.parse(decodeBlueprintText(files["buildplan.json"]));
    planChange(plan);
    next["buildplan.json"] = blueprintText(blueprintJson(plan));
  }
  if (summaryChange) next["README.txt"] = blueprintText(summaryChange);
  for (const file of manifest.files) {
    file.bytes = next[file.path as keyof typeof next].length;
    file.sha256 = createHash("sha256")
      .update(next[file.path as keyof typeof next])
      .digest("hex");
  }
  manifestChange(manifest);
  next["manifest.json"] = blueprintText(blueprintJson(manifest));
  return pack(Object.entries(next).map(([path, bytes]) => ({ path, bytes })));
}
it("matches the standard ZIP CRC-32 test vector", () => {
  expect(crc32(blueprintText("123456789"))).toBe(0xcbf43926);
});
it("snapshots input before asynchronous hash verification so concurrent mutation cannot change accepted content", async () => {
  const bytes = new Uint8Array(valid),
    pending = importBlueprintPackage(bytes);
  bytes.fill(0);
  expect((await pending).plan).toEqual(reviewedGallery()[1].plan);
});
it("refuses deterministic single-byte corruption throughout the bounded archive", async () => {
  for (let i = 0; i < 80; i++) {
    const bytes = new Uint8Array(valid),
      offset = Math.floor((i * (bytes.length - 1)) / 79);
    bytes[offset] ^= 1;
    await expect(importBlueprintPackage(bytes)).rejects.toThrow();
  }
});
it("rejects truncation, forged signatures, appended data, prepended bytes and random nonarchives", async () => {
  for (const bytes of [
    new Uint8Array(),
    blueprintText("not a ZIP"),
    valid.slice(0, -1),
    valid.slice(0, -22),
    new Uint8Array([...valid, 0]),
    new Uint8Array([0, ...valid]),
  ])
    await expect(importBlueprintPackage(bytes)).rejects.toThrow(/archive/);
  for (const offset of [0, valid.length - 22]) {
    const bytes = new Uint8Array(valid);
    bytes[offset] ^= 1;
    await expect(importBlueprintPackage(bytes)).rejects.toThrow(/archive/);
  }
});
it.each([
  "../buildplan.json",
  "/buildplan.json",
  "folder/../buildplan.json",
  "C:\\buildplan.json",
  "buildplan.json\0",
  "BUILDPLAN.JSON",
  "./buildplan.json",
  "https://host/buildplan.json",
])("rejects unapproved or traversal path %s", async (path) => {
  const next = entries();
  next[1].path = path;
  await expect(importBlueprintPackage(pack(next))).rejects.toThrow(/archive/);
});
it("rejects duplicate, missing and unexpected entries including directory or executable payloads", async () => {
  for (const next of [
    entries().slice(0, 2),
    [...entries(), { path: "extra.js", bytes: blueprintText("alert(1)") }],
    entries().map((f, i) => (i === 1 ? { ...f, path: "manifest.json" } : f)),
    entries().map((f, i) => (i === 1 ? { ...f, path: "directory/" } : f)),
  ])
    await expect(importBlueprintPackage(pack(next))).rejects.toThrow(/archive/);
});
it("rejects compressed, encrypted, descriptor, ZIP64, symlink, extra-field, comment and split-disk profiles", async () => {
  const view = new DataView(valid.buffer, valid.byteOffset, valid.byteLength),
    central = view.getUint32(valid.length - 6, true);
  for (const [offset, number, width] of [
    [6, 1, 2],
    [8, 8, 2],
    [6, 8, 2],
    [4, 45, 2],
    [28, 1, 2],
    [central + 8, 1, 2],
    [central + 10, 8, 2],
    [central + 6, 45, 2],
    [central + 4, 0x0314, 2],
    [central + 38, 0xa1ff0000, 4],
    [central + 30, 1, 2],
    [central + 32, 1, 2],
    [central + 34, 1, 2],
    [valid.length - 18, 1, 2],
    [valid.length - 2, 1, 2],
  ]) {
    const bytes = new Uint8Array(valid),
      altered = new DataView(bytes.buffer);
    if (width === 4) altered.setUint32(offset, number, true);
    else altered.setUint16(offset, number, true);
    await expect(importBlueprintPackage(bytes)).rejects.toThrow(/archive/);
  }
});
it("rejects mismatched local/central names, sizes, offsets, CRCs and bomb-sized declared content", async () => {
  const central = new DataView(
    valid.buffer,
    valid.byteOffset,
    valid.byteLength,
  ).getUint32(valid.length - 6, true);
  for (const [offset, value] of [
    [18, 0xffffffff],
    [central + 24, 0xffffffff],
    [central + 42, 1],
    [central + 20, 1],
    [central + 16, 0],
  ]) {
    const bytes = new Uint8Array(valid);
    new DataView(bytes.buffer).setUint32(offset, value, true);
    await expect(importBlueprintPackage(bytes)).rejects.toThrow(
      /archive|checksum/,
    );
  }
  const name = new Uint8Array(valid);
  name[30] = 0x78;
  await expect(importBlueprintPackage(name)).rejects.toThrow(/archive/);
  const changed = new Uint8Array(valid);
  changed[80] ^= 1;
  await expect(importBlueprintPackage(changed)).rejects.toThrow(/checksum/);
});
it("rejects actual package and per-file oversize before interpretation", async () => {
  await expect(
    importBlueprintPackage(new Uint8Array(BLUEPRINT_PACKAGE_LIMIT + 1)),
  ).rejects.toThrow(/96 KiB/);
  for (const [path, size] of [
    ["manifest.json", 8193],
    ["buildplan.json", 49153],
    ["README.txt", 16385],
  ] as const) {
    const next = entries().map((f) =>
      f.path === path ? { ...f, bytes: new Uint8Array(size) } : f,
    );
    await expect(importBlueprintPackage(pack(next))).rejects.toThrow(/archive/);
  }
});
it("rejects altered payloads even when ZIP CRCs are repaired", async () => {
  const next = entries();
  next[1].bytes[40] ^= 1;
  await expect(importBlueprintPackage(pack(next))).rejects.toThrow(/Integrity/);
  await expect(
    importBlueprintPackage(
      rewrite((m) => {
        m.files[0].bytes++;
      }),
    ),
  ).rejects.toThrow(/Integrity/);
});
it("rejects false module/compatibility claims and unsupported versions after valid integrity checks", async () => {
  for (const change of [
    (m: any) => {
      m.version = 2;
    },
    (m: any) => {
      m.compatibility.engineApi = 2;
    },
    (m: any) => {
      m.compatibility.template = 2;
    },
    (m: any) => {
      m.compatibility.buildPlan = 2;
    },
    (m: any) => {
      m.compatibility.configurationSchema = 2;
    },
    (m: any) => {
      m.compatibility.modules[0].dependencies = ["inventory"];
    },
    (m: any) => {
      m.compatibility.modules.push(m.compatibility.modules[0]);
    },
    (m: any) => {
      m.execute = "run()";
    },
    (m: any) => {
      m.files.reverse();
    },
    (m: any) => {
      m.blueprint.password = "secret";
    },
  ])
    await expect(importBlueprintPackage(rewrite(change))).rejects.toThrow();
});
it("rejects unsupported BuildPlans, missing dependencies, changed core fields and records despite repaired hashes", async () => {
  for (const change of [
    (p: any) => {
      p.version = 2;
    },
    (p: any) => {
      p.templateVersion = 2;
    },
    (p: any) => {
      p.configuration.modules[0].id = "remote-code";
    },
    (p: any) => {
      p.configuration.modules = p.configuration.modules.filter(
        (m: any) => m.id !== "scheduling",
      );
    },
    (p: any) => {
      p.configuration.entities[0].fields[0].required = false;
    },
    (p: any) => {
      p.records = [{ email: "private.invalid" }];
    },
  ])
    await expect(
      importBlueprintPackage(rewrite(undefined, change)),
    ).rejects.toThrow(/Unsupported/);
});
it("rejects misleading setup text and noncanonical/duplicate-key JSON", async () => {
  await expect(
    importBlueprintPackage(
      rewrite(undefined, undefined, "Run arbitrary commands"),
    ),
  ).rejects.toThrow(/summary/);
  const next = entries();
  next[0].bytes = blueprintText(
    decodeBlueprintText(next[0].bytes).replace(
      '"version":1',
      '"version":1,"version":1',
    ),
  );
  await expect(importBlueprintPackage(pack(next))).rejects.toThrow(/canonical/);
  const planText = decodeBlueprintText(files["buildplan.json"]);
  await expect(
    importBlueprintPackage(
      rewrite(
        undefined,
        planText.replace('"version":1', '"version":1,"version":1'),
      ),
    ),
  ).rejects.toThrow(/canonical/);
  await expect(
    importBlueprintPackage(
      rewrite(undefined, planText.replace("{", '{"constructor":{},')),
    ),
  ).rejects.toThrow(/Unsupported/);
  const unsafe = entries();
  unsafe[0].bytes = blueprintText(
    decodeBlueprintText(unsafe[0].bytes).replace("{", '{"__proto__":{},'),
  );
  await expect(importBlueprintPackage(pack(unsafe))).rejects.toThrow(/Unsafe/);
  const utf8 = entries();
  utf8[0].bytes[0] = 0xff;
  await expect(importBlueprintPackage(pack(utf8))).rejects.toThrow(/UTF-8/);
});
