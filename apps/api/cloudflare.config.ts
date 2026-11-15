import { bindings, defineConfig, triggers } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
  worker: {
    name: "api",
    compatibilityDate: "2026-10-06",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint,
    env: {
      DATABASE_URL: bindings.secret(),
      BETTER_AUTH_SECRET: bindings.secret(),
      BETTER_AUTH_URL: bindings.text("http://localhost:5173"),
      RESEND_API_KEY: bindings.secret(),
      EMAIL_FROM: bindings.text("Relay <onboarding@resend.dev>"),
      SENTRY_DSN: bindings.secret(),
      GITHUB_APP_CLIENT_ID: bindings.secret(),
      GITHUB_APP_CLIENT_SECRET: bindings.secret(),
      GITHUB_APP_PRIVATE_KEY: bindings.secret(),
      GITHUB_APP_SLUG: bindings.text("t1-relay-dev"),
      GITHUB_WEBHOOK_SECRET: bindings.secret(),
    },
    triggers: [triggers.fetch({ pattern: "relay.transistorone.com/api/*" })],
  },
});
