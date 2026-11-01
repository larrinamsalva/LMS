/** Browser test bundle only. Not an app route: Playwright serves this from an intercepted request. */
import { createRoot } from "react-dom/client";
import { inspectBlueprintPackage } from "../../src/core/blueprint-provenance";
import { BlueprintVerification } from "../../src/components/blueprint-verification";
export async function inspect(
  zip: number[],
  claim: number[],
  registry: unknown,
) {
  const result = await inspectBlueprintPackage(
    new Uint8Array(zip),
    new Uint8Array(claim),
    registry,
  );
  createRoot(document.getElementById("result")!).render(
    <BlueprintVerification inspection={result} />,
  );
  return result;
}
