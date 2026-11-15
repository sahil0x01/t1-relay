import { describe, expect, it, vi } from "vitest";
import app from "./index.ts";
import { env, seedProject, signUpAndLogIn, userIdOf } from "./test-helpers.ts";

vi.mock("./email.ts", () => ({ sendEmail: vi.fn() }));

const base = { prompt: "Fix the flaky test", model: "sonnet" };

type RunList = {
  items: { prompt: string; projectId: string | null; repo: string }[];
  nextCursor: string | null;
};

async function userWithProject(repoFullName = "acme/web") {
  const cookie = await signUpAndLogIn();
  const project = await seedProject(await userIdOf(cookie), repoFullName);
  return { cookie, project };
}

function createRun(
  cookie: string | undefined,
  payload: unknown,
  contentType = "application/json",
) {
  return app.request(
    "/api/runs",
    {
      method: "POST",
      headers: { "content-type": contentType, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(payload),
    },
    env,
  );
}

function listRuns(cookie: string | undefined, query = "") {
  return app.request(
    `/api/runs${query}`,
    { headers: cookie ? { cookie } : {} },
    env,
  );
}

describe("runs API", () => {
  it("returns 401 without a valid session", async () => {
    const payload = { ...base, projectId: crypto.randomUUID() };
    expect((await listRuns(undefined)).status).toBe(401);
    expect((await createRun(undefined, payload)).status).toBe(401);
    expect((await listRuns("better-auth.session_token=garbage")).status).toBe(
      401,
    );
  });

  it("creates a queued run on one of the user's projects", async () => {
    const { cookie, project } = await userWithProject("acme/web");

    const res = await createRun(cookie, { ...base, projectId: project.id });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      ...base,
      projectId: project.id,
      repo: "acme/web",
      branch: "main",
      status: "queued",
    });
  });

  it("uses the branch the caller chooses", async () => {
    const { cookie, project } = await userWithProject();

    const res = await createRun(cookie, {
      ...base,
      projectId: project.id,
      branch: "develop",
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ branch: "develop" });
  });

  it("ignores a userId sent in the body", async () => {
    const { cookie, project } = await userWithProject();

    const res = await createRun(cookie, {
      ...base,
      projectId: project.id,
      userId: "someone-else",
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ userId: await userIdOf(cookie) });
  });

  it("answers 404 for another user's project and creates nothing", async () => {
    const owner = await userWithProject();
    const intruder = await signUpAndLogIn();

    const res = await createRun(intruder, {
      ...base,
      projectId: owner.project.id,
    });

    expect(res.status).toBe(404);
    expect(
      ((await (await listRuns(intruder)).json()) as RunList).items,
    ).toEqual([]);
    expect(
      ((await (await listRuns(owner.cookie)).json()) as RunList).items,
    ).toEqual([]);
  });

  it("answers 404 for a project that does not exist", async () => {
    const cookie = await signUpAndLogIn();

    const res = await createRun(cookie, {
      ...base,
      projectId: crypto.randomUUID(),
    });

    expect(res.status).toBe(404);
  });

  it("only lists the caller's own runs", async () => {
    const a = await userWithProject();
    const b = await userWithProject();
    await createRun(a.cookie, {
      ...base,
      projectId: a.project.id,
      prompt: "a one",
    });
    await createRun(a.cookie, {
      ...base,
      projectId: a.project.id,
      prompt: "a two",
    });
    await createRun(b.cookie, {
      ...base,
      projectId: b.project.id,
      prompt: "b one",
    });

    const list = (await (await listRuns(a.cookie)).json()) as RunList;

    expect(list.items.map((r) => r.prompt)).toEqual(["a two", "a one"]);
  });

  it("pages with a cursor", async () => {
    const { cookie, project } = await userWithProject();
    for (const n of [1, 2, 3]) {
      await createRun(cookie, {
        ...base,
        projectId: project.id,
        prompt: `run ${n}`,
      });
    }

    const page1 = (await (
      await listRuns(cookie, "?limit=2")
    ).json()) as RunList;
    expect(page1.items.map((r) => r.prompt)).toEqual(["run 3", "run 2"]);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = (await (
      await listRuns(cookie, `?limit=2&cursor=${page1.nextCursor}`)
    ).json()) as RunList;
    expect(page2.items.map((r) => r.prompt)).toEqual(["run 1"]);
    expect(page2.nextCursor).toBeNull();
  });

  it("rejects bad input with 400", async () => {
    const { cookie, project } = await userWithProject();
    const projectId = project.id;

    expect(
      (await createRun(cookie, { ...base, projectId, prompt: "   " })).status,
    ).toBe(400);
    expect((await createRun(cookie, base)).status).toBe(400);
    expect(
      (await createRun(cookie, { ...base, projectId: "not-a-uuid" })).status,
    ).toBe(400);
    expect((await listRuns(cookie, "?limit=1000")).status).toBe(400);
    expect((await listRuns(cookie, "?cursor=not-a-uuid")).status).toBe(400);
  });

  it("refuses a body that is not sent as JSON", async () => {
    const { cookie, project } = await userWithProject();

    const res = await createRun(
      cookie,
      { ...base, projectId: project.id },
      "text/plain",
    );

    expect(res.status).toBe(400);
  });

  it("keeps a run and its repository name when its project is removed", async () => {
    const { cookie, project } = await userWithProject("acme/web");
    await createRun(cookie, { ...base, projectId: project.id });

    const removed = await app.request(
      `/api/projects/${project.id}`,
      { method: "DELETE", headers: { cookie } },
      env,
    );

    expect(removed.status).toBe(204);
    const list = (await (await listRuns(cookie)).json()) as RunList;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ projectId: null, repo: "acme/web" });
  });
});
