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
    },
    triggers: [triggers.fetch({ pattern: "relay.transistorone.com/api/*" })],
  },
});
