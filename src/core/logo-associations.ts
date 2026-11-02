import { z } from "zod";
import { logoDisplay } from "./private-logo";

// Installation-local, host-only contracts. These are NOT portable branding fields.
const revision = z.number().int().nonnegative().max(1000000000);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const image = z
  .object({ id: z.uuid(), revision: revision.positive(), sha256: digest })
  .strict();
export const logoAssociationReview = z
  .object({
    format: z.literal("lms-private-logo-association-review"),
    version: z.literal(1),
    organizationId: z.uuid(),
    actorId: z.uuid(),
    configurationRevision: revision.positive(),
    configurationSha256: digest,
    assetStateRevision: revision,
    associationRevision: revision,
    mode: z.enum(["image", "builtin"]),
    asset: image.nullable(),
    display: logoDisplay.nullable(),
    historyRevision: revision.positive().nullable(),
  })
  .strict()
  .refine(
    (r) =>
      r.mode === "image"
        ? r.asset !== null && r.display !== null
        : r.asset === null && r.display === null && r.historyRevision === null,
    {
      message:
        "Review an image and layout together, or explicitly choose the built-in mark.",
    },
  );
export type LogoAssociationReview = z.infer<typeof logoAssociationReview>;
export const logoAssociationCommand = z
  .object({
    format: z.literal("lms-private-logo-association-command"),
    version: z.literal(1),
    operationId: z.uuid(),
    review: logoAssociationReview,
    confirmed: z.literal(true),
  })
  .strict();
export const logoAssociation = z
  .object({
    format: z.literal("lms-private-logo-association"),
    version: z.literal(1),
    organizationId: z.uuid(),
    revision: revision.positive(),
    configurationRevision: revision.positive(),
    configurationSha256: digest,
    mode: z.enum(["image", "builtin"]),
    asset: image.nullable(),
    display: logoDisplay.nullable(),
    actorId: z.uuid(),
    operationId: z.uuid(),
    restoredFrom: revision.positive().nullable(),
    occurredAt: z.iso.datetime(),
  })
  .strict()
  .refine((r) =>
    r.mode === "image"
      ? r.asset !== null && r.display !== null
      : r.asset === null && r.display === null && r.restoredFrom === null,
  );
export type LogoAssociation = z.infer<typeof logoAssociation>;
export const logoAssociationHistory = z.array(logoAssociation).max(129);
export const logoAssociationInspection = z
  .object({
    version: z.literal(1),
    organizationId: z.uuid(),
    configurationRevision: revision.positive(),
    configurationSha256: digest,
    configuration: z.unknown(), // Always passed through the EXISTING validateConfig reader by the host adapter.
    revision,
    status: z.enum([
      "builtin",
      "active",
      "configuration-changed",
      "asset-unavailable",
      "unbranded",
    ]),
    association: logoAssociation.nullable(),
  })
  .strict();
