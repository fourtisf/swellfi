import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, accessCode, accessToken, sameString } from "@/lib/access";

/** Shows the access gate (see lib/access.ts) in place of any page until the visitor unlocks. */
export async function middleware(req: NextRequest) {
  const code = accessCode();
  if (!code) return NextResponse.next();
  const have = req.cookies.get(ACCESS_COOKIE)?.value;
  if (have && sameString(have, await accessToken(code))) return NextResponse.next();
  // A rewrite, not a redirect: the URL stays as requested and the gate sends the visitor back
  // there once unlocked.
  const gate = new URL("/access", req.url);
  gate.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.rewrite(gate);
}

export const config = {
  // Everything except the gate itself, the API and WebSocket (Nginx sends those to the API in
  // production), build assets, and the icons and share images that link previews fetch.
  matcher: ["/((?!access$|access/|api/|ws$|_next/static/|_next/image|icon\\.svg|apple-icon\\.png|opengraph-image|twitter-image|favicon\\.ico|robots\\.txt).*)"],
};
