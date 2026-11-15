import { createDb, scopedDb } from "@relay/db";
import app from "./index.ts";

export const env: Env = {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
  BETTER_AUTH_URL: "http://localhost:5173",
  RESEND_API_KEY: "unused",
  EMAIL_FROM: "Relay <onboarding@resend.dev>",
  SENTRY_DSN: "",
  GITHUB_APP_CLIENT_ID: "test-client-id",
  GITHUB_APP_CLIENT_SECRET: "test-client-secret",
  GITHUB_APP_PRIVATE_KEY: "",
  GITHUB_APP_SLUG: "t1-relay-dev",
  GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
};

export function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = { origin: "http://localhost:5173" },
) {
  return app.request(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
    env,
  );
}

export function newUser() {
  return {
    name: "Test User",
    email: `${crypto.randomUUID()}@example.com`,
    password: "correct-horse-battery",
  };
}

// Registers a user, marks the email verified directly in the database
// (the email link flow is already covered by auth.test.ts), logs in, and
// returns the session cookie.
export async function signUpAndLogIn() {
  const user = newUser();
  await post("/api/auth/sign-up/email", user);

  const db = createDb(env.DATABASE_URL);
  await db.$client`update "user" set email_verified = true where email = ${user.email}`;
  await db.$client.end();

  const res = await post("/api/auth/sign-in/email", {
    email: user.email,
    password: user.password,
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

export async function userIdOf(cookie: string) {
  const res = await app.request(
    "/api/auth/get-session",
    { headers: { cookie } },
    env,
  );
  const body = (await res.json()) as { user: { id: string } };
  return body.user.id;
}

// GitHub ids are plain numbers. Random ones keep tests from colliding, because
// webhooks act on an installation id across every user.
export function randomGithubId() {
  return Math.floor(Math.random() * 1_000_000_000) + 1_000_000;
}

// Links an installation to a user straight in the database (the GitHub side
// is covered by github.test.ts) and returns its id.
export async function seedInstallation(userId: string) {
  const db = createDb(env.DATABASE_URL);
  try {
    const installationId = randomGithubId();
    await scopedDb(db, userId).installations.upsert({
      installationId,
      accountLogin: "octocat",
    });
    return installationId;
  } finally {
    await db.$client.end();
  }
}

// Gives a user a linked installation and one connected project.
export async function seedProject(userId: string, repoFullName = "acme/web") {
  const installationId = await seedInstallation(userId);
  const db = createDb(env.DATABASE_URL);
  try {
    const data = scopedDb(db, userId);
    const created = await data.projects.create({
      installationId,
      githubRepoId: randomGithubId(),
      repoFullName,
      defaultBranch: "main",
    });
    if (!created) throw new Error("seedProject: the project was not created");
    return created;
  } finally {
    await db.$client.end();
  }
}
