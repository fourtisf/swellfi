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
  // Browsers drop tabs/newlines and read a backslash as "/" in URLs, so "/<TAB>/evil.com" becomes
  // "//evil.com". Allow only a plain same-origin path: no control characters, spaces or backslashes.
  if (typeof v !== "string" || !/^\/(?![/\\])[^\x00-\x20\x7f\\]*$/.test(v) || v.startsWith("/access")) return "/";
  return v;
}

/** Relative redirect: correct behind Nginx without knowing the public host or scheme. */
export const redirectTo = (location: string, status = 303) => new Response(null, { status, headers: { Location: location, "Cache-Control": "no-store" } });

/** The gate page: plain HTML with no app JavaScript, so nothing of the app loads before unlocking. */
export const gateResponse = (next: string, error = "") =>
  new Response(page(next, error), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(next: string, error: string): string {
  const brand = esc(process.env.NEXT_PUBLIC_BRAND_NAME || "Swellfi");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#070B14">
<title>${brand} — Private preview</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="preload" as="image" href="/access/terminal-desktop.jpg" media="(min-width: 641px)">
<link rel="preload" as="image" href="/access/terminal-mobile.jpg" media="(max-width: 640px)">
<style>
*{box-sizing:border-box;margin:0}
html,body{height:100%}
body{min-height:100dvh}
body{display:grid;place-items:center;padding:24px 16px;background:#070B14;color:#EAF1FA;font:15px/1.5 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden}
/* The trading terminal behind the card, from public/access/ so no app code or live data loads
   before unlocking: a muted loop recording on desktop, a slowly drifting screenshot on phones.
   The still image (the video's first frame on desktop) shows until the video plays. */
body::before{content:"";position:fixed;inset:0;background:url(/access/terminal-desktop.jpg) center top/cover no-repeat}
#bgv{position:fixed;inset:0;width:100%;height:100%;object-fit:cover;object-position:center top;opacity:0;transition:opacity .8s ease}
#bgv.on{opacity:1}
body::after{content:"";position:fixed;inset:0;background:radial-gradient(620px 440px at 50% 50%,rgba(7,11,20,.72),rgba(7,11,20,.5) 80%)}
@keyframes drift{from{transform:scale(1) translate3d(0,0,0)}to{transform:scale(1.05) translate3d(-1.5%,-2.5%,0)}}
@media (max-width:640px){
  body{padding:20px 16px}
  body::before{background-image:url(/access/terminal-mobile.jpg);transform-origin:50% 30%;animation:drift 32s ease-in-out infinite alternate}
  body::after{background:linear-gradient(180deg,rgba(7,11,20,.62),rgba(7,11,20,.5) 45%,rgba(7,11,20,.7))}
  #bgv{display:none}
  .card{padding:26px 22px;border-radius:18px}
  .brand{margin-bottom:22px}
  h1{font-size:21px}
  p{margin-bottom:18px}
}
@media (prefers-reduced-motion:reduce){body::before{animation:none}#bgv{display:none}}
.card{position:relative;z-index:1;width:100%;max-width:400px;padding:32px 28px;border-radius:20px;background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 120px),rgba(13,19,32,.84);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.1);box-shadow:0 30px 80px -20px rgba(0,0,0,.85)}
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
<video id="bgv" muted playsinline loop autoplay preload="none" aria-hidden="true"></video>
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
<script>
(function () {
  var v = document.getElementById("bgv"), mq = window.matchMedia;
  if (!v || (mq && (mq("(max-width: 640px)").matches || mq("(prefers-reduced-motion: reduce)").matches))) return;
  v.muted = true;
  v.addEventListener("playing", function () { v.classList.add("on"); });
  // VP9 first (Chrome, Edge, Firefox, recent Safari), H.264 for older Safari.
  v.innerHTML = '<source src="/access/terminal-desktop.webm" type="video/webm"><source src="/access/terminal-desktop.mp4" type="video/mp4">';
  v.load();
  var p = v.play();
  if (p && p.catch) p.catch(function () {});
})();
</script>
</body>
</html>`;
}
