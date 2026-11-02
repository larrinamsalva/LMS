import { expect, it } from "vitest";
import { reserveLogoProcessing } from "../../src/server/logo-processing";
import { logoLimits } from "../../src/core/private-logo";
it("keeps the original process-wide capacity and releases reservations exactly once", () => {
  const slots = Array.from({ length: logoLimits.processing }, () =>
    reserveLogoProcessing(),
  );
  try {
    expect(() => reserveLogoProcessing()).toThrow(/capacity/);
    slots[0]();
    slots[0]();
    const next = reserveLogoProcessing();
    expect(() => reserveLogoProcessing()).toThrow(/capacity/);
    next();
  } finally {
    for (const release of slots) release();
  }
  const again = reserveLogoProcessing();
  again();
});
