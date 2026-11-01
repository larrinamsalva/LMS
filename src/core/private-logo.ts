import { z } from "zod";
/** Demo asset limits, not a BusinessConfig/BuildPlan extension. */
export const logoLimits = Object.freeze({ inputBytes: 1048576, pixels: 1048576, dimension: 4096, outputDimension: 512, outputBytes: 262144, uploads: 12, mutations: 64, stagedMs: 600000, sessionBytes: 2097152, globalBytes: 33554432, processing: 2 });
export const logoDisplay = z.enum(["square", "rectangle"]);
export const logoAssetSchema = z.object({ id: z.uuid(), width: z.number().int().positive().max(512), height: z.number().int().positive().max(512), bytes: z.number().int().positive().max(logoLimits.outputBytes), display: logoDisplay, expiresAt: z.number().int().positive() }).strict();
export type LogoAsset = z.infer<typeof logoAssetSchema>;
export const logoStateSchema = z.object({ revision: z.number().int().nonnegative(), selected: logoAssetSchema.nullable(), staged: logoAssetSchema.nullable(), remainingUploads: z.number().int().min(0).max(12), expiresAt: z.number().int().positive() }).strict();
export type LogoState = z.infer<typeof logoStateSchema>;
export const logoCommandSchema = z.object({ action: z.enum(["select", "remove", "layout"]), assetId: z.uuid(), revision: z.number().int().nonnegative(), operationId: z.uuid(), display: logoDisplay.optional() }).strict().superRefine((v, ctx) => {
  if ((v.action === "layout") !== (v.display !== undefined)) ctx.addIssue({ code: "custom", message: "Only layout changes include a reviewed display value." });
});
/** Only a fixed same-origin route and validated UUIDs, never an imported URL. */
export const privateLogoUrl = (organizationId: string, assetId: string) => "/api/demo/logo?organizationId=" + encodeURIComponent(z.uuid().parse(organizationId)) + "&assetId=" + encodeURIComponent(z.uuid().parse(assetId));
