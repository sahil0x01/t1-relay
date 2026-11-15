import { createDb } from "@relay/db";
import app from "./index.ts";

export const env: Env = {
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
  BETTER_AUTH_URL: "http://localhost:5173",
  RESEND_API_KEY: "unused",
  EMAIL_FROM: "Relay <onboarding@resend.dev>",
  SENTRY_DSN: "",
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
