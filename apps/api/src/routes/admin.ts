import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppContext } from "../app";
import { forbidden, notFound } from "../lib/http";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const newInviteCode = () => `SWELL-${[...randomBytes(6)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("")}`;

/** Admin endpoints (waitlist review, invite codes). Admins are listed in ADMIN_ADDRESSES. */
export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  const { prisma } = ctx;

  async function requireAdmin(req: FastifyRequest) {
    const user = await ctx.requireUser(req);
    if (!ctx.isAdmin(user)) throw forbidden();
    return user;
  }

  app.get("/admin/waitlist", async (req) => {
    await requireAdmin(req);
    const { status } = z.object({ status: z.enum(["pending", "approved", "rejected"]).default("pending") }).parse(req.query);
    const entries = await prisma.waitlistEntry.findMany({ where: { status }, orderBy: { createdAt: "asc" }, take: 500 });
    return { entries };
  });

  /** Approve a waitlist entry and issue a single-use invite code (email it to them). */
  app.post("/admin/waitlist/:id/approve", async (req) => {
    const admin = await requireAdmin(req);
    const { id } = z.object({ id: z.string().max(40) }).parse(req.params);
    const entry = await prisma.waitlistEntry.findUnique({ where: { id } });
    if (!entry) throw notFound("Waitlist entry not found");
    if (entry.status === "approved" && entry.inviteCode) return { entry };
    const code = newInviteCode();
    const [, updated] = await prisma.$transaction([
      prisma.inviteCode.create({ data: { code, ownerId: admin.id, maxUses: 1, note: `waitlist:${entry.email}` } }),
      prisma.waitlistEntry.update({ where: { id }, data: { status: "approved", inviteCode: code, reviewedAt: new Date() } }),
    ]);
    return { entry: updated };
  });

  app.post("/admin/waitlist/:id/reject", async (req) => {
    await requireAdmin(req);
    const { id } = z.object({ id: z.string().max(40) }).parse(req.params);
    const entry = await prisma.waitlistEntry.update({ where: { id }, data: { status: "rejected", reviewedAt: new Date() } }).catch(() => null);
    if (!entry) throw notFound("Waitlist entry not found");
    return { entry };
  });

  app.post("/admin/invites", async (req) => {
    const admin = await requireAdmin(req);
    const body = z.object({ count: z.number().int().min(1).max(100).default(1), maxUses: z.number().int().min(1).max(10_000).default(1), note: z.string().max(120).optional() }).parse(req.body ?? {});
    const codes = Array.from({ length: body.count }, newInviteCode);
    await prisma.inviteCode.createMany({ data: codes.map((code) => ({ code, ownerId: admin.id, maxUses: body.maxUses, note: body.note ?? null })) });
    return { codes };
  });
}
