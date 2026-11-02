import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  createBrandedBlueprintBundle,
  inspectBrandedBlueprintBundle,
  brandedBundleSummary,
  BRANDED_BUNDLE_LIMIT,
} from "../../src/core/branded-bundle";
import {
  blueprintJson,
  createBlueprintPackage,
  importBlueprintPackage,
  sha256,
} from "../../src/core/blueprint";
import { planForConfig, brandBuildPlan } from "../../src/core/buildplan";
import { defaultBranding } from "../../src/core/branding";
import { presets } from "../../src/presets";
import {
  createLogoCompanion,
  inspectLogoCompanion,
} from "../../src/core/logo-companion";
import {
  blueprintText,
  readArchive,
  writeArchive,
} from "../../src/core/stored-archive";
import { inspectBlueprintPackage } from "../../src/core/blueprint-provenance";
import { sanitizeLogo } from "../../src/server/logo-sanitizer";
import { logoFixture } from "../helpers/logo-fixtures";
import {
  testPublisher,
  testAttestation,
} from "../helpers/blueprint-provenance";
const paths = [
  "manifest.json",
  "blueprint.zip",
  "README.txt",
  "logo-companion.zip",
] as const;
async function sample(version = 2) {
  const plan = planForConfig(presets.cleaning),
    zip = await createBlueprintPackage(
      version === 1 ? plan : brandBuildPlan(plan, defaultBranding("cleaning")),
      {
        name: "Fictional portable cleaners",
        description: "Reviewed fictional configuration and optional image.",
      },
    );
  const clean = await sanitizeLogo(await logoFixture()),
    companion = await createLogoCompanion(clean.bytes, {
      width: clean.width,
      height: clean.height,
      display: "rectangle",
    });
  return {
    zip,
    companion,
    bundle: await createBrandedBlueprintBundle(zip, companion),
  };
}
function files(bytes: Uint8Array): Record<string, Uint8Array> {
  return readArchive(bytes, {
    paths,
    limits: {
      "manifest.json": 4096,
      "blueprint.zip": 98304,
      "README.txt": 8192,
      "logo-companion.zip": 266240,
    },
    bytes: BRANDED_BUNDLE_LIMIT,
  });
}
function pack(data: Record<string, Uint8Array>) {
  return writeArchive(
    Object.entries(data).map(([path, bytes]) => ({ path, bytes })),
    BRANDED_BUNDLE_LIMIT,
  );
}
function manifest(data: Record<string, Uint8Array>) {
  return JSON.parse(new TextDecoder().decode(data["manifest.json"]));
}
function setManifest(data: Record<string, Uint8Array>, m: unknown) {
  data["manifest.json"] = blueprintText(blueprintJson(m));
}
it.each([1, 2])(
  "round trips exact legacy package %s and companion bytes deterministically, without conversion or local references",
  async (version) => {
    const s = await sample(version),
      r = await inspectBrandedBlueprintBundle(s.bundle);
    expect(r.blueprintBytes).toEqual(s.zip);
    expect(r.logoBytes).toEqual(s.companion);
    expect(r.blueprint.plan.version).toBe(version);
    expect(r.manifest.compatibility.configurationSchema).toBe(version);
    expect(r.manifest.blueprint.sha256).toBe(await sha256(s.zip));
    expect(r.manifest.logo!.sha256).toBe(await sha256(s.companion));
    expect(r.logo!.display).toBe("rectangle");
    expect(
      await createBrandedBlueprintBundle(r.blueprintBytes, r.logoBytes!),
    ).toEqual(s.bundle);
    expect(Object.keys(r.manifest).sort()).toEqual([
      "blueprint",
      "compatibility",
      "format",
      "logo",
      "summary",
      "version",
    ]);
    expect(JSON.stringify(r.manifest)).not.toMatch(
      /assetId|organizationId|privateUrl|publisher|credential|customerRecords/,
    );
    expect(r).not.toHaveProperty("image");
    expect(r.summary).toContain("publisher authenticity are UNVERIFIED");
  },
);
it("supports an optional absent logo and preserves a frozen v1 golden package byte for byte", async () => {
  const zip = new Uint8Array(await readFile("tests/fixtures/blueprint-v1.zip")),
    before = zip.slice();
  const r = await inspectBrandedBlueprintBundle(
    await createBrandedBlueprintBundle(zip),
  );
  expect(r.logo).toBeNull();
  expect(r.logoBytes).toBeNull();
  expect(r.manifest.logo).toBeNull();
  expect(r.manifest.compatibility.logoCompanion).toBeNull();
  expect(r.blueprintBytes).toEqual(before);
  expect(zip).toEqual(before);
});
it.each([1, 2])(
  "preserves an independently signed package %s while conferring no complete-bundle or image authenticity",
  async (version) => {
    const { zip, companion } = await sample(version),
      key = testPublisher(),
      claim = await testAttestation(zip, key),
      r = await inspectBrandedBlueprintBundle(
        await createBrandedBlueprintBundle(zip, companion),
      );
    const verified = await inspectBlueprintPackage(
      r.blueprintBytes,
      claim,
      key.registry,
    );
    expect(verified.publisher.status).toBe("verified");
    expect(r.blueprintBytes).toEqual(zip);
    expect(r.manifest).not.toHaveProperty("publisher");
    expect(r.summary).toContain("ONLY the exact nested Blueprint ZIP");
    await expect(
      inspectBlueprintPackage(r.blueprintBytes, claim),
    ).rejects.toThrow(/Unknown publisher key/);
  },
);
it("snapshots both input components and complete archives before asynchronous hashing", async () => {
  const s = await sample(),
    z = s.zip.slice(),
    c = s.companion.slice();
  const pending = createBrandedBlueprintBundle(z, c);
  z.fill(0);
  c.fill(0);
  const b = await pending;
  const original = b.slice(),
    inspecting = inspectBrandedBlueprintBundle(b);
  b.fill(0);
  const r = await inspecting;
  expect(r.blueprintBytes).toEqual(s.zip);
  expect(r.logoBytes).toEqual(s.companion);
  expect(
    await createBrandedBlueprintBundle(r.blueprintBytes, r.logoBytes!),
  ).toEqual(original);
});
it.each([
  "../blueprint.zip",
  "/blueprint.zip",
  "folder/blueprint.zip",
  "blueprint.ZIP",
  "blueprint.zip\0",
  "https://invalid.test/logo.png",
])("refuses unreviewed outer path %s", async (path) => {
  const d = files((await sample()).bundle);
  d[path] = d["blueprint.zip"];
  delete d["blueprint.zip"];
  await expect(inspectBrandedBlueprintBundle(pack(d))).rejects.toThrow(
    /branded bundle/i,
  );
});
it("rejects duplicate/extra files, mismatched headers, compression, attributes, comments, preambles, truncation and trailing bytes", async () => {
  const { bundle } = await sample(),
    d = files(bundle),
    entries = Object.entries(d).map(([path, bytes]) => ({ path, bytes }));
  for (const bad of [
    [...entries, entries[0]],
    entries.map((f, i) => (i === 1 ? entries[0] : f)),
    [...entries, { path: "run.js", bytes: blueprintText("alert(1)") }],
  ])
    await expect(
      inspectBrandedBlueprintBundle(writeArchive(bad, BRANDED_BUNDLE_LIMIT)),
    ).rejects.toThrow();
  for (const at of [4, 6, 8, 26, 28, bundle.length - 10, bundle.length - 2]) {
    const bad = bundle.slice();
    bad[at] ^= 1;
    await expect(inspectBrandedBlueprintBundle(bad)).rejects.toThrow();
  }
  for (const bad of [
    bundle.slice(0, -1),
    new Uint8Array([...bundle, 0]),
    new Uint8Array([0, ...bundle]),
  ])
    await expect(inspectBrandedBlueprintBundle(bad)).rejects.toThrow();
});
it("rejects altered and swapped components even when the outer ZIP CRC is rebuilt", async () => {
  const { bundle } = await sample();
  for (const path of ["blueprint.zip", "logo-companion.zip", "README.txt"]) {
    const d = files(bundle);
    d[path][Math.min(80, d[path].length - 1)] ^= 1;
    await expect(inspectBrandedBlueprintBundle(pack(d))).rejects.toThrow(
      /integrity failed/,
    );
  }
  const d = files(bundle),
    parsed = await inspectLogoCompanion(d["logo-companion.zip"]);
  d["logo-companion.zip"] = await createLogoCompanion(parsed.image, {
    ...parsed.manifest.image,
    display: "square",
  });
  await expect(inspectBrandedBlueprintBundle(pack(d))).rejects.toThrow(
    /integrity failed/,
  );
  const m = manifest(d);
  m.logo.sha256 = await sha256(d["logo-companion.zip"]);
  m.logo.bytes = d["logo-companion.zip"].length;
  setManifest(d, m);
  await expect(inspectBrandedBlueprintBundle(pack(d))).rejects.toThrow(
    /layout/,
  );
});
it.each([
  (m: any) => {
    m.version = 2;
  },
  (m: any) => {
    m.compatibility.configurationSchema = 99;
  },
  (m: any) => {
    m.compatibility.blueprintPackage = 1;
  },
  (m: any) => {
    m.logo.path = "../logo.png";
  },
  (m: any) => {
    m.logo.bytes = 1;
  },
  (m: any) => {
    m.logo.sha256 = "F".repeat(64);
  },
  (m: any) => {
    m.logo.display = "url(https://invalid.test)";
  },
  (m: any) => {
    m.assetId = "00000000-0000-4000-8000-000000000000";
  },
  (m: any) => {
    m.publisher = { verified: true };
  },
  (m: any) => {
    m.destinationMapping = { organizationId: "foreign" };
  },
  (m: any) => {
    m.compatibility.logoCompanion = null;
  },
  (m: any) => {
    m.logo = null;
  },
])(
  "refuses unsupported/misleading manifest or compatibility claim %#",
  async (change) => {
    const d = files((await sample()).bundle),
      m = manifest(d);
    change(m);
    setManifest(d, m);
    await expect(inspectBrandedBlueprintBundle(pack(d))).rejects.toThrow();
  },
);
it("requires exact canonical manifest JSON, no duplicate keys, BOM, alternate encodings or unsafe unknown keys", async () => {
  const d = files((await sample()).bundle),
    m = manifest(d),
    canonical = blueprintJson(m);
  for (const text of [
    JSON.stringify(m, null, 2),
    canonical.trim(),
    "\ufeff" + canonical,
    canonical.replace("{", '{"version":1,'),
    canonical.replace("{", '{"__proto__":{"verified":true},'),
  ]) {
    const bad = { ...d, "manifest.json": blueprintText(text) };
    await expect(inspectBrandedBlueprintBundle(pack(bad))).rejects.toThrow();
  }
});
it("validates nested archives and module contracts even if every enclosing digest is recomputed", async () => {
  const d = files((await sample()).bundle),
    m = manifest(d),
    bad = d["blueprint.zip"].slice();
  new DataView(bad.buffer).setUint16(8, 8, true);
  d["blueprint.zip"] = bad;
  m.blueprint.sha256 = await sha256(bad);
  setManifest(d, m);
  await expect(inspectBrandedBlueprintBundle(pack(d))).rejects.toThrow(
    /Invalid blueprint archive/,
  );
  const nested = writeArchive(
      [
        { path: "manifest.json", bytes: blueprintText("{}") },
        { path: "logo.png", bytes: blueprintText("not PNG") },
        { path: "logo.png", bytes: blueprintText("duplicate") },
      ],
      266240,
    ),
    e = files((await sample()).bundle),
    n = manifest(e);
  e["logo-companion.zip"] = nested;
  n.logo.bytes = nested.length;
  n.logo.sha256 = await sha256(nested);
  setManifest(e, n);
  await expect(inspectBrandedBlueprintBundle(pack(e))).rejects.toThrow(
    /Invalid logo companion/,
  );
});
it("refuses unsupported nested modules with correctly rebuilt nested and outer integrity metadata", async () => {
  const d = files((await sample()).bundle),
    m = manifest(d),
    nested = readArchive(d["blueprint.zip"], {
      paths: ["manifest.json", "buildplan.json", "README.txt"],
      limits: {
        "manifest.json": 8192,
        "buildplan.json": 49152,
        "README.txt": 16384,
      },
      bytes: 98304,
    }),
    plan = JSON.parse(new TextDecoder().decode(nested["buildplan.json"]));
  plan.configuration.modules[0].version = "99.0.0";
  nested["buildplan.json"] = blueprintText(blueprintJson(plan));
  const nm = JSON.parse(new TextDecoder().decode(nested["manifest.json"]));
  nm.files[0].bytes = nested["buildplan.json"].length;
  nm.files[0].sha256 = await sha256(nested["buildplan.json"]);
  nested["manifest.json"] = blueprintText(blueprintJson(nm));
  d["blueprint.zip"] = writeArchive(
    Object.entries(nested).map(([path, bytes]) => ({ path, bytes })),
    98304,
  );
  m.blueprint.bytes = d["blueprint.zip"].length;
  m.blueprint.sha256 = await sha256(d["blueprint.zip"]);
  setManifest(d, m);
  await expect(inspectBrandedBlueprintBundle(pack(d))).rejects.toThrow(
    /Unsupported or malformed blueprint/,
  );
});
it("does not confuse complete attacker-rebuilt integrity with publisher authenticity", async () => {
  const s = await sample(),
    r = await inspectBrandedBlueprintBundle(s.bundle),
    other = await createLogoCompanion(
      (await inspectLogoCompanion(s.companion)).image,
      { ...r.logo!.image, display: "square" },
    );
  const rebuilt = await inspectBrandedBlueprintBundle(
    await createBrandedBlueprintBundle(s.zip, other),
  );
  expect(rebuilt.logo!.display).toBe("square");
  expect(rebuilt.summary).toContain("publisher authenticity are UNVERIFIED");
});
it("enforces total/component bounds and an exact compatibility summary", async () => {
  await expect(
    inspectBrandedBlueprintBundle(new Uint8Array(BRANDED_BUNDLE_LIMIT + 1)),
  ).rejects.toThrow(/384 KiB/);
  await expect(
    inspectBrandedBlueprintBundle(new Uint8Array()),
  ).rejects.toThrow();
  const s = await sample();
  await expect(
    createBrandedBlueprintBundle(new Uint8Array(98305), s.companion),
  ).rejects.toThrow(/limits/);
  await expect(
    createBrandedBlueprintBundle(s.zip, new Uint8Array(266241)),
  ).rejects.toThrow(/limits/);
  const d = files(s.bundle),
    m = manifest(d);
  d["README.txt"] = blueprintText(
    "This bundle is officially signed and safe to activate.\n",
  );
  m.summary.bytes = d["README.txt"].length;
  m.summary.sha256 = await sha256(d["README.txt"]);
  setManifest(d, m);
  await expect(inspectBrandedBlueprintBundle(pack(d))).rejects.toThrow(
    /summary does not match/,
  );
  expect(
    brandedBundleSummary(await importBlueprintPackage(s.zip), null),
  ).toContain("No image companion");
});
