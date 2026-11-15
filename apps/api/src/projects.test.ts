import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "./index.ts";
import {
  env,
  seedInstallation,
  seedProject,
  signUpAndLogIn,
  userIdOf,
} from "./test-helpers.ts";

vi.mock("./email.ts", () => ({ sendEmail: vi.fn() }));
vi.mock("./github.ts", () => ({
  exchangeCodeForUserToken: vi.fn(),
  getUserLogin: vi.fn(),
  listUserInstallations: vi.fn(),
  listInstallationRepositories: vi.fn(),
}));

import { listInstallationRepositories } from "./github.ts";

const listRepos = vi.mocked(listInstallationRepositories);

type Project = {
  id: string;
  installationId: number;
  githubRepoId: number;
  repoFullName: string;
  defaultBranch: string;
};

function request(path: string, cookie?: string, init: RequestInit = {}) {
  return app.request(
    path,
    { ...init, headers: { ...(cookie ? { cookie } : {}), ...init.headers } },
    env,
  );
}

function connect(cookie: string | undefined, payload: unknown) {
  return request("/api/projects", cookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function disconnect(cookie: string | undefined, id: string) {
  return request(`/api/projects/${id}`, cookie, { method: "DELETE" });
}

async function projectsOf(cookie: string) {
  const res = await request("/api/projects", cookie);
  return ((await res.json()) as { items: Project[] }).items;
}

const repo = (id: number, fullName = "octocat/hello", branch = "trunk") => ({
  id,
  fullName,
  defaultBranch: branch,
  isPrivate: true,
});

describe("projects API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("requires a login", async () => {
    const id = crypto.randomUUID();
    expect((await request("/api/projects")).status).toBe(401);
    expect(
      (await connect(undefined, { installationId: 1, githubRepoId: 1 })).status,
    ).toBe(401);
    expect((await disconnect(undefined, id)).status).toBe(401);
  });

  it("connects a repository using the name and branch GitHub reports", async () => {
    const cookie = await signUpAndLogIn();
    const installationId = await seedInstallation(await userIdOf(cookie));
    listRepos.mockResolvedValue([repo(77, "octocat/hello", "trunk")]);

    const res = await connect(cookie, { installationId, githubRepoId: 77 });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      installationId,
      githubRepoId: 77,
      repoFullName: "octocat/hello",
      defaultBranch: "trunk",
    });
    expect(listRepos).toHaveBeenCalledWith(env, installationId);
    expect(await projectsOf(cookie)).toHaveLength(1);
  });

  it("ignores a repository name sent by the client", async () => {
    const cookie = await signUpAndLogIn();
    const installationId = await seedInstallation(await userIdOf(cookie));
    listRepos.mockResolvedValue([repo(77, "octocat/hello")]);

    const res = await connect(cookie, {
      installationId,
      githubRepoId: 77,
      repoFullName: "evil/repo",
      defaultBranch: "evil",
    });

    expect(await res.json()).toMatchObject({ repoFullName: "octocat/hello" });
  });

  it("refuses an installation the caller has not linked, without asking GitHub", async () => {
    const owner = await signUpAndLogIn();
    const installationId = await seedInstallation(await userIdOf(owner));
    const intruder = await signUpAndLogIn();

    const res = await connect(intruder, { installationId, githubRepoId: 77 });

    expect(res.status).toBe(404);
    expect(listRepos).not.toHaveBeenCalled();
    expect(await projectsOf(intruder)).toEqual([]);
  });

  it("refuses a repository the installation cannot see", async () => {
    const cookie = await signUpAndLogIn();
    const installationId = await seedInstallation(await userIdOf(cookie));
    listRepos.mockResolvedValue([repo(1)]);

    const res = await connect(cookie, { installationId, githubRepoId: 999 });

    expect(res.status).toBe(404);
    expect(await projectsOf(cookie)).toEqual([]);
  });

  it("answers 409 when the repository is already connected", async () => {
    const cookie = await signUpAndLogIn();
    const installationId = await seedInstallation(await userIdOf(cookie));
    listRepos.mockResolvedValue([repo(77)]);

    const first = await connect(cookie, { installationId, githubRepoId: 77 });
    const second = await connect(cookie, { installationId, githubRepoId: 77 });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(await projectsOf(cookie)).toHaveLength(1);
  });

  it("only lists the caller's own projects", async () => {
    const a = await signUpAndLogIn();
    const b = await signUpAndLogIn();
    await seedProject(await userIdOf(a), "acme/a");
    await seedProject(await userIdOf(b), "acme/b");

    const projects = await projectsOf(a);

    expect(projects.map((p) => p.repoFullName)).toEqual(["acme/a"]);
  });

  it("disconnects a project", async () => {
    const cookie = await signUpAndLogIn();
    const project = await seedProject(await userIdOf(cookie));

    const res = await disconnect(cookie, project.id);

    expect(res.status).toBe(204);
    expect(await projectsOf(cookie)).toEqual([]);
  });

  it("cannot disconnect someone else's project", async () => {
    const owner = await signUpAndLogIn();
    const intruder = await signUpAndLogIn();
    const project = await seedProject(await userIdOf(owner));

    const res = await disconnect(intruder, project.id);

    expect(res.status).toBe(404);
    expect(await projectsOf(owner)).toHaveLength(1);
  });

  it("rejects bad input with 400", async () => {
    const cookie = await signUpAndLogIn();

    expect((await connect(cookie, { installationId: 1 })).status).toBe(400);
    expect(
      (await connect(cookie, { installationId: -5, githubRepoId: 1 })).status,
    ).toBe(400);
    expect(
      (await connect(cookie, { installationId: "1", githubRepoId: 1 })).status,
    ).toBe(400);
    expect((await disconnect(cookie, "not-a-uuid")).status).toBe(400);
  });
});
