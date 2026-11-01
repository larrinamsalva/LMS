import sharp from "sharp";
/** Synthetic fictional raster only; no external image, font or private logo. */
export async function logoFixture(
  format: "png" | "jpeg" | "webp" = "png",
  width = 128,
  height = 64,
) {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3,
        mark =
          (x > width * 0.2 &&
            x < width * 0.32 &&
            y > height * 0.2 &&
            y < height * 0.8) ||
          (x > width * 0.2 &&
            x < width * 0.8 &&
            y > height * 0.65 &&
            y < height * 0.8);
      raw[i] = mark ? 225 : 30;
      raw[i + 1] = mark ? 245 : 72;
      raw[i + 2] = mark ? 239 : 110;
    }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .toFormat(format)
    .toBuffer();
}
