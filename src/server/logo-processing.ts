import { EngineError } from "../core/engine";
import { logoLimits } from "../core/private-logo";
let active = 0;
/** One process-wide bound shared by temporary custody, host-only durable intake and verification. */
export function reserveLogoProcessing() {
  if (active >= logoLimits.processing)
    throw new EngineError(
      "Private logo processing capacity reached. Retry later.",
      429,
    );
  active++;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      active--;
    }
  };
}
