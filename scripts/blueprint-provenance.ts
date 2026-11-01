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
  if (command !== "sign" || zip || detached || extra.length)
    throw new Error(
      "Use inspect ZIP [ATTESTATION] or sign with a bounded JSON request on stdin.",
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
      await signBlueprintFile(
        JSON.parse(Buffer.concat(parts).toString("utf8")),
      ),
    ),
  );
}
void main().catch(() => {
  console.error(
    "Blueprint operation refused. Check the strict package/attestation, reviewed active key, exact digest, explicit confirmation and private POSIX files. No key was enrolled and no configuration was published. Incomplete output must be discarded and verified again; never treat it as signed.",
  );
  process.exitCode = 1;
});
