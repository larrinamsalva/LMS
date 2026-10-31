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
    // Bound allocation/reads even if a previously checked regular file grows.
    const buffer = Buffer.alloc(maxBytes + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        total,
        buffer.length - total,
        total,
      );
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total > maxBytes)
      throw new EngineError("Private evidence exceeds its size limit.", 403);
    return buffer.subarray(0, total).toString("utf8");
  } finally {
    await handle.close();
  }
}
