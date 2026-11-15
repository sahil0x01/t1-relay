import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "./index.ts";
import { env, signUpAndLogIn } from "./test-helpers.ts";

vi.mock("./email.ts", () => ({ sendEmail: vi.fn() }));
vi.mock("./github.ts", () => ({
  exchangeCodeForUserToken: vi.fn(),
  getUserLogin: vi.fn(),
  listUserInstallations: vi.fn(),
  listInstallationRepositories: vi.fn(),
}));

import {
  exchangeCodeForUserToken,
  getUserLogin,
  listInstallationRepositories,
  listUserInstallations,
} from "./github.ts";

const exchange = vi.mocked(exchangeCodeForUserToken);
const githubLogin = vi.mocked(getUserLogin);
const listAccessible = vi.mocked(listUserInstallations);
const listRepos = vi.mocked(listInstallationRepositories);

type InstallationList = {
  items: { installationId: number; accountLogin: string }[];
};

const personal = { id: 4242, accountLogin: "octocat", accountType: "User" };

function githubSays(
  installations: { id: number; accountLogin: string; accountType: string }[] = [
    personal,
  ],
  login = "octocat",
) {
  exchange.mockResolvedValue("user-token");
  githubLogin.mockResolvedValue(login);
  listAccessible.mockResolvedValue(installations);
}

async function startConnect(sessionCookie: string) {
  const res = await app.request(
    "/api/github/connect",
    { headers: { cookie: sessionCookie } },
    env,
  );
  const setCookie = res.headers.get("set-cookie") ?? "";
  const stateCookie = setCookie.split(";")[0] ?? "";
  const state = stateCookie.split("=")[1] ?? "";
  return { res, setCookie, stateCookie, state };
}

function callback(
  sessionCookie: string,
  stateCookie: string,
  query: Record<string, string>,
) {
  const qs = new URLSearchParams(query).toString();
  return app.request(
    `/api/github/callback?${qs}`,
    { headers: { cookie: `${sessionCookie}; ${stateCookie}` } },
    env,
  );
}

async function link(sessionCookie: string, installationId: number) {
  const { stateCookie, state } = await startConnect(sessionCookie);
  return callback(sessionCookie, stateCookie, {
    code: "one-time-code",
    installation_id: String(installationId),
    setup_action: "install",
    state,
  });
}

async function installationsOf(sessionCookie: string) {
  const res = await app.request(
    "/api/installations",
    { headers: { cookie: sessionCookie } },
    env,
  );
  return (await res.json()) as InstallationList;
}

describe("connecting GitHub", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("requires a login", async () => {
    expect((await app.request("/api/github/connect", {}, env)).status).toBe(
      401,
    );
    expect((await app.request("/api/installations", {}, env)).status).toBe(401);
  });

  it("sends the user to GitHub with a state that matches a safe cookie", async () => {
    const cookie = await signUpAndLogIn();

    const { res, setCookie, state } = await startConnect(cookie);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new?state=${state}`,
    );
    expect(state.length).toBeGreaterThan(20);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/api/github");
  });

  it("links the installation when GitHub confirms it is the user's own account", async () => {
    const cookie = await signUpAndLogIn();
    githubSays();

    const res = await link(cookie, 4242);

    expect(res.headers.get("location")).toBe(
      "/dashboard/repositories?github=connected",
    );
    expect(exchange).toHaveBeenCalledWith(env, "one-time-code");
    expect(listAccessible).toHaveBeenCalledWith("user-token");
    const { items } = await installationsOf(cookie);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      installationId: 4242,
      accountLogin: "octocat",
    });
  });

  it("compares the account and login ignoring case", async () => {
    const cookie = await signUpAndLogIn();
    githubSays([{ ...personal, accountLogin: "OctoCat" }]);

    const res = await link(cookie, 4242);

    expect(res.headers.get("location")).toBe(
      "/dashboard/repositories?github=connected",
    );
  });

  it("refuses an installation id that GitHub does not list for this user", async () => {
    const cookie = await signUpAndLogIn();
    githubSays([{ id: 1, accountLogin: "octocat", accountType: "User" }]);

    const res = await link(cookie, 2);

    expect(res.headers.get("location")).toBe(
      "/dashboard/repositories?github=error",
    );
    expect((await installationsOf(cookie)).items).toHaveLength(0);
  });

  it("refuses an installation on an organization", async () => {
    const cookie = await signUpAndLogIn();
    githubSays([
      { id: 4242, accountLogin: "acme", accountType: "Organization" },
    ]);

    const res = await link(cookie, 4242);

    expect(res.headers.get("location")).toBe(
      "/dashboard/repositories?github=unsupported",
    );
    expect((await installationsOf(cookie)).items).toHaveLength(0);
  });

  it("refuses somebody else's personal account that the user only collaborates on", async () => {
    const cookie = await signUpAndLogIn();
    githubSays(
      [{ id: 4242, accountLogin: "alice", accountType: "User" }],
      "bob",
    );

    const res = await link(cookie, 4242);

    expect(res.headers.get("location")).toBe(
      "/dashboard/repositories?github=unsupported",
    );
    expect((await installationsOf(cookie)).items).toHaveLength(0);
  });

  it("refuses a callback whose state does not match the cookie", async () => {
    const cookie = await signUpAndLogIn();
    const { stateCookie } = await startConnect(cookie);

    const res = await callback(cookie, stateCookie, {
      code: "one-time-code",
      installation_id: "4242",
      state: "someone-elses-state",
    });

    expect(res.headers.get("location")).toBe(
      "/dashboard/repositories?github=error",
    );
    expect(exchange).not.toHaveBeenCalled();
  });

  it("refuses a callback that has no state cookie at all", async () => {
    const cookie = await signUpAndLogIn();

    const res = await callback(cookie, "unrelated=1", {
      code: "one-time-code",
      installation_id: "4242",
      state: "anything",
    });

    expect(res.headers.get("location")).toBe(
      "/dashboard/repositories?github=error",
    );
    expect(exchange).not.toHaveBeenCalled();
  });

  it("sends the user back with an error, not a crash, when GitHub fails", async () => {
    const cookie = await signUpAndLogIn();
    exchange.mockRejectedValue(new Error("GitHub token exchange failed: x"));

    const res = await link(cookie, 4242);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "/dashboard/repositories?github=error",
    );
    expect((await installationsOf(cookie)).items).toHaveLength(0);
  });

  it("keeps one row when the same installation is linked twice", async () => {
    const cookie = await signUpAndLogIn();
    githubSays();

    await link(cookie, 4242);
    await link(cookie, 4242);

    expect((await installationsOf(cookie)).items).toHaveLength(1);
  });

  it("never shows one user's installation to another", async () => {
    const a = await signUpAndLogIn();
    const b = await signUpAndLogIn();
    githubSays();
    await link(a, 4242);

    expect((await installationsOf(a)).items).toHaveLength(1);
    expect((await installationsOf(b)).items).toHaveLength(0);
  });
});

describe("listing repositories", () => {
  const repo = (id: number, fullName: string) => ({
    id,
    fullName,
    defaultBranch: "main",
    isPrivate: true,
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("requires a login", async () => {
    expect(
      (await app.request("/api/github/repositories", {}, env)).status,
    ).toBe(401);
  });

  it("lists the repositories of each of the user's installations", async () => {
    const cookie = await signUpAndLogIn();
    githubSays([
      { id: 4242, accountLogin: "octocat", accountType: "User" },
      { id: 4343, accountLogin: "octocat", accountType: "User" },
    ]);
    await link(cookie, 4242);
    await link(cookie, 4343);
    listRepos.mockImplementation(async (_env, installationId) =>
      installationId === 4242
        ? [repo(1, "octocat/first")]
        : [repo(2, "octocat/second")],
    );

    const res = await app.request(
      "/api/github/repositories",
      { headers: { cookie } },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { id: number; fullName: string; installationId: number }[];
    };
    expect(body.items).toHaveLength(2);
    expect(body.items).toContainEqual(
      expect.objectContaining({
        fullName: "octocat/first",
        installationId: 4242,
      }),
    );
    expect(body.items).toContainEqual(
      expect.objectContaining({
        fullName: "octocat/second",
        installationId: 4343,
      }),
    );
  });

  it("never asks GitHub about an installation the caller has not linked", async () => {
    const cookie = await signUpAndLogIn();

    const res = await app.request(
      "/api/github/repositories",
      { headers: { cookie } },
      env,
    );

    expect(await res.json()).toEqual({ items: [] });
    expect(listRepos).not.toHaveBeenCalled();
  });
});
