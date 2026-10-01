// Site-wide access code gate (private preview). Shared by the middleware (edge runtime) and
// the /access route (Node), so it only uses Web Crypto.
//
// Off unless SITE_ACCESS_CODE is set. The cookie holds HMAC(SESSION_SECRET, code), not the
// code: it can't be forged or brute-forced offline, and changing the code logs everyone out.

export const ACCESS_COOKIE = "swf_access";
export const ACCESS_MAX_AGE = 60 * 60 * 24 * 30;

export const accessCode = () => (process.env.SITE_ACCESS_CODE ?? "").trim();

const enc = new TextEncoder();
let cached: { code: string; token: Promise<string> } | null = null;

export function accessToken(code: string): Promise<string> {
  if (cached?.code === code) return cached.token;
  const token = (async () => {
    const key = await crypto.subtle.importKey("raw", enc.encode(process.env.SESSION_SECRET || "swellfi-site-access"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`site-access:v1:${code}`)));
    return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
  })();
  cached = { code, token };
  return token;
}

/** Constant-time string comparison. */
export function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Only same-site paths, so ?next= can't redirect off the site. */
export function safeNext(v: unknown): string {
  if (typeof v !== "string" || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\") || v.startsWith("/access")) return "/";
  return v;
}

/** Relative redirect: correct behind Nginx without knowing the public host or scheme. */
export const redirectTo = (location: string, status = 303) => new Response(null, { status, headers: { Location: location, "Cache-Control": "no-store" } });
