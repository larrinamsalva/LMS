/** Legacy blueprint ZIP profile: its exact bytes, paths, limits and errors are preserved. */
import {
  ArchiveError,
  readArchive,
  writeArchive,
  decodeBlueprintText as decodeText,
} from "./stored-archive";
export { blueprintText, crc32 } from "./stored-archive";
export const BLUEPRINT_PACKAGE_LIMIT = 98304;
export const blueprintPaths = [
  "manifest.json",
  "buildplan.json",
  "README.txt",
] as const;
export const blueprintFileLimits = {
  "manifest.json": 8192,
  "buildplan.json": 49152,
  "README.txt": 16384,
};
export class BlueprintError extends Error {}
export function decodeBlueprintText(value: Uint8Array): string {
  try {
    return decodeText(value);
  } catch {
    throw new BlueprintError("Blueprint files must contain valid UTF-8 text.");
  }
}
export function writeStoredZip(
  files: readonly { path: string; bytes: Uint8Array }[],
): Uint8Array<ArrayBuffer> {
  try {
    return writeArchive(files, BLUEPRINT_PACKAGE_LIMIT);
  } catch {
    throw new BlueprintError("Blueprint package exceeds 96 KiB.");
  }
}
export function readBlueprintArchive(
  input: Uint8Array,
): Record<(typeof blueprintPaths)[number], Uint8Array> {
  if (input.length > BLUEPRINT_PACKAGE_LIMIT)
    throw new BlueprintError(
      "Choose a blueprint package no larger than 96 KiB.",
    );
  try {
    return readArchive(input, {
      paths: blueprintPaths,
      limits: blueprintFileLimits,
      bytes: BLUEPRINT_PACKAGE_LIMIT,
    });
  } catch (e) {
    if (e instanceof ArchiveError && e.message.includes("UTF-8"))
      throw new BlueprintError(e.message);
    if (e instanceof ArchiveError && e.message.includes("checksum"))
      throw new BlueprintError(
        "Blueprint checksum failed. Download the package again; it may be damaged or changed.",
      );
    throw new BlueprintError(
      "Invalid blueprint archive. Use an unchanged LMS blueprint ZIP with exactly manifest.json, buildplan.json and README.txt; compressed, encrypted or extra files are unsupported.",
    );
  }
}
