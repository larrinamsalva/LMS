import { beforeAll, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  blueprintJson,
  createBlueprintPackage,
  sha256,
} from "../../src/core/blueprint";
import {
  blueprintText,
  decodeBlueprintText,
  readBlueprintArchive,
  writeStoredZip,
} from "../../src/core/blueprint-archive";
import {
  inspectBlueprintPackage,
  attestationMessage,
  parsePublisherAttestation,
  reviewedPublishers,
  validatePublisherRegistry,
} from "../../src/core/blueprint-provenance";
import { reviewedGallery } from "../../src/core/gallery";
import { brandBuildPlan } from "../../src/core/buildplan";
import { defaultBranding } from "../../src/core/branding";
import {
  rawTestAttestation,
  testAttestation,
  testPublisher,
} from "../helpers/blueprint-provenance";
let bytes: Uint8Array, claim: Uint8Array;
const publisher = testPublisher(),
  details = {
    name: "Fictional verified starter",
    description: "Configuration only.",
    gallery: { id: "basic-cleaning", revision: 1 },
  };
beforeAll(async () => {
  bytes = await createBlueprintPackage(reviewedGallery()[0].plan, details);
  claim = await testAttestation(bytes, publisher);
});
it("verifies exact bytes with a separately trusted ephemeral Ed25519 public key without changing the ZIP or plan", async () => {
  const before = new Uint8Array(bytes),
    inspected = await inspectBlueprintPackage(bytes, claim, publisher.registry);
  expect(inspected.publisher).toMatchObject({
    status: "verified",
    keyId: publisher.registry.keys[0].id,
    gallery: details.gallery,
  });
  expect(inspected.gallery.status).toBe("reviewed-content");
  expect(inspected.packageSha256).toBe(await sha256(before));
  expect(bytes).toEqual(before);
  expect(
    await createBlueprintPackage(inspected.blueprint.plan, details),
  ).toEqual(before);
  expect(Object.keys(readBlueprintArchive(bytes))).toEqual([
    "manifest.json",
    "buildplan.json",
    "README.txt",
  ]);
});
it("keeps original PR16 v1 and branded v2 packages importable, unsigned and exact on round trip", async () => {
  const v1 = new Uint8Array(await readFile("tests/fixtures/blueprint-v1.zip")),
    plan = brandBuildPlan(
      reviewedGallery()[0].plan,
      defaultBranding("cleaning"),
    ),
    v2 = await createBlueprintPackage(plan, details);
  for (const zip of [v1, v2]) {
    const result = await inspectBlueprintPackage(zip);
    expect(result.publisher).toEqual({ status: "unsigned" });
    expect(
      await createBlueprintPackage(
        result.blueprint.plan,
        result.blueprint.manifest.blueprint,
      ),
    ).toEqual(zip);
  }
  expect(
    (
      await inspectBlueprintPackage(
        v2,
        await testAttestation(v2, publisher),
        publisher.registry,
      )
    ).publisher.status,
  ).toBe("verified");
});
it("rejects changed but structurally valid ZIPs, forged signatures and mismatched versions or editions", async () => {
  const changed = await createBlueprintPackage(reviewedGallery()[0].plan, {
    ...details,
    name: "Changed bytes",
  });
  await expect(
    inspectBlueprintPackage(changed, claim, publisher.registry),
  ).rejects.toThrow(/digest mismatch/);
  const forged = JSON.parse(decodeBlueprintText(claim));
  forged.signature = "00".repeat(64);
  await expect(
    inspectBlueprintPackage(
      bytes,
      blueprintText(blueprintJson(forged)),
      publisher.registry,
    ),
  ).rejects.toThrow(/Invalid publisher signature/);
  const changedPayload = JSON.parse(decodeBlueprintText(claim));
  changedPayload.payload.gallery = null;
  await expect(
    inspectBlueprintPackage(
      bytes,
      blueprintText(blueprintJson(changedPayload)),
      publisher.registry,
    ),
  ).rejects.toThrow(/Invalid publisher signature/);
  for (const change of [
    (p: any) => {
      p.keyId = "unknown";
    },
    (p: any) => {
      p.compatibility = {
        package: 2,
        buildPlan: 2,
        configurationSchema: 2,
        branding: 1,
        engineApi: 1,
        template: 1,
      };
    },
    (p: any) => {
      p.gallery = { id: "basic-cleaning", revision: 999 };
    },
  ])
    await expect(
      inspectBlueprintPackage(
        bytes,
        await testAttestation(bytes, publisher, change),
        publisher.registry,
      ),
    ).rejects.toThrow();
  const other = testPublisher();
  await expect(
    inspectBlueprintPackage(
      bytes,
      await testAttestation(bytes, other),
      publisher.registry,
    ),
  ).rejects.toThrow(/Invalid publisher signature/);
});
it("has no enrolled real publishers and refuses unknown and retired keys without unsigned fallback", async () => {
  expect(reviewedPublishers().keys).toEqual([]);
  await expect(inspectBlueprintPackage(bytes, claim)).rejects.toThrow(
    /Unknown publisher key/,
  );
  const retired = structuredClone(publisher.registry);
  retired.keys[0].status = "retired";
  await expect(inspectBlueprintPackage(bytes, claim, retired)).rejects.toThrow(
    /Retired publisher key/,
  );
  for (const registry of [
    { ...publisher.registry, privateKey: "forbidden" },
    {
      ...publisher.registry,
      keys: [...publisher.registry.keys, ...publisher.registry.keys],
    },
    { ...publisher.registry, version: 2 },
  ])
    expect(() => validatePublisherRegistry(registry)).toThrow();
});
it("defines domain-separated exact canonical payload bytes and rejects noncanonical, duplicate or secret-bearing claims", () => {
  const attestation = parsePublisherAttestation(claim),
    raw = JSON.parse(decodeBlueprintText(claim));
  const protocolVector = {
    ...attestation.payload,
    keyId: "fixture",
    packageSha256: "0".repeat(64),
    gallery: null,
  };
  expect(new TextDecoder().decode(attestationMessage(protocolVector))).toBe(
    'lms-blueprint-publisher-signature-v1\n{"algorithm":"Ed25519","compatibility":{"buildPlan":1,"configurationSchema":1,"engineApi":1,"package":1,"template":1},"format":"lms-blueprint-publisher-attestation","gallery":null,"keyId":"fixture","packageSha256":"' +
      "0".repeat(64) +
      '","version":1}\n',
  );
  for (const text of [
    JSON.stringify(raw, null, 2),
    blueprintJson(raw).trimEnd(),
    "\ufeff" + blueprintJson(raw),
    blueprintJson(raw).replace('"payload":', '"payload":{},"payload":'),
    blueprintJson({ ...raw, credentials: "forbidden" }),
    blueprintJson({
      ...raw,
      payload: {
        ...raw.payload,
        publicKey: publisher.registry.keys[0].publicKey,
      },
    }),
    '{"__proto__":{},"payload":{}}',
  ])
    expect(() => parsePublisherAttestation(blueprintText(text))).toThrow();
  for (const bad of [
    new Uint8Array(),
    new Uint8Array(8193),
    new Uint8Array([0xff, 0xfe]),
  ])
    expect(() => parsePublisherAttestation(bad)).toThrow();
});
it("explains unsupported algorithms and attestation versions and rejects incomplete compatibility claims", () => {
  const raw = parsePublisherAttestation(claim);
  expect(() =>
    parsePublisherAttestation(
      blueprintText(
        blueprintJson({
          ...raw,
          payload: { ...raw.payload, algorithm: "RSA" },
        }),
      ),
    ),
  ).toThrow(/algorithm/);
  expect(() =>
    parsePublisherAttestation(
      blueprintText(
        blueprintJson({ ...raw, payload: { ...raw.payload, version: 2 } }),
      ),
    ),
  ).toThrow(/version/);
  expect(() =>
    parsePublisherAttestation(
      blueprintText(
        blueprintJson({
          ...raw,
          payload: { ...raw.payload, compatibility: { package: 1 } },
        }),
      ),
    ),
  ).toThrow(/Malformed/);
});
it("never converts an imported Gallery claim or author text into a trusted baseline or publisher", async () => {
  const plan = reviewedGallery()[0].plan;
  plan.configuration.name = "Customized starter";
  const zip = await createBlueprintPackage(plan, details),
    result = await inspectBlueprintPackage(
      zip,
      await testAttestation(zip, publisher),
      publisher.registry,
    );
  expect(result.publisher.status).toBe("verified");
  expect(result.gallery.status).toBe("hint-only");
  expect((await inspectBlueprintPackage(zip)).publisher.status).toBe(
    "unsigned",
  );
  const unavailable = await createBlueprintPackage(plan, {
    ...details,
    gallery: { id: "unknown", revision: 1 },
  });
  expect((await inspectBlueprintPackage(unavailable)).gallery.status).toBe(
    "hint-only",
  );
  await expect(
    inspectBlueprintPackage(
      unavailable,
      await testAttestation(unavailable, publisher),
      publisher.registry,
    ),
  ).rejects.toThrow(/edition claim/);
});
it("snapshots ZIP, claim and trust entries before asynchronous verification and fails closed without Ed25519 support", async () => {
  const zip = new Uint8Array(bytes),
    detached = new Uint8Array(claim),
    registry = structuredClone(publisher.registry),
    pending = inspectBlueprintPackage(zip, detached, registry);
  zip.fill(0);
  detached.fill(0);
  registry.keys[0].publicKey = "00".repeat(32);
  expect((await pending).publisher.status).toBe("verified");
  const spy = vi
    .spyOn(crypto.subtle, "importKey")
    .mockRejectedValueOnce(new Error("unsupported"));
  try {
    await expect(
      inspectBlueprintPackage(bytes, claim, publisher.registry),
    ).rejects.toThrow(/unavailable or failed/);
  } finally {
    spy.mockRestore();
  }
});
it("rejects unsafe modules, missing dependencies and unsupported configurations even when their exact ZIP bytes are correctly signed", async () => {
  for (const transform of [
    (p: any) =>
      p.configuration.modules.push({
        id: "executable-plugin",
        version: "1.0.0",
      }),
    (p: any) => {
      p.configuration.modules = p.configuration.modules.filter(
        (m: any) => m.id !== "customers",
      );
    },
    (p: any) => {
      p.version = 99;
    },
    (p: any) => {
      p.configuration.entities[0].fields[0].type = "sql";
    },
  ]) {
    const files = readBlueprintArchive(bytes),
      plan = JSON.parse(decodeBlueprintText(files["buildplan.json"])),
      manifest = JSON.parse(decodeBlueprintText(files["manifest.json"]));
    transform(plan);
    files["buildplan.json"] = blueprintText(blueprintJson(plan));
    for (const file of manifest.files) {
      file.bytes = files[file.path as keyof typeof files].length;
      file.sha256 = await sha256(files[file.path as keyof typeof files]);
    }
    files["manifest.json"] = blueprintText(blueprintJson(manifest));
    const zip = writeStoredZip(
        Object.entries(files).map(([path, bytes]) => ({ path, bytes })),
      ),
      payload = parsePublisherAttestation(claim).payload;
    payload.packageSha256 = await sha256(zip);
    await expect(
      inspectBlueprintPackage(
        zip,
        rawTestAttestation(payload, publisher),
        publisher.registry,
      ),
    ).rejects.toThrow();
  }
});
