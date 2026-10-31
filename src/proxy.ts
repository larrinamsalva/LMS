import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
/** Request-scoped CSP only; authentication and authorization belong to API/service/SQL. */
export function proxy(request: NextRequest) {
  const nonce = randomBytes(18).toString("base64");
  const policy = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}
export const config = { matcher: ["/"] };
