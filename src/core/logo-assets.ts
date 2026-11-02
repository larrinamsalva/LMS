import { z } from "zod";
import { logoDisplay, logoLimits } from "./private-logo";

/** Host-only storage contract. This is deliberately not a BusinessConfig or portable branding extension. */
export const durableLogoLimits = Object.freeze({
  assets: 16,
  bytes: logoLimits.sessionBytes,
  operations: 128,
  cleanupOperations: 32,
  retentionDays: 30,
});
export const durableLogoStates = [
  "stored",
  "selected",
  "superseded",
  "unreferenced",
  "retired",
  "blocked",
] as const;
export const durableLogoMetadata = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    organizationId: z.uuid(),
    revision: z.number().int().positive(),
    state: z.enum(durableLogoStates),
    format: z.literal("png"),
    sanitizer: z.literal("sharp-0.35.5/png-v1"),
    width: z.number().int().positive().max(512),
    height: z.number().int().positive().max(512),
    bytes: z.number().int().positive().max(logoLimits.outputBytes),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    display: logoDisplay,
    createdAt: z.iso.datetime(),
    unreferencedAt: z.iso.datetime().nullable(),
    retentionEligibleAt: z.iso.datetime().nullable(),
  })
  .strict();
export type DurableLogoMetadata = z.infer<typeof durableLogoMetadata>;
export const durableLogoSnapshot = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    selectedId: z.uuid().nullable(),
    canManage: z.boolean(),
    assets: z.array(durableLogoMetadata).max(durableLogoLimits.assets),
  })
  .strict();
export const durableLogoStoreCommand = z
  .object({
    version: z.literal(1),
    operationId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    display: logoDisplay,
  })
  .strict();
export const durableLogoChange = z
  .object({
    version: z.literal(1),
    operationId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    assetId: z.uuid(),
    assetRevision: z.number().int().positive(),
    action: z.enum([
      "select",
      "unselect",
      "release",
      "restore",
      "retire",
      "block",
    ]),
  })
  .strict();
export const durableLogoReceipt = z
  .object({
    version: z.literal(1),
    operationId: z.uuid(),
    revision: z.number().int().positive(),
    assetId: z.uuid(),
    assetRevision: z.number().int().positive(),
    action: z.enum([
      "store",
      "select",
      "unselect",
      "release",
      "restore",
      "retire",
      "block",
    ]),
  })
  .strict();
export const durableLogoHistory = z
  .array(
    z
      .object({
        assetId: z.uuid(),
        revision: z.number().int().positive(),
        state: z.enum(durableLogoStates),
        actorId: z.uuid(),
        operationId: z.uuid(),
        occurredAt: z.iso.datetime(),
      })
      .strict(),
  )
  .max(320);
