import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, setupTestApp } from "./helpers";

type Ctx = Awaited<ReturnType<typeof setupTestApp>>;
let t: Ctx;

const CAROL = "0x3333333333333333333333333333333333333333";
const DAVE = "0x4444444444444444444444444444444444444444";
// Smallest valid PNG (1×1, transparent).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const dataUrl = (b: Buffer, type = "png") => `data:image/${type};base64,${b.toString("base64")}`;

beforeAll(async () => {
  t = await setupTestApp();
  t.auth.wallets["carol"] = [CAROL];
  t.auth.wallets["dave"] = [DAVE];
  await t.prisma.inviteCode.create({ data: { code: "SWELL-PROF", maxUses: 5 } });
  for (const [who, address] of [["carol", CAROL], ["dave", DAVE]] as const) {
    const r = await t.app.inject({ method: "POST", url: "/api/invite/redeem", headers: bearer(who), payload: { code: "SWELL-PROF", address, acceptTerms: true } });
    expect(r.json().created).toBe(true);
  }
});

afterAll(async () => {
  await t?.close();
});

const edit = (payload: object, who = "carol") => t.app.inject({ method: "POST", url: "/api/me/profile", headers: bearer(who), payload });

describe("edit profile", () => {
  it("needs a signed-in, registered user", async () => {
    expect((await t.app.inject({ method: "POST", url: "/api/me/profile", payload: { bio: "x" } })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "POST", url: "/api/me/avatar", payload: { image: dataUrl(PNG) } })).statusCode).toBe(401);
  });

  it("changes the username and bio", async () => {
    const r = await edit({ handle: "  Carol_Trades ", bio: "Perps trader.\n\n\nBTC only.‮" });
    expect(r.statusCode).toBe(200);
    expect(r.json().user).toMatchObject({ handle: "carol_trades", bio: "Perps trader.\nBTC only." });
    expect((await t.app.inject({ url: "/api/users/carol_trades" })).json().user.bio).toBe("Perps trader.\nBTC only.");
    // empty bio clears it
    expect((await edit({ bio: "   " })).json().user.bio).toBeNull();
  });

  it("refuses taken, reserved and malformed usernames", async () => {
    const taken = await edit({ handle: "carol_trades" }, "dave");
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toBe("HANDLE_TAKEN");
    for (const h of ["ab", "a".repeat(21), "bad name", "<script>", "_carol", "carol__x", "admin", "swellfi_official", "hyperliquid"]) {
      const r = await edit({ handle: h }, "dave");
      expect(r.statusCode, h).toBe(400);
      expect(r.json().error, h).toBe("BAD_HANDLE");
    }
  });

  it("refuses bios that are too long or have too many lines", async () => {
    expect((await edit({ bio: "x".repeat(161) })).json().error).toBe("BAD_BIO");
    expect((await edit({ bio: "a\nb\nc\nd" })).json().error).toBe("BAD_BIO");
  });
});

describe("profile picture", () => {
  it("stores a real image and serves it with safe headers", async () => {
    const r = await t.app.inject({ method: "POST", url: "/api/me/avatar", headers: bearer("carol"), payload: { image: dataUrl(PNG) } });
    expect(r.statusCode).toBe(200);
    const url: string = r.json().user.avatarUrl;
    expect(url).toMatch(/^\/api\/avatars\/[a-z0-9]+\?v=\d+$/);
    const img = await t.app.inject({ url });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect(img.headers["x-content-type-options"]).toBe("nosniff");
    expect(img.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(img.rawPayload.equals(PNG)).toBe(true);
    // removing it
    const del = await t.app.inject({ method: "DELETE", url: "/api/me/avatar", headers: bearer("carol") });
    expect(del.json().user.avatarUrl).toBeNull();
    expect((await t.app.inject({ url })).statusCode).toBe(404);
  });

  it("refuses files that aren't images, whatever they claim to be", async () => {
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    for (const image of [dataUrl(html), dataUrl(html, "webp"), `data:image/svg+xml;base64,${svg.toString("base64")}`, "https://evil.example/x.png", "not a data url"]) {
      const r = await t.app.inject({ method: "POST", url: "/api/me/avatar", headers: bearer("dave"), payload: { image } });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe("BAD_IMAGE");
    }
    const big = Buffer.concat([PNG, Buffer.alloc(210 * 1024)]);
    expect((await t.app.inject({ method: "POST", url: "/api/me/avatar", headers: bearer("dave"), payload: { image: dataUrl(big) } })).json().error).toBe("IMAGE_TOO_LARGE");
  });
});
