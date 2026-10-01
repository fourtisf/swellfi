import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import type { WebSocket } from "ws";
import { z } from "zod";
import type { AppContext } from "../app";

/** Redis pub/sub channel names. Producers (API, indexer) publish JSON here. */
export const CH = {
  activity: "tl:pub:activity",
  chat: "tl:pub:chat",
  user: (id: string) => `tl:pub:user:${id}`,
};

export const publish = (redis: Redis, channel: string, payload: unknown) => redis.publish(channel, JSON.stringify(payload));

const msgSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("sub"), ch: z.enum(["activity", "chat"]) }),
  z.object({ op: z.literal("unsub"), ch: z.enum(["activity", "chat"]) }),
  z.object({ op: z.literal("auth"), token: z.string().min(10).max(4096) }),
  z.object({ op: z.literal("ping") }),
]);

interface Client {
  socket: WebSocket;
  channels: Set<string>;
  userId: string | null;
  alive: boolean;
}

/**
 * WebSocket gateway at /ws. Clients subscribe to `activity` and `chat`; after
 * `{op:"auth"}` they also receive `user:{id}` notifications. Messages fan out from Redis
 * pub/sub so every API process (PM2 cluster) delivers them.
 */
export async function gateway(app: FastifyInstance, ctx: AppContext) {
  const clients = new Set<Client>();
  const sub = ctx.redis.duplicate();
  sub.on("error", (err) => app.log.warn({ err }, "redis subscriber error"));

  sub.on("pmessage", (_pattern, channel, raw) => {
    let ch: string;
    if (channel === CH.activity) ch = "activity";
    else if (channel === CH.chat) ch = "chat";
    else if (channel.startsWith("tl:pub:user:")) ch = `user:${channel.slice("tl:pub:user:".length)}`;
    else return;
    const frame = `{"ch":${JSON.stringify(ch)},"data":${raw}}`;
    for (const c of clients) {
      if (c.channels.has(ch) && c.socket.readyState === 1) c.socket.send(frame);
    }
  });
  await sub.psubscribe("tl:pub:*").catch((err) => app.log.warn({ err }, "redis psubscribe failed"));

  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        c.socket.terminate();
        continue;
      }
      c.alive = false;
      c.socket.ping();
    }
  }, 30_000);

  app.addHook("onClose", async () => {
    clearInterval(heartbeat);
    for (const c of clients) c.socket.close(1001);
    sub.disconnect();
  });

  app.get("/ws", { websocket: true, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, (socket) => {
    const client: Client = { socket, channels: new Set(), userId: null, alive: true };
    clients.add(client);
    socket.on("pong", () => (client.alive = true));
    socket.on("close", () => clients.delete(client));

    let budget = 20; // messages per 10s
    const refill = setInterval(() => (budget = 20), 10_000);
    socket.on("close", () => clearInterval(refill));

    socket.on("message", async (raw: Buffer) => {
      if (--budget < 0) return socket.close(1008, "rate limit");
      let msg: z.infer<typeof msgSchema>;
      try {
        msg = msgSchema.parse(JSON.parse(raw.toString()));
      } catch {
        return socket.send(JSON.stringify({ op: "error", error: "BAD_MESSAGE" }));
      }
      if (msg.op === "ping") return socket.send('{"op":"pong"}');
      if (msg.op === "sub") {
        client.channels.add(msg.ch);
        return socket.send(JSON.stringify({ op: "subscribed", ch: msg.ch }));
      }
      if (msg.op === "unsub") {
        client.channels.delete(msg.ch);
        return;
      }
      try {
        const id = await ctx.auth.verify(msg.token);
        const user = await ctx.prisma.user.findUnique({ where: { privyId: id.privyId }, select: { id: true } });
        if (!user) return socket.send(JSON.stringify({ op: "error", error: "NOT_REGISTERED" }));
        if (client.userId) client.channels.delete(`user:${client.userId}`);
        client.userId = user.id;
        client.channels.add(`user:${user.id}`);
        socket.send(JSON.stringify({ op: "authed", ch: `user:${user.id}` }));
      } catch {
        socket.send(JSON.stringify({ op: "error", error: "UNAUTHORIZED" }));
      }
    });
  });
}
