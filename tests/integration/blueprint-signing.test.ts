import { afterEach, expect, it } from "vitest";
import {
  mkdtemp,
  chmod,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createBlueprintPackage, sha256 } from "../../src/core/blueprint";
import { inspectBlueprintPackage } from "../../src/core/blueprint-provenance";
import { reviewedGallery } from "../../src/core/gallery";
import {
  signingConfirmation,
  signBlueprint,
  signBlueprintFile,
} from "../../src/server/blueprint-signing";
import { testPublisher } from "../helpers/blueprint-provenance";
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function setup() {
  const directory = await mkdtemp(
    path.join(tmpdir(), "lms-blueprint-signing-"),
  );
  directories.push(directory);
  await chmod(directory, 0o700);
  const publisher = testPublisher(),
    bytes = await createBlueprintPackage(reviewedGallery()[0].plan, {
      name: "Offline fictional package",
      description: "Reviewed configuration, no data.",
    }),
    request = {
      packagePath: path.join(directory, "blueprint.zip"),
      privateKeyPath: path.join(directory, "publisher.pem"),
      outputPath: path.join(directory, "attestation.json"),
      keyId: publisher.registry.keys[0].id,
      expectedPackageSha256: await sha256(bytes),
      confirmation: signingConfirmation as typeof signingConfirmation,
    };
  await writeFile(request.packagePath, bytes);
  await writeFile(request.privateKeyPath, publisher.pem, { mode: 0o600 });
  return { directory, publisher, bytes, request };
}
it("signs with private POSIX custody, creates a new detached file and verifies the unchanged ZIP using only its public key", async () => {
  const { publisher, bytes, request } = await setup();
  expect(await signBlueprintFile(request, publisher.registry)).toMatchObject({
    status: "signed",
    packageSha256: await sha256(bytes),
  });
  const claim = new Uint8Array(await readFile(request.outputPath)),
    result = await inspectBlueprintPackage(bytes, claim, publisher.registry);
  expect(result.publisher.status).toBe("verified");
  expect(await readFile(request.packagePath)).toEqual(Buffer.from(bytes));
  const text = new TextDecoder().decode(claim);
  for (const secret of [
    publisher.pem,
    "PRIVATE KEY",
    publisher.registry.keys[0].publicKey,
    "session",
    "password",
    "credentials",
  ])
    expect(text).not.toContain(secret);
  await expect(
    signBlueprintFile(request, publisher.registry),
  ).rejects.toThrow();
  expect(new Uint8Array(await readFile(request.outputPath))).toEqual(claim);
});
it("refuses missing confirmation, stale digests, wrong/private-key types, unknown and retired keys before producing output", async () => {
  const { publisher, bytes, request } = await setup(),
    retired = structuredClone(publisher.registry);
  retired.keys[0].status = "retired";
  await expect(
    signBlueprintFile({ ...request, confirmation: "yes" }, publisher.registry),
  ).rejects.toThrow();
  await expect(
    signBlueprintFile(
      { ...request, privateKeyPath: path.resolve("README.md") },
      publisher.registry,
    ),
  ).rejects.toThrow(/outside the checkout/);
  await expect(
    signBlueprintFile(
      { ...request, expectedPackageSha256: "00".repeat(32) },
      publisher.registry,
    ),
  ).rejects.toThrow(/Signing refused/);
  await expect(
    signBlueprint(bytes, testPublisher().pem, request, publisher.registry),
  ).rejects.toThrow(/does not match/);
  await expect(
    signBlueprint(bytes, "invalid key", request, publisher.registry),
  ).rejects.toThrow();
  await expect(signBlueprintFile(request)).rejects.toThrow(/Signing refused/);
  await expect(signBlueprintFile(request, retired)).rejects.toThrow(
    /Signing refused/,
  );
  await expect(readFile(request.outputPath)).rejects.toThrow();
});
it("refuses exposed or symlinked key files, shared output custody and partial existing output without overwriting it", async () => {
  const { directory, publisher, request } = await setup();
  await chmod(request.privateKeyPath, 0o644);
  await expect(signBlueprintFile(request, publisher.registry)).rejects.toThrow(
    /private/,
  );
  await chmod(request.privateKeyPath, 0o600);
  const link = path.join(directory, "link.pem");
  await symlink(request.privateKeyPath, link);
  await expect(
    signBlueprintFile({ ...request, privateKeyPath: link }, publisher.registry),
  ).rejects.toThrow();
  await chmod(directory, 0o755);
  await expect(signBlueprintFile(request, publisher.registry)).rejects.toThrow(
    /private/,
  );
  await chmod(directory, 0o700);
  await writeFile(request.outputPath, "partial interrupted output", {
    mode: 0o600,
  });
  await expect(
    signBlueprintFile(request, publisher.registry),
  ).rejects.toThrow();
  expect(await readFile(request.outputPath, "utf8")).toBe(
    "partial interrupted output",
  );
});
it("runs the actual offline CLI inspection without accounts and safely refuses signing with the empty real registry", async () => {
  const { request } = await setup(),
    run = (args: string[], input?: string) =>
      spawnSync(
        process.execPath,
        ["--import=tsx", "scripts/blueprint-provenance.ts", ...args],
        { encoding: "utf8", input },
      );
  const inspection = run(["inspect", request.packagePath]);
  expect(inspection.status).toBe(0);
  expect(JSON.parse(inspection.stdout).publisher.status).toBe("unsigned");
  const signed = run(["sign"], JSON.stringify(request));
  expect(signed.status).toBe(1);
  expect(signed.stderr).toMatch(/refused/);
  expect(signed.stdout).toBe("");
});
