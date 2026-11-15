import { type Db, schema } from "@relay/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { sendEmail } from "./email.ts";

export function createAuth(env: Env, db: Db) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      disableOriginCheck: false,
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(env, {
          to: user.email,
          subject: "Reset your Relay password",
          html: `<p>Use the link below to choose a new password.</p><p><a href="${url}">Reset password</a></p><p>If you did not ask for this, ignore this email.</p>`,
        });
      },
      onExistingUserSignUp: async ({ user }) => {
        await sendEmail(env, {
          to: user.email,
          subject: "You already have a Relay account",
          html: `<p>Someone tried to create a Relay account with this address. If it was you, <a href="${env.BETTER_AUTH_URL}/login">log in</a> or <a href="${env.BETTER_AUTH_URL}/forgot-password">reset your password</a>.</p>`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail(env, {
          to: user.email,
          subject: "Verify your Relay email",
          html: `<p>Use the link below to verify your email.</p><p><a href="${url}">Verify email</a></p>`,
        });
      },
    },
  });
}
