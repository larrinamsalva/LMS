// Adapted from ForgeOS-Property-Manager src/lib/request-body.ts at 5831e20023c8f2f1e7269bbfb63b6ba0f21ee3b8.
// Copyright (c) 2026 Larrina Salva. MIT; see third-party/ForgeOS-LICENSE.txt.
export class BodyError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
/** Bound actual UTF-8 bytes even when Content-Length is absent or forged. */
export async function readJson(
  request: Request,
  limit = 131072,
): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new BodyError("Use a JSON request.", 415);
  const bytes = await readBytes(request, limit);
  let raw: string;
  try { raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new SyntaxError("Invalid UTF-8"); }
  return JSON.parse(raw);
}
/** Shared bounded binary reader: never buffers unbounded multipart input. */
export async function readBytes(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const claimed = Number(request.headers.get("content-length"));
  if (Number.isFinite(claimed) && claimed > limit)
    throw new BodyError("Request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Missing JSON body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new BodyError("Request is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
