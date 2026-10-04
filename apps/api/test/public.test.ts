import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bearer, setupTestApp } from "./helpers";

// INVITE_ONLY=false: anyone with a wallet signs up, no invite code.
type Ctx = Awaited<ReturnType<typeof setupTestApp>>;
let t: Ctx;
const CAROL = "0x3333333333333333333333333333333333333333";

beforeAll(async () => {
  t = await setupTestApp({ INVITE_ONLY: "false" });
  t.auth.wallets["carol"] = [CAROL];
});

afterAll(async () => {
  await t?.close();
});

describe("public sign-up", () => {
  it("needs no invite code, only the terms and a linked wallet", async () => {
    expect((await t.app.inject({ url: "/api/config" })).json()).toMatchObject({ inviteOnly: false });
    const me = await t.app.inject({ url: "/api/me", headers: bearer("carol") });
    expect(me.json()).toMatchObject({ error: "NOT_REGISTERED", inviteOnly: false });

    const post = (body: object) => t.app.inject({ method: "POST", url: "/api/invite/redeem", headers: bearer("carol"), payload: body });
    expect((await post({ address: CAROL, acceptTerms: false })).statusCode).toBe(400);
    const ok = await post({ address: CAROL, acceptTerms: true });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ created: true, user: { address: CAROL } });
    expect((await t.app.inject({ url: "/api/me", headers: bearer("carol") })).statusCode).toBe(200);
  });
});
