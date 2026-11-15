import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "./index.ts";
import { env, newUser, post } from "./test-helpers.ts";

vi.mock("./email.ts", () => ({ sendEmail: vi.fn() }));

import { sendEmail } from "./email.ts";

const sendEmailMock = vi.mocked(sendEmail);

function linkFromLastEmail() {
  const html = sendEmailMock.mock.calls.at(-1)?.[1].html ?? "";
  const href = /href="([^"]+)"/.exec(html)?.[1];
  if (!href) {
    throw new Error("The last email has no link");
  }
  const url = new URL(href);
  return url.pathname + url.search;
}

describe("sign-up and login", () => {
  beforeEach(() => {
    sendEmailMock.mockClear();
  });

  it("rejects a sign-up that comes from another website", async () => {
    const res = await post("/api/auth/sign-up/email", newUser(), {
      origin: "https://evil.example",
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "INVALID_ORIGIN" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("rejects a browser-style request that has no Origin", async () => {
    const res = await post("/api/auth/sign-up/email", newUser(), {
      "sec-fetch-mode": "cors",
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "MISSING_OR_NULL_ORIGIN" });
  });

  it("creates the user and emails a verification link", async () => {
    const user = newUser();
    const res = await post("/api/auth/sign-up/email", user);

    expect(res.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0]?.[1]).toMatchObject({
      to: user.email,
      subject: "Verify your Relay email",
    });
  });

  it("refuses login until the email is verified", async () => {
    const user = newUser();
    await post("/api/auth/sign-up/email", user);

    const res = await post("/api/auth/sign-in/email", {
      email: user.email,
      password: user.password,
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
  });

  it("lets a verified user log in and sets a safe session cookie", async () => {
    const user = newUser();
    await post("/api/auth/sign-up/email", user);

    const verify = await app.request(linkFromLastEmail(), {}, env);
    expect(verify.status).toBe(302);

    const res = await post("/api/auth/sign-in/email", {
      email: user.email,
      password: user.password,
    });

    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("better-auth.session_token=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("answers a repeated sign-up like the first and warns the owner", async () => {
    const user = newUser();
    const first = await post("/api/auth/sign-up/email", user);
    sendEmailMock.mockClear();

    const second = await post("/api/auth/sign-up/email", {
      ...user,
      name: "Someone Else",
    });

    expect(second.status).toBe(200);
    const firstBody = (await first.json()) as { user: Record<string, unknown> };
    const secondBody = (await second.json()) as {
      user: Record<string, unknown>;
    };
    expect(Object.keys(secondBody.user).sort()).toEqual(
      Object.keys(firstBody.user).sort(),
    );
    await vi.waitFor(() => {
      expect(sendEmailMock).toHaveBeenCalledTimes(1);
    });
    expect(sendEmailMock.mock.calls[0]?.[1]).toMatchObject({
      to: user.email,
      subject: "You already have a Relay account",
    });
  });
});

describe("password reset", () => {
  beforeEach(() => {
    sendEmailMock.mockClear();
  });

  it("resets the password, ends other sessions, and works only once", async () => {
    const user = newUser();
    await post("/api/auth/sign-up/email", user);
    await app.request(linkFromLastEmail(), {}, env);

    const login = await post("/api/auth/sign-in/email", {
      email: user.email,
      password: user.password,
    });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

    sendEmailMock.mockClear();
    const request = await post("/api/auth/request-password-reset", {
      email: user.email,
      redirectTo: "/reset-password",
    });
    expect(request.status).toBe(200);
    await vi.waitFor(() => {
      expect(sendEmailMock).toHaveBeenCalledTimes(1);
    });

    const redirect = await app.request(linkFromLastEmail(), {}, env);
    const location = redirect.headers.get("location") ?? "";
    const token = new URL(location, "http://localhost:5173").searchParams.get(
      "token",
    );
    expect(token).toBeTruthy();

    const newPassword = "a-brand-new-password-123";
    const reset = await post("/api/auth/reset-password", {
      newPassword,
      token,
    });
    expect(reset.status).toBe(200);

    const session = await app.request(
      "/api/auth/get-session",
      { headers: { cookie } },
      env,
    );
    expect(await session.json()).toBeNull();

    const oldLogin = await post("/api/auth/sign-in/email", {
      email: user.email,
      password: user.password,
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await post("/api/auth/sign-in/email", {
      email: user.email,
      password: newPassword,
    });
    expect(newLogin.status).toBe(200);

    const again = await post("/api/auth/reset-password", {
      newPassword: "another-password-456",
      token,
    });
    expect(again.status).toBe(400);
  });
});
