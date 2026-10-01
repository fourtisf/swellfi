import { ACCESS_COOKIE, ACCESS_MAX_AGE, accessCode, accessToken, redirectTo, safeNext, sameString } from "@/lib/access";
import { BRAND } from "@/lib/env";

// The gate is plain HTML with no app JavaScript, so nothing of the app loads before unlocking.
// GET shows the form, POST checks the code. Works without JavaScript.

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
  return new Response(page(next, error), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
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

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(next: string, error: string): string {
  const brand = esc(BRAND);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#070B14">
<title>${brand} — Private preview</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<style>
*{box-sizing:border-box;margin:0}
html,body{height:100%}
body{display:grid;place-items:center;padding:24px 16px;background:radial-gradient(900px 520px at 50% -10%,rgba(77,181,255,.16),transparent 70%),#070B14;color:#EAF1FA;font:15px/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.card{width:100%;max-width:400px;padding:32px 28px;border-radius:20px;background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,0) 120px),#0D1320;border:1px solid rgba(255,255,255,.08);box-shadow:0 24px 60px -24px rgba(0,0,0,.8)}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:20px;letter-spacing:-.01em;margin-bottom:28px}
.brand img{width:34px;height:34px}
h1{font-size:22px;font-weight:650;letter-spacing:-.015em;margin-bottom:6px}
p{color:#8B97AD;margin-bottom:22px}
label{display:block;font-size:13px;color:#8B97AD;margin-bottom:8px}
input{width:100%;height:52px;padding:0 16px;border-radius:12px;border:1px solid rgba(255,255,255,.11);background:#121A2A;color:#EAF1FA;font:inherit;font-size:18px;letter-spacing:.12em;outline:none;transition:border-color .15s}
input:focus{border-color:#4DB5FF}
.err{margin-top:10px;color:#F0454F;font-size:13.5px}
button{width:100%;height:52px;margin-top:18px;border:0;border-radius:12px;background:#4DB5FF;color:#04101F;font:inherit;font-size:16px;font-weight:650;cursor:pointer;transition:filter .15s}
button:hover{filter:brightness(1.08)}
button:focus-visible{outline:2px solid #9AF1FF;outline-offset:2px}
</style>
</head>
<body>
<main class="card">
  <div class="brand"><img src="/icon.svg" alt="">${brand}</div>
  <h1>Private preview</h1>
  <p>Enter your access code to continue.</p>
  <form method="post" action="/access">
    <input type="hidden" name="next" value="${esc(next)}">
    <label for="code">Access code</label>
    <input id="code" name="code" type="text" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" required autofocus${error ? ' aria-invalid="true" aria-describedby="err"' : ""}>
    ${error ? `<div class="err" id="err" role="alert">${esc(error)}</div>` : ""}
    <button type="submit">Continue</button>
  </form>
</main>
</body>
</html>`;
}
