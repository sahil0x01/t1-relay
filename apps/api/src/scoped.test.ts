import { randomUUID } from "node:crypto";
import { createDb, removeInstallation, schema, scopedDb } from "@relay/db";
import { afterAll, expect, test } from "vitest";
import { randomGithubId, seedProject } from "./test-helpers.ts";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is not set");
const db = createDb(url);

afterAll(() => db.$client.end());

async function createUser() {
  const id = randomUUID();
  await db
    .insert(schema.user)
    .values({ id, name: "Test", email: `${id}@example.com` });
  return id;
}

const input = { prompt: "do a thing", model: "sonnet" };

test("a user only sees their own runs", async () => {
  const a = await createUser();
  const b = await createUser();
  const projectA = await seedProject(a);
  const projectB = await seedProject(b);
  await scopedDb(db, a).runs.create({ ...input, projectId: projectA.id });
  await scopedDb(db, a).runs.create({ ...input, projectId: projectA.id });
  await scopedDb(db, b).runs.create({ ...input, projectId: projectB.id });

  const forA = await scopedDb(db, a).runs.list({ limit: 10 });
  const forB = await scopedDb(db, b).runs.list({ limit: 10 });

  expect(forA.items).toHaveLength(2);
  expect(forA.items.every((r) => r.userId === a)).toBe(true);
  expect(forB.items).toHaveLength(1);
});

test("list is newest first and pages without gaps or overlap", async () => {
  const a = await createUser();
  const project = await seedProject(a);
  const data = scopedDb(db, a);
  for (const n of [1, 2, 3, 4, 5]) {
    await data.runs.create({
      ...input,
      projectId: project.id,
      prompt: `run ${n}`,
    });
  }

  const page1 = await data.runs.list({ limit: 2 });
  expect(page1.items.map((r) => r.prompt)).toEqual(["run 5", "run 4"]);
  expect(page1.nextCursor).not.toBeNull();

  const page2 = await data.runs.list({
    limit: 2,
    cursor: page1.nextCursor ?? undefined,
  });
  expect(page2.items.map((r) => r.prompt)).toEqual(["run 3", "run 2"]);

  const page3 = await data.runs.list({
    limit: 2,
    cursor: page2.nextCursor ?? undefined,
  });
  expect(page3.items.map((r) => r.prompt)).toEqual(["run 1"]);
  expect(page3.nextCursor).toBeNull();
});

test("a run copies the project's repository and default branch", async () => {
  const a = await createUser();
  const project = await seedProject(a, "acme/api");
  const data = scopedDb(db, a);

  const plain = await data.runs.create({ ...input, projectId: project.id });
  const onBranch = await data.runs.create({
    ...input,
    projectId: project.id,
    branch: "develop",
  });

  expect(plain).toMatchObject({
    projectId: project.id,
    repo: "acme/api",
    branch: "main",
  });
  expect(onBranch?.branch).toBe("develop");
});

test("create cannot be pointed at another user's project", async () => {
  const a = await createUser();
  const b = await createUser();
  const projectOfB = await seedProject(b);

  const created = await scopedDb(db, a).runs.create({
    ...input,
    projectId: projectOfB.id,
  });

  expect(created).toBeNull();
  expect((await scopedDb(db, b).runs.list({ limit: 10 })).items).toHaveLength(
    0,
  );
});

test("create cannot be pointed at another user", async () => {
  const a = await createUser();
  const b = await createUser();
  const project = await seedProject(a);
  const sneaky = { ...input, projectId: project.id, userId: b };

  const created = await scopedDb(db, a).runs.create(sneaky);

  expect(created?.userId).toBe(a);
});

test("a user only sees their own installations", async () => {
  const a = await createUser();
  const b = await createUser();
  await scopedDb(db, a).installations.upsert({
    installationId: 1001,
    accountLogin: "octocat",
  });

  expect(await scopedDb(db, a).installations.list()).toHaveLength(1);
  expect(await scopedDb(db, b).installations.list()).toHaveLength(0);
});

test("linking the same installation twice keeps one row and updates the login", async () => {
  const a = await createUser();
  const data = scopedDb(db, a);
  await data.installations.upsert({
    installationId: 1001,
    accountLogin: "old-name",
  });
  await data.installations.upsert({
    installationId: 1001,
    accountLogin: "new-name",
  });

  const rows = await data.installations.list();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.accountLogin).toBe("new-name");
});

test("a user only sees their own projects", async () => {
  const a = await createUser();
  const b = await createUser();
  await seedProject(a, "acme/a");
  await seedProject(b, "acme/b");

  const forA = await scopedDb(db, a).projects.list();

  expect(forA.map((p) => p.repoFullName)).toEqual(["acme/a"]);
});

test("connecting the same repository twice returns null the second time", async () => {
  const a = await createUser();
  const data = scopedDb(db, a);
  const installationId = randomGithubId();
  const githubRepoId = randomGithubId();
  await data.installations.upsert({ installationId, accountLogin: "octocat" });
  const repo = {
    installationId,
    githubRepoId,
    repoFullName: "acme/web",
    defaultBranch: "main",
  };

  expect(await data.projects.create(repo)).not.toBeNull();
  expect(await data.projects.create(repo)).toBeNull();
  expect(await data.projects.list()).toHaveLength(1);
});

test("a project cannot use an installation the user has not linked", async () => {
  const a = await createUser();
  const b = await createUser();
  const projectOfB = await seedProject(b);

  // The database itself refuses it: the composite foreign key ties a project's
  // installation to the same user.
  await expect(
    scopedDb(db, a).projects.create({
      installationId: projectOfB.installationId,
      githubRepoId: randomGithubId(),
      repoFullName: "acme/stolen",
      defaultBranch: "main",
    }),
  ).rejects.toThrow();
});

test("a user can only remove their own project", async () => {
  const a = await createUser();
  const b = await createUser();
  const project = await seedProject(a);

  expect(await scopedDb(db, b).projects.remove(project.id)).toBe(false);
  expect(await scopedDb(db, a).projects.list()).toHaveLength(1);
  expect(await scopedDb(db, a).projects.remove(project.id)).toBe(true);
  expect(await scopedDb(db, a).projects.list()).toHaveLength(0);
});

test("runs keep their history when the project is removed or uninstalled", async () => {
  const a = await createUser();
  const first = await seedProject(a, "acme/first");
  const second = await seedProject(a, "acme/second");
  const data = scopedDb(db, a);
  await data.runs.create({ ...input, projectId: first.id, prompt: "one" });
  await data.runs.create({ ...input, projectId: second.id, prompt: "two" });

  await data.projects.remove(first.id);
  await removeInstallation(db, second.installationId);

  const { items } = await data.runs.list({ limit: 10 });
  expect(items).toHaveLength(2);
  expect(items.every((r) => r.projectId === null)).toBe(true);
  expect(items.map((r) => r.repo).sort()).toEqual([
    "acme/first",
    "acme/second",
  ]);
});
