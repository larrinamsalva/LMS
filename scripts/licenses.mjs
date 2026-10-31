import { readFile, writeFile } from "node:fs/promises";
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const recognized = new Set([
  "MIT",
  "ISC",
  "Apache-2.0",
  "MPL-2.0",
  "LGPL-3.0-or-later",
  "Apache-2.0 AND LGPL-3.0-or-later AND MIT",
  "Apache-2.0 AND LGPL-3.0-or-later",
  "CC-BY-4.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "BlueOak-1.0.0",
  "(MIT AND Zlib)",
  "0BSD",
  "Python-2.0",
]);
for (const [name, version] of Object.entries({
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
})) {
  if (!/^\d+\.\d+\.\d+/.test(version) || /^[~^*]/.test(version))
    throw new Error(`Unpinned dependency ${name}`);
}
const packages = Object.entries(lock.packages)
  .filter(([path]) => path)
  .map(([path, pkg]) => {
    if (!recognized.has(pkg.license))
      throw new Error(
        `Review missing/unrecognized license: ${path}: ${pkg.license}`,
      );
    return {
      path,
      name: path.split("node_modules/").at(-1),
      version: pkg.version,
      license: pkg.license,
      development: !!pkg.dev,
      optional: !!pkg.optional,
      integrity: pkg.integrity ?? null,
      source: pkg.resolved ?? null,
    };
  })
  .sort((a, b) => a.path.localeCompare(b.path, "en"));
const output =
  JSON.stringify(
    {
      formatVersion: 1,
      source: "package-lock.json",
      notice:
        "Package metadata inventory, not legal certification. Preserve each dependency LICENSE/NOTICE. Includes optional platform binaries.",
      packages,
    },
    null,
    2,
  ) + "\n";
const target = "docs/dependencies.json";
if (process.argv.includes("--check")) {
  if ((await readFile(target, "utf8")) !== output)
    throw new Error("Stale dependency inventory. Run npm run licenses.");
} else await writeFile(target, output);
console.log(`Verified ${packages.length} dependency license declarations.`);
