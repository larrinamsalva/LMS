import sharp from "sharp";
import { logoLimits } from "../core/private-logo";
import { crc32 } from "../core/blueprint-archive";
import { EngineError } from "../core/engine";
// Do not retain private decoded pixels in cross-request native operation caches.
sharp.cache(false);
const invalid = () => new EngineError("Use a complete, static PNG, JPEG or WebP logo within the image limits. SVG, animation, malformed images and unsupported content are refused.", 422);
function dimensions(width: number, height: number) {
  if (!width || !height || width > logoLimits.dimension || height > logoLimits.dimension || width * height > logoLimits.pixels) throw new EngineError("Logo exceeds 4096 pixels per side or 1,048,576 decoded pixels. Resize it before uploading.", 422);
}
/** Exact bounded container endpoints and frame checks precede native decoding. */
function format(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    let offset = 8, image = false, header = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset), end = offset + length + 12;
      if (end > bytes.length) throw invalid();
      const kind = bytes.toString("ascii", offset + 4, offset + 8);
      if (!/^[A-Za-z]{4}$/.test(kind) || ["acTL","fcTL","fdAT"].includes(kind) || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw invalid();
      if (!header) {
        if (kind !== "IHDR" || length !== 13) throw invalid();
        dimensions(bytes.readUInt32BE(offset + 8), bytes.readUInt32BE(offset + 12)); header = true;
      } else if (kind === "IHDR") throw invalid();
      if (kind === "IDAT") image = true;
      if (kind === "IEND") { if (length || end !== bytes.length || !image) throw invalid(); return "png"; }
      if (["zTXt","iTXt","iCCP"].includes(kind)) throw new EngineError("Compressed PNG metadata is unsupported in this phase. Export a static PNG without metadata, or use JPEG/WebP.", 422);
      if (!["IHDR","IDAT","PLTE","tRNS","IEND"].includes(kind) && length > 65536) throw invalid();
      offset = end;
    }
    throw invalid();
  }
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    if (bytes.length < 20 || bytes.readUInt32LE(4) + 8 !== bytes.length) throw invalid();
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const kind = bytes.toString("ascii", offset, offset + 4), length = bytes.readUInt32LE(offset + 4), end = offset + 8 + length + (length % 2);
      if (end > bytes.length || ["ANIM","ANMF"].includes(kind) || (kind === "VP8X" && (length !== 10 || (bytes[offset + 8] & 2)))) throw invalid();
      if (["EXIF","XMP ","ICCP"].includes(kind) && length > 65536) throw invalid();
      offset = end;
    }
    if (offset !== bytes.length) throw invalid();
    return "webp";
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2, metadata = 0;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 255) throw invalid();
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217) { if (offset !== bytes.length) throw invalid(); return "jpeg"; }
      if (marker === 216 || marker === 0 || marker === undefined || offset + 2 > bytes.length) throw invalid();
      const length = bytes.readUInt16BE(offset), end = offset + length;
      if (length < 2 || end > bytes.length) throw invalid();
      if ((marker >= 224 && marker <= 239) || marker === 254) metadata += length;
      if (metadata > 65536 || (marker === 226 && bytes.toString("ascii", offset + 2, offset + 6) === "MPF\0")) throw invalid();
      offset = end;
      if (marker === 218) {
        while (offset < bytes.length) {
          if (bytes[offset] !== 255) { offset++; continue; }
          const start = offset;
          while (bytes[offset] === 255) offset++;
          if (bytes[offset] === 0 || (bytes[offset] >= 208 && bytes[offset] <= 215)) { offset++; continue; }
          offset = start; break;
        }
      }
    }
  }
  throw invalid();
}
export async function sanitizeLogo(input: Uint8Array) {
  if (!input.length || input.length > logoLimits.inputBytes) throw new EngineError("Choose a nonempty logo no larger than 1 MiB.", 413);
  const bytes = Buffer.from(input);
  let image: ReturnType<typeof sharp> | undefined;
  try {
    const expected = format(bytes);
    image = sharp(bytes, { limitInputPixels: logoLimits.pixels, failOn: "warning", unlimited: false, sequentialRead: true }).timeout({ seconds: 3 });
    const metadata = await image.metadata();
    if (metadata.format !== expected || (metadata.pages ?? 1) !== 1 || metadata.delay || metadata.loop !== undefined) throw invalid();
    dimensions(metadata.width, metadata.height);
    const { data, info } = await image.autoOrient().resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true }).toColourspace("srgb").png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer({ resolveWithObject: true });
    if (data.length > logoLimits.outputBytes || info.width > 512 || info.height > 512) throw new EngineError("Sanitized logo exceeds 256 KiB. Use a simpler or smaller image.", 422);
    return { bytes: data, width: info.width, height: info.height };
  } catch (error) {
    if (error instanceof EngineError) throw error;
    throw invalid(); // Never log or return native decoder details/metadata.
  } finally { image?.destroy(); bytes.fill(0); }
}
