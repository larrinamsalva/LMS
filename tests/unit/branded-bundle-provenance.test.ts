import { beforeAll, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  blueprintJson,
  createBlueprintPackage,
  sha256,
} from "../../src/core/blueprint";
import {
  createBrandedBlueprintBundle,
  BRANDED_BUNDLE_LIMIT,
} from "../../src/core/branded-bundle";
import { createLogoCompanion } from "../../src/core/logo-companion";
import {
  blueprintText,
  decodeBlueprintText,
  readArchive,
  writeArchive,
} from "../../src/core/stored-archive";
import {
  readBlueprintArchive,
  writeStoredZip,
} from "../../src/core/blueprint-archive";
import { reviewedGallery } from "../../src/core/gallery";
import { reviewedPublishers } from "../../src/core/blueprint-provenance";
import {
  inspectAuthenticatedBrandedBundle,
  parseBundlePublisherAttestation,
  bundleAttestationMessage,
} from "../../src/core/branded-bundle-provenance";
import { fictionalBrandedBundle } from "../helpers/branded-logo";
import { logoFixture } from "../helpers/logo-fixtures";
import { sanitizeLogo } from "../../src/server/logo-sanitizer";
import {
  testPublisher,
  testAttestation,
} from "../helpers/blueprint-provenance";
import {
  testBundleAttestation,
  rawTestBundleAttestation,
} from "../helpers/branded-bundle-provenance";
const publisher = testPublisher();
let sample: Awaited<ReturnType<typeof fictionalBrandedBundle>>,
  claim: Uint8Array;
beforeAll(async () => {
  sample = await fictionalBrandedBundle();
  claim = await testBundleAttestation(sample.bundle, publisher);
});
function files(bytes: Uint8Array) {
  return readArchive(bytes, {
    paths: [
      "manifest.json",
      "blueprint.zip",
      "README.txt",
      "logo-companion.zip",
    ],
    limits: {
      "manifest.json": 4096,
      "blueprint.zip": 98304,
      "README.txt": 8192,
      "logo-companion.zip": 266240,
    },
    bytes: BRANDED_BUNDLE_LIMIT,
  });
}
function pack(parts: Record<string, Uint8Array>) {
  return writeArchive(
    Object.entries(parts).map(([path, bytes]) => ({ path, bytes })),
    BRANDED_BUNDLE_LIMIT,
  );
}
it.each([
  [1, false],
  [1, true],
  [2, false],
  [2, true],
] as const)(
  "authenticates exact legacy package %s with image presence %s without modifying any component",
  async (version, image) => {
    const s = await fictionalBrandedBundle(version),
      bytes = image ? s.bundle : await createBrandedBlueprintBundle(s.zip),
      signed = await testBundleAttestation(bytes, publisher),
      before = new Uint8Array(bytes);
    const result = await inspectAuthenticatedBrandedBundle(
      bytes,
      { attestation: signed },
      publisher.registry,
    );
    expect(result.publisher).toMatchObject({
      status: "verified",
      keyId: publisher.registry.keys[0].id,
    });
    expect(result.blueprintVerification.publisher.status).toBe("unsigned");
    expect(result.bundle.blueprintBytes).toEqual(s.zip);
    expect(result.bundle.logoBytes).toEqual(image ? s.companion : null);
    const p = parseBundlePublisherAttestation(signed).payload;
    expect(p.bundleSha256).toBe(await sha256(bytes));
    expect(p.blueprintSha256).toBe(await sha256(s.zip));
    expect(p.imageIncluded).toBe(image);
    expect(p.logoCompanionSha256).toBe(
      image ? await sha256(s.companion) : null,
    );
    expect(p.imageSha256).toBe(image ? await sha256(s.image) : null);
    expect(bytes).toEqual(before);
    expect(
      await createBrandedBlueprintBundle(
        result.bundle.blueprintBytes,
        result.bundle.logoBytes ?? undefined,
      ),
    ).toEqual(before);
    expect((await inspectAuthenticatedBrandedBundle(bytes)).publisher).toEqual({
      status: "unsigned",
    });
  },
);
it("keeps separate nested signatures separate, verifies both when supplied, and never falls back on either failed claim", async () => {
  const nested = await testAttestation(sample.zip, publisher);
  const result = await inspectAuthenticatedBrandedBundle(
    sample.bundle,
    { blueprintAttestation: nested },
    publisher.registry,
  );
  expect(result.publisher.status).toBe("unsigned");
  expect(result.blueprintVerification.publisher.status).toBe("verified");
  const both = await inspectAuthenticatedBrandedBundle(
    sample.bundle,
    { blueprintAttestation: nested, attestation: claim },
    publisher.registry,
  );
  expect(both.publisher.status).toBe("verified");
  expect(both.blueprintVerification.publisher.status).toBe("verified");
  const bad = JSON.parse(decodeBlueprintText(nested));
  bad.signature = "00".repeat(64);
  await expect(
    inspectAuthenticatedBrandedBundle(
      sample.bundle,
      {
        attestation: claim,
        blueprintAttestation: blueprintText(blueprintJson(bad)),
      },
      publisher.registry,
    ),
  ).rejects.toThrow(/Invalid publisher signature/);
  await expect(
    inspectAuthenticatedBrandedBundle(
      sample.bundle,
      { attestation: nested },
      publisher.registry,
    ),
  ).rejects.toThrow(/separate protocol/);
  await expect(
    inspectAuthenticatedBrandedBundle(
      sample.bundle,
      { blueprintAttestation: claim },
      publisher.registry,
    ),
  ).rejects.toThrow();
});
it("does not enroll real publishers and refuses unknown, retired, substituted and forged key claims", async () => {
  expect(reviewedPublishers().keys).toEqual([]);
  await expect(
    inspectAuthenticatedBrandedBundle(sample.bundle, { attestation: claim }),
  ).rejects.toThrow(/Unknown publisher key/);
  const retired = structuredClone(publisher.registry);
  retired.keys[0].status = "retired";
  await expect(
    inspectAuthenticatedBrandedBundle(
      sample.bundle,
      { attestation: claim },
      retired,
    ),
  ).rejects.toThrow(/Retired publisher key/);
  await expect(
    inspectAuthenticatedBrandedBundle(
      sample.bundle,
      {
        attestation: await testBundleAttestation(
          sample.bundle,
          testPublisher(),
        ),
      },
      publisher.registry,
    ),
  ).rejects.toThrow(/Invalid publisher signature/);
  const forged = JSON.parse(decodeBlueprintText(claim));
  forged.signature = "00".repeat(64);
  await expect(
    inspectAuthenticatedBrandedBundle(
      sample.bundle,
      { attestation: blueprintText(blueprintJson(forged)) },
      publisher.registry,
    ),
  ).rejects.toThrow(/Invalid publisher signature/);
});
it("invalidates original whole signatures after a changed PNG, companion layout, Blueprint ZIP or valid reordered outer archive", async () => {
  const clean = await sanitizeLogo(await logoFixture("png", 64, 32)),
    companion = await createLogoCompanion(clean.bytes, {
      width: 64,
      height: 32,
      display: "rectangle",
    }),
    layout = await createLogoCompanion(sample.image, {
      width: 128,
      height: 64,
      display: "square",
    }),
    otherZip = await createBlueprintPackage(reviewedGallery()[0].plan, {
      name: "Different reviewed bytes",
      description: "Fictional only.",
    }),
    parts = files(sample.bundle);
  const changed = [
    await createBrandedBlueprintBundle(sample.zip, companion),
    await createBrandedBlueprintBundle(sample.zip, layout),
    await createBrandedBlueprintBundle(otherZip, sample.companion),
    pack(Object.fromEntries(Object.entries(parts).reverse())),
  ];
  for (const bytes of changed)
    await expect(
      inspectAuthenticatedBrandedBundle(
        bytes,
        { attestation: claim },
        publisher.registry,
      ),
    ).rejects.toThrow();
  clean.bytes.fill(0);
});
it.each(["blueprintSha256", "logoCompanionSha256", "imageSha256"] as const)(
  "rejects a correctly signed mismatched %s despite the correct outer digest",
  async (field) => {
    const signed = await testBundleAttestation(
      sample.bundle,
      publisher,
      (p) => {
        p[field] = "11".repeat(32);
      },
    );
    await expect(
      inspectAuthenticatedBrandedBundle(
        sample.bundle,
        { attestation: signed },
        publisher.registry,
      ),
    ).rejects.toThrow(/commitments do not match/);
  },
);
it("rejects false or contradictory image-present and version claims even when signed by the active test key", async () => {
  const absent = await testBundleAttestation(sample.bundle, publisher, (p) => {
    p.imageIncluded = false;
    p.imageSha256 = null;
    p.logoCompanionSha256 = null;
    p.compatibility.logoCompanion = null;
  });
  await expect(
    inspectAuthenticatedBrandedBundle(
      sample.bundle,
      { attestation: absent },
      publisher.registry,
    ),
  ).rejects.toThrow(/commitments do not match/);
  const inconsistent = await testBundleAttestation(
    sample.bundle,
    publisher,
    (p) => {
      p.imageSha256 = null;
    },
  );
  expect(() => parseBundlePublisherAttestation(inconsistent)).toThrow(
    /Malformed/,
  );
  const changed = await testBundleAttestation(sample.bundle, publisher, (p) => {
    p.compatibility.buildPlan = 1;
  });
  await expect(
    inspectAuthenticatedBrandedBundle(
      sample.bundle,
      { attestation: changed },
      publisher.registry,
    ),
  ).rejects.toThrow(/commitments do not match/);
});
it("pins the independently versioned canonical UTF-8 domain and rejects alternate/duplicate/secret-bearing encodings", () => {
  const p = parseBundlePublisherAttestation(claim).payload,
    vector = {
      ...p,
      keyId: "fixture",
      bundleSha256: "0".repeat(64),
      blueprintSha256: "1".repeat(64),
      imageIncluded: false,
      imageSha256: null,
      logoCompanionSha256: null,
      compatibility: {
        bundle: 1 as const,
        blueprintPackage: 1 as const,
        buildPlan: 1 as const,
        configurationSchema: 1 as const,
        engineApi: 1 as const,
        template: 1 as const,
        logoCompanion: null,
      },
    };
  expect(decodeBlueprintText(bundleAttestationMessage(vector))).toBe(
    'lms-branded-bundle-publisher-signature-v1\n{"algorithm":"Ed25519","blueprintSha256":"' +
      "1".repeat(64) +
      '","bundleSha256":"' +
      "0".repeat(64) +
      '","compatibility":{"blueprintPackage":1,"buildPlan":1,"bundle":1,"configurationSchema":1,"engineApi":1,"logoCompanion":null,"template":1},"format":"lms-branded-bundle-publisher-attestation","imageIncluded":false,"imageSha256":null,"keyId":"fixture","logoCompanionSha256":null,"version":1}\n',
  );
  const raw = JSON.parse(decodeBlueprintText(claim));
  for (const text of [
    JSON.stringify(raw, null, 2),
    blueprintJson(raw).trimEnd(),
    "\ufeff" + blueprintJson(raw),
    blueprintJson(raw).replace('"version":1', '"version":1,"version":1'),
    blueprintJson({ ...raw, privateKey: "forbidden" }),
    blueprintJson({
      ...raw,
      payload: { ...raw.payload, assetId: "forbidden" },
    }),
    '{"__proto__":{},"payload":{}}',
  ])
    expect(() =>
      parseBundlePublisherAttestation(blueprintText(text)),
    ).toThrow();
  for (const bytes of [
    new Uint8Array(),
    new Uint8Array(8193),
    new Uint8Array([0xff, 0xfe]),
  ])
    expect(() => parseBundlePublisherAttestation(bytes)).toThrow();
});
it.each([
  { algorithm: "RSA" },
  { algorithm: "Ed25519ph" },
  { version: 2 },
  { format: "lms-blueprint-publisher-attestation" },
])("refuses unsupported signature protocol %j", (change) => {
  const raw = JSON.parse(decodeBlueprintText(claim));
  raw.payload = { ...raw.payload, ...change };
  expect(() =>
    parseBundlePublisherAttestation(blueprintText(blueprintJson(raw))),
  ).toThrow(/Unsupported/);
});
it("rejects altered canonical payloads, signature substitution and malformed/extra nested archives", async () => {
  const raw = JSON.parse(decodeBlueprintText(claim));
  raw.payload.keyId = "substituted-id";
  const reg = structuredClone(publisher.registry);
  reg.keys[0].id = "substituted-id";
  await expect(
    inspectAuthenticatedBrandedBundle(
      sample.bundle,
      { attestation: blueprintText(blueprintJson(raw)) },
      reg,
    ),
  ).rejects.toThrow(/Invalid publisher signature/);
  const parts = files(sample.bundle);
  await expect(
    inspectAuthenticatedBrandedBundle(
      pack({ ...parts, "unexpected.exe": blueprintText("never execute") }),
      { attestation: claim },
      publisher.registry,
    ),
  ).rejects.toThrow();
  const bad = new Uint8Array(sample.bundle);
  bad[80] ^= 1;
  await expect(
    inspectAuthenticatedBrandedBundle(
      bad,
      { attestation: claim },
      publisher.registry,
    ),
  ).rejects.toThrow();
});
it("validates unsupported configurations/dependencies before cryptographic acceptance even with a correct raw signature", async () => {
  for (const dependency of [false, true]) {
    const parts = files(sample.bundle),
      inner = readBlueprintArchive(parts["blueprint.zip"]),
      plan = JSON.parse(decodeBlueprintText(inner["buildplan.json"])),
      m = JSON.parse(decodeBlueprintText(inner["manifest.json"]));
    if (dependency)
      plan.configuration.modules = plan.configuration.modules.filter(
        (m: any) => m.id !== "customers",
      );
    else
      plan.configuration.modules.push({
        id: "untrusted-executable",
        version: "1.0.0",
      });
    inner["buildplan.json"] = blueprintText(blueprintJson(plan));
    for (const f of m.files) {
      f.bytes = inner[f.path as keyof typeof inner].length;
      f.sha256 = await sha256(inner[f.path as keyof typeof inner]);
    }
    inner["manifest.json"] = blueprintText(blueprintJson(m));
    parts["blueprint.zip"] = writeStoredZip(
      Object.entries(inner).map(([path, bytes]) => ({ path, bytes })),
    );
    const outer = JSON.parse(decodeBlueprintText(parts["manifest.json"]));
    outer.blueprint.sha256 = await sha256(parts["blueprint.zip"]);
    outer.blueprint.bytes = parts["blueprint.zip"].length;
    parts["manifest.json"] = blueprintText(blueprintJson(outer));
    const bytes = pack(parts),
      payload = {
        ...parseBundlePublisherAttestation(claim).payload,
        bundleSha256: await sha256(bytes),
        blueprintSha256: outer.blueprint.sha256,
      };
    const spy = vi.spyOn(crypto.subtle, "verify");
    try {
      await expect(
        inspectAuthenticatedBrandedBundle(
          bytes,
          { attestation: rawTestBundleAttestation(payload, publisher) },
          publisher.registry,
        ),
      ).rejects.toThrow();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  }
});
it("snapshots all inputs/trust before awaits, allows identical inspection replay without writes and fails closed without crypto", async () => {
  const bytes = new Uint8Array(sample.bundle),
    detached = new Uint8Array(claim),
    registry = structuredClone(publisher.registry),
    pending = inspectAuthenticatedBrandedBundle(
      bytes,
      { attestation: detached },
      registry,
    );
  bytes.fill(0);
  detached.fill(0);
  registry.keys[0].status = "retired";
  expect((await pending).publisher.status).toBe("verified");
  const a = await inspectAuthenticatedBrandedBundle(
      sample.bundle,
      { attestation: claim },
      publisher.registry,
    ),
    b = await inspectAuthenticatedBrandedBundle(
      sample.bundle,
      { attestation: claim },
      publisher.registry,
    );
  expect(a.publisher).toEqual(b.publisher);
  expect(a.bundleSha256).toBe(b.bundleSha256);
  const spy = vi
    .spyOn(crypto.subtle, "importKey")
    .mockRejectedValueOnce(new Error("unsupported"));
  try {
    await expect(
      inspectAuthenticatedBrandedBundle(
        sample.bundle,
        { attestation: claim },
        publisher.registry,
      ),
    ).rejects.toThrow(/unavailable or failed/);
  } finally {
    spy.mockRestore();
  }
  await expect(
    inspectAuthenticatedBrandedBundle(new Uint8Array(393217), {
      attestation: claim,
    }),
  ).rejects.toThrow(/384 KiB/);
});
