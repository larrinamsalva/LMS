import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { EngineError } from "../../core/engine";
export const recordLimit = 20 * 1024 * 1024,
  storeLimit = 64 * 1024 * 1024;
export async function privateDirectory(directory: string) {
  if (
    process.platform !== "linux" ||
    !path.isAbsolute(directory) ||
    (await realpath(directory)) !== path.resolve(directory)
  )
    throw new EngineError(
      "Use an absolute private Linux directory without symlinks.",
      403,
    );
  const s = await stat(directory);
  if (!s.isDirectory() || s.uid !== process.getuid?.() || s.mode & 0o077)
    throw new EngineError("Use a process-owned private directory (0700).", 403);
}
export async function syncDirectory(directory: string) {
  const h = await open(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await h.sync();
  } finally {
    await h.close();
  }
}
export async function newFile(file: string, text: string) {
  const h = await open(
    file,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await h.writeFile(text);
    await h.sync();
  } finally {
    await h.close();
  }
}
export async function completeFile(file: string, text: string) {
  // Only an exact byte prefix of the independently approved pending record may be completed.
  const h = await open(
    file,
    constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const s = await h.stat(),
      bytes = Buffer.from(text);
    if (
      !s.isFile() ||
      s.nlink !== 1 ||
      s.uid !== process.getuid?.() ||
      s.mode & 0o077 ||
      s.size > bytes.length
    )
      throw new EngineError("Unsafe or conflicting publication file.", 409);
    const prefix = Buffer.alloc(s.size);
    let offset = 0;
    while (offset < prefix.length) {
      const r = await h.read(prefix, offset, prefix.length - offset, offset);
      if (!r.bytesRead) throw new EngineError("Publication file changed.", 409);
      offset += r.bytesRead;
    }
    if (!prefix.equals(bytes.subarray(0, prefix.length)))
      throw new EngineError(
        "Conflicting publication file; refusing repair.",
        409,
      );
    while (offset < bytes.length) {
      const r = await h.write(bytes, offset, bytes.length - offset, offset);
      if (!r.bytesWritten) throw new Error("Incomplete publication write.");
      offset += r.bytesWritten;
    }
    await h.sync();
  } finally {
    await h.close();
  }
}
export async function withPublicationLock<T>(
  directory: string,
  fn: () => Promise<T>,
) {
  await privateDirectory(directory);
  const h = await open(
    path.join(directory, ".lock"),
    constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const s = await h.stat();
    if (
      !s.isFile() ||
      s.nlink !== 1 ||
      s.uid !== process.getuid?.() ||
      s.mode & 0o077
    )
      throw new EngineError("Unsafe publication lock.", 403);
    // Linux flock belongs to the shared open file description, retained by this handle.
    await new Promise<void>((resolve, reject) => {
      const child = spawn("flock", ["--exclusive", "--nonblock", "3"], {
        stdio: ["ignore", "ignore", "ignore", h.fd],
      });
      child.once("error", () =>
        reject(
          new Error("Install util-linux flock on a supported Linux host."),
        ),
      );
      child.once("close", (code) =>
        code === 0
          ? resolve()
          : reject(
              new EngineError(
                "Publication custody is busy or locking unavailable.",
                423,
              ),
            ),
      );
    });
    return await fn();
  } finally {
    await h.close();
  }
}
