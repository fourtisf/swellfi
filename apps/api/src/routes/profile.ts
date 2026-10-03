import { Prisma } from "@swellfi/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app";
import { badRequest, HttpError, notFound } from "../lib/http";
import { publicUser } from "./serialize";

// Names nobody may take: they'd let a user pass as the team, a partner or a system page.
const RESERVED = /^(admin|administrator|root|system|support|help|helpdesk|team|staff|official|mod|moderator|security|swellfi|swell|hyperliquid|hyperevm|hype|relay|walletconnect|metamask|api|app|www|me|you|settings|profile|account|login|logout|signup|register|trade|markets|feed|rankings|rewards|funds|null|undefined)(_.*)?$/;

export const editHandleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Username must be at least 3 characters")
  .max(20, "Username can be at most 20 characters")
  .regex(/^[a-z0-9_]+$/, "Use only letters, numbers and _")
  .refine((h) => !/^_|_$|__/.test(h), "Username can't start or end with _ or have __")
  .refine((h) => !RESERVED.test(h), "That username is reserved");

// Plain text only (rendered as text, never HTML): no control characters, at most 3 lines.
const bioSchema = z
  .string()
  .transform((s) =>
    s
      .replace(/\r\n?/g, "\n")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "")
      .replace(/\n{2,}/g, "\n")
      .trim(),
  )
  .refine((s) => s.length <= 160, "Bio can be at most 160 characters")
  .refine((s) => s.split("\n").length <= 3, "Bio can be at most 3 lines");

const MAX_AVATAR_BYTES = 200 * 1024;

/** The image type from its first bytes (never from what the client claims). */
function sniffImage(b: Buffer): "image/webp" | "image/png" | "image/jpeg" | null {
  if (b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

/** Edit your own profile: username, bio and picture. */
export async function profileRoutes(app: FastifyInstance, ctx: AppContext) {
  const { prisma } = ctx;

  app.post("/me/profile", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const user = await ctx.requireUser(req);
    const body = z.object({ handle: z.string().optional(), bio: z.string().max(1000).optional(), isPublic: z.boolean().optional() }).parse(req.body);
    const data: Prisma.UserUpdateInput = {};
    if (body.handle !== undefined) {
      const h = editHandleSchema.safeParse(body.handle);
      if (!h.success) throw badRequest("BAD_HANDLE", h.error.issues[0]!.message);
      if (h.data !== user.handle) data.handle = h.data;
    }
    if (body.bio !== undefined) {
      const b = bioSchema.safeParse(body.bio);
      if (!b.success) throw badRequest("BAD_BIO", b.error.issues[0]!.message);
      data.bio = b.data || null;
    }
    // Private accounts are left out of the feed, rankings and public profile.
    if (body.isPublic !== undefined && body.isPublic !== user.isPublic) data.isPublic = body.isPublic;
    try {
      const updated = Object.keys(data).length ? await prisma.user.update({ where: { id: user.id }, data }) : user;
      return { user: { ...publicUser(updated), isPublic: updated.isPublic } };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new HttpError(409, "HANDLE_TAKEN", "That username is already taken");
      throw e;
    }
  });

  // The picture arrives as a data URL (the browser resizes it to 256×256 first).
  app.post("/me/avatar", { bodyLimit: 400 * 1024, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const user = await ctx.requireUser(req);
    const { image } = z.object({ image: z.string().max(400 * 1024) }).parse(req.body);
    const m = /^data:image\/(?:webp|png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
    if (!m) throw badRequest("BAD_IMAGE", "Upload a PNG, JPEG or WebP image");
    const bytes = Buffer.from(m[1]!, "base64");
    if (bytes.length > MAX_AVATAR_BYTES) throw badRequest("IMAGE_TOO_LARGE", "Image is too large (max 200 KB after resizing)");
    const mime = sniffImage(bytes);
    if (!mime) throw badRequest("BAD_IMAGE", "Upload a PNG, JPEG or WebP image");
    const now = new Date();
    const [, updated] = await prisma.$transaction([
      prisma.avatar.upsert({ where: { userId: user.id }, create: { userId: user.id, data: bytes, mime }, update: { data: bytes, mime } }),
      prisma.user.update({ where: { id: user.id }, data: { avatarUrl: `/api/avatars/${user.id}?v=${now.getTime()}` } }),
    ]);
    return { user: publicUser(updated) };
  });

  app.delete("/me/avatar", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const user = await ctx.requireUser(req);
    const [, updated] = await prisma.$transaction([prisma.avatar.deleteMany({ where: { userId: user.id } }), prisma.user.update({ where: { id: user.id }, data: { avatarUrl: null } })]);
    return { user: publicUser(updated) };
  });

  app.get("/avatars/:userId", { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { userId } = z.object({ userId: z.string().regex(/^[a-z0-9]{10,40}$/i) }).parse(req.params);
    const a = await prisma.avatar.findUnique({ where: { userId } });
    if (!a || !["image/webp", "image/png", "image/jpeg"].includes(a.mime)) throw notFound("No picture");
    return reply
      .header("Content-Type", a.mime)
      // The URL carries ?v=<updated time>, so a new picture gets a new URL.
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .header("Content-Security-Policy", "default-src 'none'; sandbox")
      .header("X-Content-Type-Options", "nosniff")
      .send(Buffer.from(a.data));
  });
}
