import { BRANDED_BUNDLE_LIMIT } from "../src/core/branded-bundle";
import {
  BUNDLE_ATTESTATION_LIMIT,
  inspectAuthenticatedBrandedBundle,
} from "../src/core/branded-bundle-provenance";
import { signBrandedBundleFile } from "../src/server/branded-bundle-signing";
import {
  ATTESTATION_LIMIT,
  inspectBlueprintPackage,
} from "../src/core/blueprint-provenance";
import {
  readBlueprintFile,
  signBlueprintFile,
} from "../src/server/blueprint-signing";
async function main() {
  const [command, zip, detached, ...extra] = process.argv.slice(2);
  if (command === "bundle-inspect" && zip && !extra.length) {
    const bytes = await readBlueprintFile(zip, BRANDED_BUNDLE_LIMIT);
    try {
      const result = await inspectAuthenticatedBrandedBundle(bytes, {
        attestation: detached
          ? await readBlueprintFile(detached, BUNDLE_ATTESTATION_LIMIT)
          : undefined,
      });
      try {
        console.log(
          JSON.stringify(
            {
              bundleSha256: result.bundleSha256,
              name: result.bundle.blueprint.manifest.blueprint.name,
              businessType: result.bundle.blueprint.plan.template,
              compatibility: result.bundle.manifest.compatibility,
              blueprintSha256: result.bundle.manifest.blueprint.sha256,
              logoCompanionSha256: result.bundle.manifest.logo?.sha256 ?? null,
              imageSha256: result.bundle.logo?.image.sha256 ?? null,
              imageIncluded: result.bundle.logo !== null,
              publisher: result.publisher,
              nestedPublisher: result.blueprintVerification.publisher,
              warning:
                "Integrity/signing-key possession is not freshness, image safety, transfer authority or publication approval.",
            },
            null,
            2,
          ),
        );
      } finally {
        result.bundle.blueprintBytes.fill(0);
        result.bundle.logoBytes?.fill(0);
      }
    } finally {
      bytes.fill(0);
    }
    return;
  }
  if (command === "inspect" && zip && !extra.length) {
    const result = await inspectBlueprintPackage(
      await readBlueprintFile(zip),
      detached
        ? await readBlueprintFile(detached, ATTESTATION_LIMIT)
        : undefined,
    );
    console.log(
      JSON.stringify(
        {
          packageSha256: result.packageSha256,
          name: result.blueprint.manifest.blueprint.name,
          businessType: result.blueprint.plan.template,
          compatibility: result.blueprint.manifest.compatibility,
          publisher: result.publisher,
          gallery: result.gallery,
          warning:
            "Inspection is not signing approval, latest-version evidence or production authorization.",
        },
        null,
        2,
      ),
    );
    return;
  }
  if (
    !["sign", "bundle-sign"].includes(command) ||
    zip ||
    detached ||
    extra.length
  )
    throw new Error(
      "Use inspect ZIP [ATTESTATION], bundle-inspect BUNDLE [ATTESTATION], or sign/bundle-sign with a bounded JSON request on stdin.",
    );
  const parts: Buffer[] = [];
  let count = 0;
  for await (const part of process.stdin) {
    const bytes = Buffer.from(part);
    count += bytes.length;
    if (count > 16384) throw new Error("Signing request exceeds limit.");
    parts.push(bytes);
  }
  console.log(
    JSON.stringify(
      await (
        command === "bundle-sign" ? signBrandedBundleFile : signBlueprintFile
      )(JSON.parse(Buffer.concat(parts).toString("utf8"))),
    ),
  );
}
void main().catch(() => {
  console.error(
    "Blueprint operation refused. Check the strict package/attestation, reviewed active key, exact digest, explicit confirmation and private POSIX files. No key was enrolled and no configuration was published. Incomplete output must be discarded and verified again; never treat it as signed.",
  );
  process.exitCode = 1;
});
