import { zValidator } from "@hono/zod-validator";
import { createDb, type Db, scopedDb } from "@relay/db";
import { sentry } from "@sentry/hono/cloudflare";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requestId } from "hono/request-id";
import { z } from "zod";
import { createAuth } from "./auth.ts";

type AppEnv = {
  Bindings: Env;
  Variables: { db: Db; data: ReturnType<typeof scopedDb> };
};

const app = new Hono<AppEnv>();
app.use(
  sentry(app, (env) => ({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 1.0,
  })),
);

app.use(requestId());

app.use(async (c, next) => {
  const start = Date.now();
  await next();
  console.log(
    JSON.stringify({
      level: "info",
      message: "request",
      requestId: c.get("requestId"),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - start,
    }),
  );
});

app.use(async (c, next) => {
  c.set("db", createDb(c.env.DATABASE_URL));
  await next();
});

app.onError((c) => {
  console.error(
    JSON.stringify({
      level: "error",
      message: c.error?.message,
      requestId: c.get("requestId"),
      method: c.req.method,
      path: c.req.path,
      stack: c.error?.stack,
    }),
  );
  return c.json(
    { error: "Internal Server Error", requestId: c.get("requestId") },
    500,
  );
});

app.get("/api/health", (c) => {
  return c.json({ ok: true });
});

app.on(["GET", "POST"], "/api/auth/*", (c) => {
  return createAuth(c.env, c.get("db")).handler(c.req.raw);
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.uuid().optional(),
});

const createRunBody = z.object({
  prompt: z.string().trim().min(1).max(10_000),
  repo: z.string().trim().min(1).max(200),
  branch: z.string().trim().min(1).max(255),
  model: z.string().trim().min(1).max(100),
});

app.use("/api/runs/*", async (c, next) => {
  const db = c.get("db");
  const session = await createAuth(c.env, db).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("data", scopedDb(db, session.user.id));
  await next();
});

app.get("/api/runs", zValidator("query", listQuery), async (c) => {
  const { limit, cursor } = c.req.valid("query");
  return c.json(await c.get("data").runs.list({ limit, cursor }));
});

app.post(
  "/api/runs",
  bodyLimit({ maxSize: 64 * 1024 }),
  zValidator("json", createRunBody),
  async (c) => {
    const created = await c.get("data").runs.create(c.req.valid("json"));
    return c.json(created, 201);
  },
);

export default app;
