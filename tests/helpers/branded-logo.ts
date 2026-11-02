import { createBrandedBlueprintBundle } from "../../src/core/branded-bundle";
import { createBlueprintPackage } from "../../src/core/blueprint";
import { planForConfig, brandBuildPlan } from "../../src/core/buildplan";
import { defaultBranding } from "../../src/core/branding";
import { createLogoCompanion } from "../../src/core/logo-companion";
import { presets } from "../../src/presets";
import { sanitizeLogo } from "../../src/server/logo-sanitizer";
import { logoFixture } from "./logo-fixtures";
/** Exact unchanged portable codecs, exclusively synthetic pixels/configuration. */
export async function fictionalBrandedBundle(version = 2, image?: Uint8Array) {
  const clean = await sanitizeLogo(await logoFixture());
  try {
    const plan = planForConfig(presets.cleaning);
    const zip = await createBlueprintPackage(
      version === 1 ? plan : brandBuildPlan(plan, defaultBranding("cleaning")),
      {
        name: "Fictional destination-transfer example",
        description: "Synthetic configuration and image only.",
      },
    );
    const png = image ?? clean.bytes;
    const companion = await createLogoCompanion(png, {
      width: clean.width,
      height: clean.height,
      display: "rectangle",
    });
    return {
      zip,
      companion,
      bundle: await createBrandedBlueprintBundle(zip, companion),
      image: Buffer.from(png),
    };
  } finally {
    clean.bytes.fill(0);
  }
}
