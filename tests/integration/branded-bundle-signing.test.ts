import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtemp,
  chmod,
  readFile,
  rm,
  symlink,
  link,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { sha256 } from "../../src/core/blueprint";
import { inspectAuthenticatedBrandedBundle } from "../../src/core/branded-bundle-provenance";
import {
  bundleSigningConfirmation,
  signBrandedBundle,
  signBrandedBundleFile,
} from "../../src/server/branded-bundle-signing";
import * as files from "../../src/server/publication/files";
import { testPublisher } from "../helpers/blueprint-provenance";
import { fictionalBrandedBundle } from "../helpers/branded-logo";
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of directories.splice(0))
    await rm(d, { recursive: true, force: true });
});
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), "lms-bundle-signing-"));
  directories.push(directory);
  await chmod(directory, 0o700);
  const publisher = testPublisher(),
    sample = await fictionalBrandedBundle(),
    request = {
      bundlePath: path.join(directory, "bundle.zip"),
      privateKeyPath: path.join(directory, "publisher.pem"),
      outputPath: path.join(directory, "attestation.json"),
      keyId: publisher.registry.keys[0].id,
      expectedBundleSha256: await sha256(sample.bundle),
      confirmation:
        bundleSigningConfirmation as typeof bundleSigningConfirmation,
    };
  await writeFile(request.bundlePath, sample.bundle);
  await writeFile(request.privateKeyPath, publisher.pem, { mode: 0o600 });
  return { directory, publisher, sample, request };
}
it("signs under explicit ephemeral enrolled test trust, reads/verifies the persisted output and preserves exact image-bearing bundle bytes", async () => {
  const { publisher, sample, request } = await setup();
  expect(await signBrandedBundleFile(request, publisher.registry)).toEqual({
    status: "signed",
    bundleSha256: await sha256(sample.bundle),
    keyId: request.keyId,
    attestationVersion: 1,
  });
  const claim = new Uint8Array(await readFile(request.outputPath)),
    result = await inspectAuthenticatedBrandedBundle(
      sample.bundle,
      { attestation: claim },
      publisher.registry,
    );
  expect(result.publisher.status).toBe("verified");
  expect(result.bundle.blueprintBytes).toEqual(sample.zip);
  expect(result.bundle.logoBytes).toEqual(sample.companion);
  expect(await readFile(request.bundlePath)).toEqual(
    Buffer.from(sample.bundle),
  );
  for (const secret of [
    publisher.pem,
    "PRIVATE KEY",
    publisher.registry.keys[0].publicKey,
    "sessionId",
    "organizationId",
    "assetId",
    "password",
  ])
    expect(new TextDecoder().decode(claim)).not.toContain(secret);
  await expect(
    signBrandedBundleFile(request, publisher.registry),
  ).rejects.toThrow();
  expect(new Uint8Array(await readFile(request.outputPath))).toEqual(claim);
});
it("refuses wrong confirmation/digest, unreviewed/retired keys, mismatched material and other key types before any output", async () => {
  const { publisher, sample, request } = await setup(),
    retired = structuredClone(publisher.registry);
  retired.keys[0].status = "retired";
  const approval = {
    keyId: request.keyId,
    expectedBundleSha256: request.expectedBundleSha256,
    confirmation: request.confirmation as typeof bundleSigningConfirmation,
  };
  await expect(
    signBrandedBundleFile(
      { ...request, confirmation: "yes" },
      publisher.registry,
    ),
  ).rejects.toThrow();
  await expect(
    signBrandedBundleFile(
      { ...request, expectedBundleSha256: "00".repeat(32) },
      publisher.registry,
    ),
  ).rejects.toThrow(/exact complete-bundle digest/);
  await expect(signBrandedBundleFile(request)).rejects.toThrow(
    /Unknown publisher key/,
  );
  await expect(signBrandedBundleFile(request, retired)).rejects.toThrow(
    /Retired publisher key/,
  );
  await expect(
    signBrandedBundle(
      sample.bundle,
      testPublisher().pem,
      approval,
      publisher.registry,
    ),
  ).rejects.toThrow(/does not match/);
  const wrong = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
  await expect(
    signBrandedBundle(sample.bundle, wrong, approval, publisher.registry),
  ).rejects.toThrow(/Ed25519 private key/);
  await expect(readFile(request.outputPath)).rejects.toThrow();
});
it("refuses unsafe key custody, symlinks, hardlinks and existing partial output without repair or overwrite", async () => {
  const { directory, publisher, request } = await setup();
  await chmod(request.privateKeyPath, 0o644);
  await expect(
    signBrandedBundleFile(request, publisher.registry),
  ).rejects.toThrow(/private/);
  await chmod(request.privateKeyPath, 0o600);
  const symbolic = path.join(directory, "linked.pem");
  await symlink(request.privateKeyPath, symbolic);
  await expect(
    signBrandedBundleFile(
      { ...request, privateKeyPath: symbolic },
      publisher.registry,
    ),
  ).rejects.toThrow();
  const hard = path.join(directory, "hard.pem");
  await link(request.privateKeyPath, hard);
  await expect(
    signBrandedBundleFile(request, publisher.registry),
  ).rejects.toThrow(/private/);
  await rm(hard);
  await chmod(directory, 0o755);
  await expect(
    signBrandedBundleFile(request, publisher.registry),
  ).rejects.toThrow(/private/);
  await chmod(directory, 0o700);
  await expect(
    signBrandedBundleFile(
      { ...request, privateKeyPath: path.resolve("README.md") },
      publisher.registry,
    ),
  ).rejects.toThrow(/outside the checkout/);
  await writeFile(request.outputPath, "partial output", { mode: 0o600 });
  await expect(
    signBrandedBundleFile(request, publisher.registry),
  ).rejects.toThrow();
  expect(await readFile(request.outputPath, "utf8")).toBe("partial output");
});
it("never reports success after a partial write or sync failure and never repairs the retained ambiguous output", async () => {
  const { publisher, request } = await setup();
  const write = vi
    .spyOn(files, "newFile")
    .mockImplementationOnce(async (file, text) => {
      await writeFile(file, text.slice(0, 30), { mode: 0o600, flag: "wx" });
      throw new Error("synthetic interrupted write");
    });
  await expect(
    signBrandedBundleFile(request, publisher.registry),
  ).rejects.toThrow("synthetic interrupted write");
  write.mockRestore();
  const partial = await readFile(request.outputPath);
  await expect(
    signBrandedBundleFile(request, publisher.registry),
  ).rejects.toThrow();
  expect(await readFile(request.outputPath)).toEqual(partial);
  const next = { ...request, outputPath: request.outputPath + ".new" };
  const sync = vi
    .spyOn(files, "syncDirectory")
    .mockRejectedValueOnce(new Error("synthetic sync failure"));
  await expect(signBrandedBundleFile(next, publisher.registry)).rejects.toThrow(
    "synthetic sync failure",
  );
  sync.mockRestore();
  const complete = await readFile(next.outputPath);
  await expect(
    signBrandedBundleFile(next, publisher.registry),
  ).rejects.toThrow();
  expect(await readFile(next.outputPath)).toEqual(complete);
});
it("serializes competing output creation with exclusive files and snapshots approval/trust during async signing", async () => {
  const { publisher, sample, request } = await setup(),
    outcomes = await Promise.allSettled([
      signBrandedBundleFile(request, publisher.registry),
      signBrandedBundleFile(request, publisher.registry),
    ]);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1);
  const bytes = new Uint8Array(sample.bundle),
    registry = structuredClone(publisher.registry),
    approval = {
      keyId: request.keyId,
      expectedBundleSha256: request.expectedBundleSha256,
      confirmation: request.confirmation as typeof bundleSigningConfirmation,
    },
    pending = signBrandedBundle(bytes, publisher.pem, approval, registry);
  bytes.fill(0);
  registry.keys[0].status = "retired";
  approval.expectedBundleSha256 = "00".repeat(32);
  const signed = await pending;
  expect(
    (
      await inspectAuthenticatedBrandedBundle(
        sample.bundle,
        { attestation: new TextEncoder().encode(signed) },
        publisher.registry,
      )
    ).publisher.status,
  ).toBe("verified");
});
it("runs actual offline bundle CLI inspection and refuses signing/claimed verification against the empty real registry", async () => {
  const { publisher, sample, request } = await setup(),
    run = (args: string[], input?: string) =>
      spawnSync(
        process.execPath,
        ["--import=tsx", "scripts/blueprint-provenance.ts", ...args],
        { encoding: "utf8", input },
      );
  const read = run(["bundle-inspect", request.bundlePath]);
  expect(read.status).toBe(0);
  expect(JSON.parse(read.stdout)).toMatchObject({
    publisher: { status: "unsigned" },
    imageIncluded: true,
  });
  expect(run(["bundle-sign"], JSON.stringify(request)).status).toBe(1);
  await signBrandedBundleFile(request, publisher.registry);
  const failed = run([
    "bundle-inspect",
    request.bundlePath,
    request.outputPath,
  ]);
  expect(failed.status).toBe(1);
  expect(failed.stdout).toBe("");
  expect(failed.stderr).toContain("refused");
  for (const secret of [publisher.pem, sample.image.toString("base64")])
    expect(read.stdout + failed.stdout + failed.stderr).not.toContain(secret);
});
