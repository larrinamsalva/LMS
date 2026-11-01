import { expect, it } from "vitest";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { crc32 } from "../../src/core/blueprint-archive";
import { sanitizeLogo } from "../../src/server/logo-sanitizer";
import { logoFixture } from "../helpers/logo-fixtures";
it.each(["png","jpeg","webp"] as const)("decodes actual %s bytes into bounded static PNG without trusting MIME or names", async format => {
  const input = await logoFixture(format), before = Buffer.from(input), result = await sanitizeLogo(input), meta = await sharp(result.bytes).metadata();
  expect(meta.format).toBe("png"); expect(result.width).toBe(128); expect(result.height).toBe(64); expect(result.bytes.length).toBeLessThanOrEqual(262144); expect(input).toEqual(before); expect(meta.pages ?? 1).toBe(1);
});
it("removes EXIF, XMP, ICC, comments and private metadata while re-encoding pixels", async () => {
  const input = await sharp(await logoFixture()).withExif({ IFD0: { Copyright: "PRIVATE FICTIONAL LOGO METADATA" } }).withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">PRIVATE FICTIONAL LOGO METADATA</x:xmpmeta>').withIccProfile("srgb").jpeg().toBuffer();
  expect(input.toString()).toContain("PRIVATE FICTIONAL LOGO METADATA");
  const result = await sanitizeLogo(input), meta = await sharp(result.bytes).metadata();
  for (const key of ["exif","xmp","icc","iptc","comments"]) expect(meta).not.toHaveProperty(key);
  expect(result.bytes.toString()).not.toContain("PRIVATE FICTIONAL LOGO METADATA");
});
it("refuses SVG/HTML/scripts, GIF/TIFF, malformed, truncated, polyglot and CRC-corrupt containers", async () => {
  const png = await logoFixture(), jpg = await logoFixture("jpeg"), webp = await logoFixture("webp");
  const mpo = Buffer.concat([jpg.subarray(0,2),Buffer.from([255,226,0,6,77,80,70,0]),jpg.subarray(2)]);
  for (const bad of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>evil()</script></svg>'),Buffer.from("<html>logo</html>"),Buffer.from("GIF89a"),await sharp(png).tiff().toBuffer(),Buffer.from([1,2,3]),png.subarray(0,-1),jpg.subarray(0,-1),webp.subarray(0,-1),Buffer.concat([png,Buffer.from("<script>extra</script>")]),Buffer.concat([jpg,jpg]),mpo,Buffer.concat([webp,Buffer.from("extra")])]) await expect(sanitizeLogo(bad)).rejects.toThrow();
  const corrupt = Buffer.from(png); corrupt[45] ^= 1; await expect(sanitizeLogo(corrupt)).rejects.toThrow(/static PNG/);
});
it("refuses input-byte, dimension, decoded-pixel and sanitized-output overflows", async () => {
  await expect(sanitizeLogo(Buffer.alloc(1048577))).rejects.toMatchObject({status:413});
  await expect(sanitizeLogo(Buffer.alloc(0))).rejects.toMatchObject({status:413});
  for (const [width,height] of [[4097,1],[1025,1024]]) {
    const header=Buffer.from(await logoFixture());header.writeUInt32BE(width,16);header.writeUInt32BE(height,20);header.writeUInt32BE(crc32(header.subarray(12,29)),29);
    await expect(sanitizeLogo(header)).rejects.toThrow(/decoded pixels/);
  }
  const noise=await sharp(randomBytes(512*512*3),{raw:{width:512,height:512,channels:3}}).png().toBuffer();
  expect(noise.length).toBeLessThan(1048576);await expect(sanitizeLogo(noise)).rejects.toThrow(/256 KiB/);
  expect((await sanitizeLogo(await logoFixture("png",2048,128))).width).toBe(512);
});
it("rejects APNG and genuine animated WebP instead of keeping a first frame",async()=>{
  const png=await logoFixture(),chunk=Buffer.alloc(20);chunk.writeUInt32BE(8,0);chunk.write("acTL",4);chunk.writeUInt32BE(2,8);chunk.writeUInt32BE(crc32(chunk.subarray(4,16)),16);
  await expect(sanitizeLogo(Buffer.concat([png.subarray(0,33),chunk,png.subarray(33)]))).rejects.toThrow();
  const second=await sharp(png).negate().png().toBuffer(),animated=await sharp([png,second],{join:{animated:true}}).webp({delay:[100,100],loop:0}).toBuffer();
  expect((await sharp(animated).metadata()).pages).toBe(2);await expect(sanitizeLogo(animated)).rejects.toThrow();
});
