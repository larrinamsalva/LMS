import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  logoAssociation,
  logoAssociationCommand,
  logoAssociationReview,
} from "../../src/core/logo-associations";
import { validateConfig } from "../../src/core/config";
import { presets } from "../../src/presets";
const review = {
  format: "lms-private-logo-association-review",
  version: 1,
  organizationId: randomUUID(),
  actorId: randomUUID(),
  configurationRevision: 2,
  configurationSha256: "a".repeat(64),
  assetStateRevision: 2,
  associationRevision: 0,
  mode: "image",
  asset: { id: randomUUID(), revision: 2, sha256: "b".repeat(64) },
  display: "rectangle",
  historyRevision: null,
};
it("requires a strictly versioned, scoped, exact-revision explicit confirmation with reviewed layout", () => {
  expect(logoAssociationReview.parse(review)).toEqual(review);
  expect(
    logoAssociationCommand.parse({
      format: "lms-private-logo-association-command",
      version: 1,
      operationId: randomUUID(),
      review,
      confirmed: true,
    }).review,
  ).toEqual(review);
  for (const bad of [
    { ...review, version: 2 },
    { ...review, assetStateRevision: -1 },
    { ...review, asset: { ...review.asset, revision: 0 } },
    { ...review, asset: { ...review.asset, sha256: "SHA-256" } },
    { ...review, display: "url(https://invalid.test/logo)" },
    { ...review, sql: "select 1" },
    { ...review, mode: "builtin" },
  ])
    expect(logoAssociationReview.safeParse(bad).success).toBe(false);
});
it("represents explicit fallback without a hidden image reference or historical resurrection", () => {
  const fallback = { ...review, mode: "builtin", asset: null, display: null };
  expect(logoAssociationReview.safeParse(fallback).success).toBe(true);
  expect(
    logoAssociationReview.safeParse({ ...fallback, historyRevision: 1 })
      .success,
  ).toBe(false);
  expect(
    logoAssociationReview.safeParse({ ...fallback, asset: review.asset })
      .success,
  ).toBe(false);
  expect(
    logoAssociationCommand.safeParse({
      format: "lms-private-logo-association-command",
      version: 1,
      operationId: randomUUID(),
      review,
      confirmed: false,
    }).success,
  ).toBe(false);
});
it("keeps installation-local references out of both portable BusinessConfig versions", () => {
  for (const config of [
    presets.property,
    {
      ...presets.property,
      schemaVersion: 2,
      branding: {
        version: 1,
        palette: "forest-v1",
        mark: "home",
        monogram: "FP",
        appearance: "light",
      },
    },
  ]) {
    expect(() =>
      validateConfig({ ...config, privateLogoAssociation: review }),
    ).toThrow();
    expect(() =>
      validateConfig({
        ...config,
        branding: { ...(config as any).branding, assetId: review.asset.id },
      }),
    ).toThrow();
  }
});
it("requires append-only association identity, reviewed restoration metadata and an immutable digest", () => {
  const a = {
    format: "lms-private-logo-association",
    version: 1,
    organizationId: review.organizationId,
    revision: 1,
    configurationRevision: 2,
    configurationSha256: review.configurationSha256,
    mode: "image",
    asset: review.asset,
    display: "square",
    actorId: review.actorId,
    operationId: randomUUID(),
    restoredFrom: null,
    occurredAt: "2026-01-01T00:00:00.000Z",
  };
  expect(logoAssociation.parse(a)).toEqual(a);
  expect(logoAssociation.safeParse({ ...a, image: "base64" }).success).toBe(
    false,
  );
  expect(
    logoAssociation.safeParse({
      ...a,
      mode: "builtin",
      asset: null,
      display: null,
      restoredFrom: 1,
    }).success,
  ).toBe(false);
});
