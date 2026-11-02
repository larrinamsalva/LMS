import { z } from "zod";
import { BRANDED_BUNDLE_LIMIT } from "./branded-bundle";
import { BLUEPRINT_PACKAGE_LIMIT } from "./blueprint-archive";
import { LOGO_COMPANION_LIMIT } from "./logo-companion";
import { logoDisplay, logoLimits } from "./private-logo";

// Installation-private evidence ONLY. None of these fields extend portable formats.
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().nonnegative().max(999999999);
const portableVersion = z.union([z.literal(1), z.literal(2)]);
export const logoTransferSource = z
  .object({
    bundleVersion: z.literal(1),
    bundleSha256: digest,
    bundleBytes: z.number().int().positive().max(BRANDED_BUNDLE_LIMIT),
    blueprintVersion: portableVersion,
    blueprintSha256: digest,
    blueprintBytes: z.number().int().positive().max(BLUEPRINT_PACKAGE_LIMIT),
    buildPlanVersion: portableVersion,
    configurationSchema: portableVersion,
    companionVersion: z.literal(1),
    companionSha256: digest,
    companionBytes: z.number().int().positive().max(LOGO_COMPANION_LIMIT),
    imageSha256: digest,
    imageBytes: z.number().int().positive().max(logoLimits.outputBytes),
    imageWidth: z.number().int().positive().max(512),
    imageHeight: z.number().int().positive().max(512),
    display: logoDisplay,
  })
  .strict()
  .refine(
    (r) =>
      r.blueprintVersion === r.buildPlanVersion &&
      r.buildPlanVersion === r.configurationSchema,
    "Use matching validated Blueprint, BuildPlan and configuration versions.",
  );
export const logoTransferExpected = z
  .object({
    configurationRevision: revision.positive(),
    configurationSha256: digest,
    assetStateRevision: revision,
    associationRevision: revision,
  })
  .strict();
export const logoTransferReview = z
  .object({
    format: z.literal("lms-private-logo-transfer-review"),
    version: z.literal(1),
    organizationId: z.uuid(),
    instanceId: z.uuid(),
    actorId: z.uuid(),
    source: logoTransferSource,
    expected: logoTransferExpected,
    sanitizer: z.literal("sharp-0.35.5/png-v1"),
    reviewedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export type LogoTransferReview = z.infer<typeof logoTransferReview>;
export const logoTransferCommand = z
  .object({
    format: z.literal("lms-private-logo-transfer-command"),
    version: z.literal(1),
    operationId: z.uuid(),
    review: logoTransferReview,
    confirmed: z.literal(true),
  })
  .strict();
export const privateLogoDestinationMap = z
  .object({
    format: z.literal("lms-private-logo-destination-map"),
    version: z.literal(1),
    operationId: z.uuid(),
    reviewStatus: z.literal("confirmed"),
    review: logoTransferReview,
    asset: z
      .object({
        id: z.uuid(),
        revision: z.literal(1),
        state: z.literal("stored"), // Historical state at commit; not continuing eligibility.
        sha256: digest,
        bytes: z.number().int().positive().max(logoLimits.outputBytes),
        width: z.number().int().positive().max(512),
        height: z.number().int().positive().max(512),
        sanitizer: z.literal("sharp-0.35.5/png-v1"),
      })
      .strict(),
    assetStateRevision: revision.positive(),
    occurredAt: z.iso.datetime(),
  })
  .strict();
export type PrivateLogoDestinationMap = z.infer<
  typeof privateLogoDestinationMap
>;
export const privateLogoTransferHistory = z
  .array(privateLogoDestinationMap)
  .max(128);
