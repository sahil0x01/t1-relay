import { sentry } from "@sentry/hono/cloudflare";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { createAuth } from "./auth.ts";

const app = new Hono<{ Bindings: Env }>();

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
  return createAuth(c.env).handler(c.req.raw);
});

export default app;
