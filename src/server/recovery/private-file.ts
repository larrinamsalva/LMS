import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { EngineError } from "../../core/engine";
export async function readPrivateText(file: string, maxBytes: number) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (
      !process.getuid ||
      !stat.isFile() ||
      stat.uid !== process.getuid() ||
      (stat.mode & 0o077) !== 0 ||
      stat.size > maxBytes
    )
      throw new EngineError(
        "Use a private, process-owned regular file on a supported POSIX host.",
        403,
      );
    const text = await handle.readFile("utf8");
    if (Buffer.byteLength(text) > maxBytes)
      throw new EngineError("Private evidence exceeds its size limit.", 403);
    return text;
  } finally {
    await handle.close();
  }
}
