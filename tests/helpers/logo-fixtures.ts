import sharp from "sharp";
/** Synthetic fictional raster pixels only; no remote images, fonts or private logos. */
export async function logoFixture(format: "png" | "jpeg" | "webp" = "png", width = 128, height = 64) {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3, mark = (x > width * .2 && x < width * .32 && y > height * .2 && y < height * .8) || (x > width * .2 && x < width * .8 && y > height * .65 && y < height * .8);
    raw[i] = mark ? 225 : 30; raw[i + 1] = mark ? 245 : 72; raw[i + 2] = mark ? 239 : 110;
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).toFormat(format).toBuffer();
}
