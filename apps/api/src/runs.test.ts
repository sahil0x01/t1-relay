import { describe, expect, it, vi } from "vitest";
import app from "./index.ts";
import { env, signUpAndLogIn } from "./test-helpers.ts";

vi.mock("./email.ts", () => ({ sendEmail: vi.fn() }));

const body = {
  prompt: "Fix the flaky test",
  repo: "acme/web",
  branch: "main",
  model: "sonnet",
};

type RunList = { items: { prompt: string }[]; nextCursor: string | null };

function createRun(
  cookie: string | undefined,
  payload: unknown = body,
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
    expect((await listRuns(undefined)).status).toBe(401);
    expect((await createRun(undefined)).status).toBe(401);
    expect((await listRuns("better-auth.session_token=garbage")).status).toBe(
      401,
    );
  });

  it("creates a queued run for the logged-in user", async () => {
    const cookie = await signUpAndLogIn();

    const res = await createRun(cookie);

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ...body, status: "queued" });
  });

  it("ignores a userId sent in the body", async () => {
    const cookie = await signUpAndLogIn();
    const session = await app.request(
      "/api/auth/get-session",
      { headers: { cookie } },
      env,
    );
    const { user } = (await session.json()) as { user: { id: string } };

    const res = await createRun(cookie, { ...body, userId: "someone-else" });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ userId: user.id });
  });

  it("only lists the caller's own runs", async () => {
    const a = await signUpAndLogIn();
    const b = await signUpAndLogIn();
    await createRun(a, { ...body, prompt: "a one" });
    await createRun(a, { ...body, prompt: "a two" });
    await createRun(b, { ...body, prompt: "b one" });

    const list = (await (await listRuns(a)).json()) as RunList;

    expect(list.items.map((r) => r.prompt)).toEqual(["a two", "a one"]);
  });

  it("pages with a cursor", async () => {
    const cookie = await signUpAndLogIn();
    for (const n of [1, 2, 3]) {
      await createRun(cookie, { ...body, prompt: `run ${n}` });
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
    const cookie = await signUpAndLogIn();

    expect((await createRun(cookie, { ...body, prompt: "   " })).status).toBe(
      400,
    );
    expect((await createRun(cookie, { prompt: "only a prompt" })).status).toBe(
      400,
    );
    expect((await listRuns(cookie, "?limit=1000")).status).toBe(400);
    expect((await listRuns(cookie, "?cursor=not-a-uuid")).status).toBe(400);
  });

  it("refuses a body that is not sent as JSON", async () => {
    const cookie = await signUpAndLogIn();

    const res = await createRun(cookie, body, "text/plain");

    expect(res.status).toBe(400);
  });
});
