import { ACCESS_COOKIE, ACCESS_MAX_AGE, accessCode, accessToken, gateResponse, redirectTo, safeNext, sameString } from "@/lib/access";

// GET shows the form (the middleware also serves it in place of locked pages), POST checks the
// code. Works without JavaScript.

export const dynamic = "force-dynamic";

// Failed attempts per IP. The web app runs as one process (deploy/ecosystem.config.cjs), so
// memory is enough.
const MAX_FAILS = 10;
const WINDOW_MS = 15 * 60_000;
const fails = new Map<string, { n: number; until: number }>();

const clientIp = (req: Request) => req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

function blocked(ip: string, now: number): boolean {
  const f = fails.get(ip);
  if (f && f.until <= now) fails.delete(ip);
  return (fails.get(ip)?.n ?? 0) >= MAX_FAILS;
}

function recordFail(ip: string, now: number) {
  if (fails.size > 10_000) for (const [k, v] of fails) if (v.until <= now) fails.delete(k);
  const f = fails.get(ip);
  fails.set(ip, { n: (f?.n ?? 0) + 1, until: f?.until ?? now + WINDOW_MS });
}

async function unlocked(req: Request, code: string): Promise<boolean> {
  const m = (req.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${ACCESS_COOKIE}=([^;]+)`));
  return Boolean(m && sameString(m[1]!, await accessToken(code)));
}

const back = (next: string, e: string) => `/access?e=${e}${next === "/" ? "" : `&next=${encodeURIComponent(next)}`}`;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const code = accessCode();
  if (!code || (await unlocked(req, code))) return redirectTo(next, 307);
  const e = url.searchParams.get("e");
  const error = e === "wait" ? "Too many attempts. Try again in 15 minutes." : e === "1" ? "That code isn't right. Check it and try again." : "";
  return gateResponse(next, error);
}

export async function POST(req: Request) {
  const code = accessCode();
  const form = await req.formData().catch(() => null);
  const next = safeNext(form?.get("next"));
  if (!code) return redirectTo(next);
  const ip = clientIp(req);
  const now = Date.now();
  if (blocked(ip, now)) return redirectTo(back(next, "wait"));
  const given = String(form?.get("code") ?? "").trim();
  if (!sameString(given, code)) {
    recordFail(ip, now);
    return redirectTo(back(next, blocked(ip, now) ? "wait" : "1"));
  }
  fails.delete(ip);
  const secure = req.headers.get("x-forwarded-proto") === "https" || new URL(req.url).protocol === "https:";
  const res = redirectTo(next);
  res.headers.append("Set-Cookie", `${ACCESS_COOKIE}=${await accessToken(code)}; Path=/; Max-Age=${ACCESS_MAX_AGE}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`);
  return res;
}
