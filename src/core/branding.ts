import { z } from "zod";
/** Version-1 palette IDs/tokens are immutable. Introduce a new ID for future color revisions. */
export const paletteIds = [
  "forest-v1",
  "ocean-v1",
  "plum-v1",
  "copper-v1",
] as const;
export const logoMarks = {
  monogram: "Text monogram",
  home: "Home & property",
  sparkle: "Clean sparkle",
  leaf: "Leaf & care",
  tiles: "Service tiles",
} as const;
export const brandText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .regex(
      /^[^<>\u0000-\u001f\u007f]*$/u,
      "Use plain single-line text without markup.",
    );
export const brandingSchema = z
  .object({
    version: z.literal(1),
    palette: z.enum(paletteIds),
    mark: z.enum(
      Object.keys(logoMarks) as [
        keyof typeof logoMarks,
        ...(keyof typeof logoMarks)[],
      ],
    ),
    monogram: z
      .string()
      .regex(/^[A-Z0-9]{1,4}$/, "Use 1–4 uppercase letters or numbers."),
    tagline: brandText(120).optional(),
    appearance: z.enum(["light", "dark"]),
  })
  .strict();
export type Branding = z.infer<typeof brandingSchema>;
export type Appearance = Branding["appearance"];
export interface BrandTokens {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  muted: string;
  border: string;
  primary: string;
  onPrimary: string;
  secondary: string;
  onSecondary: string;
  accent: string;
  onAccent: string;
}
export const palettes: Record<
  (typeof paletteIds)[number],
  { name: string; purpose: string; light: BrandTokens; dark: BrandTokens }
> = {
  "forest-v1": {
    name: "Forest & linen",
    purpose: "Property, outdoor care and established local services",
    light: {
      bg: "#f4f5f0",
      surface: "#ffffff",
      surfaceAlt: "#eff2ed",
      text: "#1c312c",
      muted: "#52665f",
      border: "#788a80",
      primary: "#16604b",
      onPrimary: "#ffffff",
      secondary: "#e1eee5",
      onSecondary: "#1c312c",
      accent: "#8a410f",
      onAccent: "#ffffff",
    },
    dark: {
      bg: "#111e1a",
      surface: "#1b2b25",
      surfaceAlt: "#24372e",
      text: "#ecf2e9",
      muted: "#b3c6b8",
      border: "#8caa98",
      primary: "#9cdbb7",
      onPrimary: "#102d20",
      secondary: "#24372e",
      onSecondary: "#ecf2e9",
      accent: "#f6c386",
      onAccent: "#2e2012",
    },
  },
  "ocean-v1": {
    name: "Ocean & cloud",
    purpose: "Cleaning teams and general service businesses",
    light: {
      bg: "#f3f6f8",
      surface: "#ffffff",
      surfaceAlt: "#e8f0f5",
      text: "#172e3b",
      muted: "#445e70",
      border: "#617b8f",
      primary: "#17577d",
      onPrimary: "#ffffff",
      secondary: "#dceaf3",
      onSecondary: "#172e3b",
      accent: "#8a4308",
      onAccent: "#ffffff",
    },
    dark: {
      bg: "#101e2a",
      surface: "#192c3b",
      surfaceAlt: "#233b50",
      text: "#eef5fb",
      muted: "#b7cadb",
      border: "#859fb4",
      primary: "#9bcff3",
      onPrimary: "#102d42",
      secondary: "#233b50",
      onSecondary: "#eef5fb",
      accent: "#ffd08f",
      onAccent: "#3c2806",
    },
  },
  "plum-v1": {
    name: "Plum & pearl",
    purpose: "Independent professionals and custom businesses",
    light: {
      bg: "#f7f3f7",
      surface: "#ffffff",
      surfaceAlt: "#f0e8f2",
      text: "#33283d",
      muted: "#68576f",
      border: "#8a7690",
      primary: "#633b7c",
      onPrimary: "#ffffff",
      secondary: "#eee2f3",
      onSecondary: "#33283d",
      accent: "#7d4826",
      onAccent: "#ffffff",
    },
    dark: {
      bg: "#201828",
      surface: "#2b2134",
      surfaceAlt: "#3a2c46",
      text: "#f5eff9",
      muted: "#d0bedb",
      border: "#a98cb9",
      primary: "#d8b4ee",
      onPrimary: "#35223e",
      secondary: "#3a2c46",
      onSecondary: "#f5eff9",
      accent: "#ffcf99",
      onAccent: "#3c2817",
    },
  },
  "copper-v1": {
    name: "Copper & sage",
    purpose: "Maintenance, repair and practical trades",
    light: {
      bg: "#f8f4ee",
      surface: "#ffffff",
      surfaceAlt: "#f1e8da",
      text: "#3b2c22",
      muted: "#6b5949",
      border: "#917c64",
      primary: "#83421d",
      onPrimary: "#ffffff",
      secondary: "#efe1cd",
      onSecondary: "#3b2c22",
      accent: "#355e55",
      onAccent: "#ffffff",
    },
    dark: {
      bg: "#241c15",
      surface: "#30271f",
      surfaceAlt: "#403326",
      text: "#fcf2e7",
      muted: "#d7c3ab",
      border: "#b49a7d",
      primary: "#edba88",
      onPrimary: "#362411",
      secondary: "#403326",
      onSecondary: "#fcf2e7",
      accent: "#a6d7c8",
      onAccent: "#183b31",
    },
  },
};
export function defaultBranding(
  industry: "property" | "cleaning" | "custom",
): Branding {
  return {
    version: 1,
    palette:
      industry === "cleaning"
        ? "ocean-v1"
        : industry === "custom"
          ? "plum-v1"
          : "forest-v1",
    mark: "monogram",
    monogram: "LMS",
    appearance: "light",
  };
}
/** CSS values come exclusively from reviewed constants, never imported CSS or user text. */
export function brandingVariables(
  input: Branding,
  mode: Appearance,
): Record<`--${string}`, string> {
  const brand = brandingSchema.parse(input),
    p = palettes[brand.palette][mode];
  return {
    "--bg": p.bg,
    "--surface": p.surface,
    "--surface-alt": p.surfaceAlt,
    "--text": p.text,
    "--muted": p.muted,
    "--border": p.border,
    "--accent": p.primary,
    "--on-accent": p.onPrimary,
    "--focus": p.accent,
    "--banner": p.secondary,
    "--banner-text": p.onSecondary,
    "--brand-secondary": p.secondary,
    "--on-brand-secondary": p.onSecondary,
    "--brand-highlight": p.accent,
    "--on-brand-highlight": p.onAccent,
  };
}
/** WCAG sRGB relative luminance; compare unrounded ratios to the acceptance threshold. */
export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    if (!/^#[0-9a-f]{6}$/i.test(hex))
      throw new Error("Use a reviewed six-digit color.");
    const rgb = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  };
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
