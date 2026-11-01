/** Internal bounded STORE-only ZIP codec; exact path profiles supplied by reviewed callers. */
export class ArchiveError extends Error {}
const encoder = new TextEncoder();
export const blueprintText = (value: string) => encoder.encode(value);
export function decodeBlueprintText(value: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      value,
    );
  } catch {
    throw new ArchiveError("Blueprint files must contain valid UTF-8 text.");
  }
}
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
interface ArchiveFile {
  path: string;
  bytes: Uint8Array;
}
/** Writer for the same deliberately narrow ZIP profile consumed below. */
export function writeArchive(
  files: readonly ArchiveFile[],
  limit: number,
): Uint8Array<ArrayBuffer> {
  const size = files.reduce(
    (n, f) => n + 76 + 2 * blueprintText(f.path).length + f.bytes.length,
    22,
  );
  if (!Number.isSafeInteger(size) || size > limit)
    throw new ArchiveError("Archive exceeds its byte limit.");
  const bytes = new Uint8Array(size),
    view = new DataView(bytes.buffer);
  const u16 = (at: number, n: number) => view.setUint16(at, n, true),
    u32 = (at: number, n: number) => view.setUint32(at, n, true);
  let cursor = 0;
  const offsets: number[] = [];
  for (const file of files) {
    offsets.push(cursor);
    const name = blueprintText(file.path),
      crc = crc32(file.bytes);
    u32(cursor, 0x04034b50);
    u16(cursor + 4, 20);
    u16(cursor + 12, 33);
    u32(cursor + 14, crc);
    u32(cursor + 18, file.bytes.length);
    u32(cursor + 22, file.bytes.length);
    u16(cursor + 26, name.length);
    bytes.set(name, cursor + 30);
    bytes.set(file.bytes, cursor + 30 + name.length);
    cursor += 30 + name.length + file.bytes.length;
  }
  const centralStart = cursor;
  files.forEach((file, i) => {
    const name = blueprintText(file.path);
    u32(cursor, 0x02014b50);
    u16(cursor + 4, 20);
    u16(cursor + 6, 20);
    u16(cursor + 14, 33);
    u32(cursor + 16, crc32(file.bytes));
    u32(cursor + 20, file.bytes.length);
    u32(cursor + 24, file.bytes.length);
    u16(cursor + 28, name.length);
    u32(cursor + 42, offsets[i]);
    bytes.set(name, cursor + 46);
    cursor += 46 + name.length;
  });
  u32(cursor, 0x06054b50);
  u16(cursor + 8, files.length);
  u16(cursor + 10, files.length);
  u32(cursor + 12, cursor - centralStart);
  u32(cursor + 16, centralStart);
  return bytes;
}
export function readArchive<P extends string>(
  input: Uint8Array,
  profile: { paths: readonly P[]; limits: Record<P, number>; bytes: number },
): Record<P, Uint8Array> {
  const fail = () => {
    throw new ArchiveError("Invalid archive profile.");
  };
  if (input.length > profile.bytes)
    throw new ArchiveError("Archive exceeds its byte limit.");
  try {
    if (input.length < 22) return fail();
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength),
      u16 = (n: number) => view.getUint16(n, true),
      u32 = (n: number) => view.getUint32(n, true),
      end = input.length - 22,
      start = u32(end + 16),
      centralSize = u32(end + 12);
    if (
      u32(end) !== 0x06054b50 ||
      u16(end + 4) ||
      u16(end + 6) ||
      u16(end + 8) !== profile.paths.length ||
      u16(end + 10) !== profile.paths.length ||
      u16(end + 20) ||
      start + centralSize !== end
    )
      return fail();
    const result = Object.create(null) as Record<P, Uint8Array>;
    let cursor = start,
      local = 0;
    for (let i = 0; i < profile.paths.length; i++) {
      if (cursor + 46 > end || u32(cursor) !== 0x02014b50) return fail();
      const size = u32(cursor + 24),
        nameLength = u16(cursor + 28),
        name = decodeBlueprintText(
          input.subarray(cursor + 46, cursor + 46 + nameLength),
        );
      if (!profile.paths.includes(name as P) || Object.hasOwn(result, name))
        return fail();
      const path = name as P;
      if (
        size > profile.limits[path] ||
        !size ||
        cursor + 46 + nameLength > end ||
        u16(cursor + 4) !== 20 ||
        u16(cursor + 6) !== 20 ||
        u16(cursor + 8) ||
        u16(cursor + 10) ||
        u16(cursor + 12) ||
        u16(cursor + 14) !== 33 ||
        u32(cursor + 20) !== size ||
        u16(cursor + 30) ||
        u16(cursor + 32) ||
        u16(cursor + 34) ||
        u16(cursor + 36) ||
        u32(cursor + 38) ||
        u32(cursor + 42) !== local
      )
        return fail();
      if (
        local + 30 + nameLength + size > start ||
        u32(local) !== 0x04034b50 ||
        u16(local + 4) !== 20 ||
        u16(local + 6) ||
        u16(local + 8) ||
        u16(local + 10) ||
        u16(local + 12) !== 33 ||
        u32(local + 14) !== u32(cursor + 16) ||
        u32(local + 18) !== size ||
        u32(local + 22) !== size ||
        u16(local + 26) !== nameLength ||
        u16(local + 28) ||
        decodeBlueprintText(
          input.subarray(local + 30, local + 30 + nameLength),
        ) !== name
      )
        return fail();
      const data = input.slice(
        local + 30 + nameLength,
        local + 30 + nameLength + size,
      );
      if (crc32(data) !== u32(cursor + 16))
        throw new ArchiveError("Archive checksum failed.");
      result[path] = data;
      local += 30 + nameLength + size;
      cursor += 46 + nameLength;
    }
    if (
      cursor !== end ||
      local !== start ||
      profile.paths.some((p) => !Object.hasOwn(result, p))
    )
      return fail();
    return result;
  } catch (e) {
    if (e instanceof ArchiveError) throw e;
    return fail();
  }
}
