/** Next.js normalizes loopback URLs, so preserve the actual Host for local demo origin checks. */
export function sameOrigin(
  request: Request,
  configuredOrigin?: string,
): boolean {
  try {
    const origin = request.headers.get("origin");
    if (!origin || origin === "null") return false;
    if (configuredOrigin) {
      const expected = new URL(configuredOrigin);
      return expected.origin === configuredOrigin && origin === expected.origin;
    }
    const url = new URL(request.url);
    const local = new URL(
      `${url.protocol}//${request.headers.get("host") ?? url.host}`,
    );
    if (!["127.0.0.1", "localhost", "[::1]"].includes(local.hostname))
      return false;
    return origin === local.origin;
  } catch {
    return false;
  }
}
