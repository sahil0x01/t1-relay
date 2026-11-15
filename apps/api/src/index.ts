import { zValidator } from "@hono/zod-validator";
import {
  createDb,
  type Db,
  removeInstallation,
  removeProjectsForRepos,
  scopedDb,
} from "@relay/db";
import { sentry } from "@sentry/hono/cloudflare";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { requestId } from "hono/request-id";
import { z } from "zod";
import { createAuth } from "./auth.ts";
import {
  exchangeCodeForUserToken,
  getUserLogin,
  listInstallationRepositories,
  listUserInstallations,
} from "./github.ts";
import { verifyWebhookSignature } from "./webhook.ts";

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

// One database client per request, closed when the request ends. A Workers
// connection cannot be reused by another request, and clients left open pile
// up until Postgres runs out of connections.
app.use(async (c, next) => {
  const db = createDb(c.env.DATABASE_URL);
  c.set("db", db);
  try {
    await next();
  } finally {
    const closing = db.$client.end();
    try {
      // On Workers: close in the background, without delaying the response.
      c.executionCtx.waitUntil(closing);
    } catch {
      // No execution context (tests, Node): wait for it.
      await closing;
    }
  }
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

// Every route behind a login uses this: it reads the session, answers 401
// without one, and gives handlers a data object already scoped to the user.
const requireSession = createMiddleware<AppEnv>(async (c, next) => {
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

app.use("/api/runs/*", requireSession);
app.use("/api/projects/*", requireSession);
app.use("/api/installations/*", requireSession);
app.use("/api/github/*", requireSession);

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.uuid().optional(),
});

const createRunBody = z.object({
  projectId: z.uuid(),
  branch: z.string().trim().min(1).max(255).optional(),
  prompt: z.string().trim().min(1).max(10_000),
  model: z.string().trim().min(1).max(100),
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
    if (!created) {
      return c.json({ error: "Project not found" }, 404);
    }
    return c.json(created, 201);
  },
);

app.get("/api/installations", async (c) => {
  return c.json({ items: await c.get("data").installations.list() });
});

const createProjectBody = z.object({
  installationId: z.number().int().positive(),
  githubRepoId: z.number().int().positive(),
});

app.get("/api/projects", async (c) => {
  return c.json({ items: await c.get("data").projects.list() });
});

app.post(
  "/api/projects",
  bodyLimit({ maxSize: 4 * 1024 }),
  zValidator("json", createProjectBody),
  async (c) => {
    const { installationId, githubRepoId } = c.req.valid("json");
    const data = c.get("data");

    const installations = await data.installations.list();
    if (!installations.some((i) => i.installationId === installationId)) {
      return c.json({ error: "Installation not found" }, 404);
    }

    // The client only says which repository it wants. The name and default
    // branch come from GitHub, restricted to what this installation can see.
    const repos = await listInstallationRepositories(c.env, installationId);
    const repo = repos.find((r) => r.id === githubRepoId);
    if (!repo) {
      return c.json({ error: "Repository not available" }, 404);
    }

    const created = await data.projects.create({
      installationId,
      githubRepoId: repo.id,
      repoFullName: repo.fullName,
      defaultBranch: repo.defaultBranch,
    });
    if (!created) {
      return c.json({ error: "Repository already connected" }, 409);
    }
    return c.json(created, 201);
  },
);

app.delete(
  "/api/projects/:id",
  zValidator("param", z.object({ id: z.uuid() })),
  async (c) => {
    const removed = await c
      .get("data")
      .projects.remove(c.req.valid("param").id);
    if (!removed) {
      return c.json({ error: "Project not found" }, 404);
    }
    return c.body(null, 204);
  },
);

const STATE_COOKIE = "github_install_state";
const STATE_COOKIE_PATH = "/api/github";

app.get("/api/github/connect", (c) => {
  const state = crypto.randomUUID();
  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "Lax",
    secure: new URL(c.req.url).protocol === "https:",
    path: STATE_COOKIE_PATH,
    maxAge: 600,
  });
  return c.redirect(
    `https://github.com/apps/${c.env.GITHUB_APP_SLUG}/installations/new?state=${state}`,
  );
});

app.get("/api/github/callback", async (c) => {
  const expectedState = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: STATE_COOKIE_PATH });

  const reject = (
    reason: string,
    outcome: "error" | "unsupported" = "error",
  ) => {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "github connect rejected",
        reason,
        requestId: c.get("requestId"),
      }),
    );
    return c.redirect(`/dashboard/repositories?github=${outcome}`);
  };

  const state = c.req.query("state");
  const code = c.req.query("code");
  const installationId = Number(c.req.query("installation_id"));

  if (!expectedState || state !== expectedState) {
    return reject("state_mismatch");
  }
  if (!code || !Number.isInteger(installationId)) {
    return reject("missing_code_or_installation");
  }

  try {
    const userToken = await exchangeCodeForUserToken(c.env, code);
    const [installations, githubLogin] = await Promise.all([
      listUserInstallations(userToken),
      getUserLogin(userToken),
    ]);
    const match = installations.find((i) => i.id === installationId);
    if (!match) {
      return reject("installation_not_accessible");
    }
    // GitHub also lists installations the user merely collaborates on, or can
    // reach through an organization. Until we can check access per repository,
    // only the user's own personal account may be connected.
    const isOwnPersonalAccount =
      match.accountType === "User" &&
      match.accountLogin.toLowerCase() === githubLogin.toLowerCase();
    if (!isOwnPersonalAccount) {
      return reject("installation_not_personal", "unsupported");
    }
    await c.get("data").installations.upsert({
      installationId: match.id,
      accountLogin: match.accountLogin,
    });
  } catch (error) {
    return reject(error instanceof Error ? error.message : "unknown");
  }

  return c.redirect("/dashboard/repositories?github=connected");
});

// The repositories GitHub shares with Relay through the caller's own
// installations. Only installations the caller linked are ever asked about.
app.get("/api/github/repositories", async (c) => {
  const installations = await c.get("data").installations.list();
  const perInstallation = await Promise.all(
    installations.map(async (installation) => {
      const repos = await listInstallationRepositories(
        c.env,
        installation.installationId,
      );
      return repos.map((repo) => ({
        ...repo,
        installationId: installation.installationId,
      }));
    }),
  );
  return c.json({ items: perInstallation.flat() });
});

const installationEvent = z.object({
  action: z.string(),
  installation: z.object({ id: z.number() }),
});

const installationRepositoriesEvent = z.object({
  action: z.string(),
  installation: z.object({ id: z.number() }),
  repositories_removed: z.array(z.object({ id: z.number() })).default([]),
});

// Public route: GitHub has no session, so the signature is the only credential.
app.post(
  "/api/webhooks/github",
  bodyLimit({ maxSize: 2 * 1024 * 1024 }),
  async (c) => {
    // Verify against the exact bytes GitHub sent, before parsing anything.
    const body = await c.req.text();
    const valid = await verifyWebhookSignature(
      c.env.GITHUB_WEBHOOK_SECRET,
      body,
      c.req.header("x-hub-signature-256"),
    );
    if (!valid) {
      return c.json({ error: "Invalid signature" }, 401);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const event = c.req.header("x-github-event");
    const db = c.get("db");
    let action: string | undefined;
    let handled = false;

    if (event === "installation") {
      const parsed = installationEvent.safeParse(payload);
      if (!parsed.success) {
        return c.json({ error: "Unexpected payload" }, 400);
      }
      action = parsed.data.action;
      if (action === "deleted") {
        await removeInstallation(db, parsed.data.installation.id);
        handled = true;
      }
    } else if (event === "installation_repositories") {
      const parsed = installationRepositoriesEvent.safeParse(payload);
      if (!parsed.success) {
        return c.json({ error: "Unexpected payload" }, 400);
      }
      action = parsed.data.action;
      if (action === "removed") {
        await removeProjectsForRepos(
          db,
          parsed.data.installation.id,
          parsed.data.repositories_removed.map((repo) => repo.id),
        );
        handled = true;
      }
    }

    console.log(
      JSON.stringify({
        level: "info",
        message: "github webhook",
        requestId: c.get("requestId"),
        delivery: c.req.header("x-github-delivery"),
        event,
        action,
        handled,
      }),
    );
    return c.json({ ok: true });
  },
);

export default app;
