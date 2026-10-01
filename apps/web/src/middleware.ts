import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, accessCode, accessToken, gateResponse, sameString } from "@/lib/access";

/** Shows the access gate (see lib/access.ts) in place of any page until the visitor unlocks. */
export async function middleware(req: NextRequest) {
  const code = accessCode();
  if (!code) return NextResponse.next();
  const have = req.cookies.get(ACCESS_COOKIE)?.value;
  if (have && sameString(have, await accessToken(code))) return NextResponse.next();
  // Serve the gate itself, at the requested URL; it sends the visitor back here once unlocked.
  // No rewrite: behind Nginx, Next 14 can mistake a middleware rewrite for an external URL.
  return gateResponse(req.nextUrl.pathname + req.nextUrl.search);
}

export const config = {
  // Everything except the gate itself, the API and WebSocket (Nginx sends those to the API in
  // production), build assets, and the icons and share images that link previews fetch.
  matcher: ["/((?!access$|access/|api/|ws$|_next/static/|_next/image|icon\\.svg|apple-icon\\.png|opengraph-image|twitter-image|favicon\\.ico|robots\\.txt).*)"],
};
