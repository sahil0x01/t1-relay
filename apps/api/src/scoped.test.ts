import { randomUUID } from "node:crypto";
import { createDb, schema, scopedDb } from "@relay/db";
import { afterAll, expect, test } from "vitest";

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

const input = {
  prompt: "do a thing",
  repo: "acme/web",
  branch: "main",
  model: "sonnet",
};

test("a user only sees their own runs", async () => {
  const a = await createUser();
  const b = await createUser();
  await scopedDb(db, a).runs.create(input);
  await scopedDb(db, a).runs.create(input);
  await scopedDb(db, b).runs.create(input);

  const forA = await scopedDb(db, a).runs.list({ limit: 10 });
  const forB = await scopedDb(db, b).runs.list({ limit: 10 });

  expect(forA.items).toHaveLength(2);
  expect(forA.items.every((r) => r.userId === a)).toBe(true);
  expect(forB.items).toHaveLength(1);
});

test("list is newest first and pages without gaps or overlap", async () => {
  const a = await createUser();
  const data = scopedDb(db, a);
  for (const n of [1, 2, 3, 4, 5]) {
    await data.runs.create({ ...input, prompt: `run ${n}` });
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

test("create cannot be pointed at another user", async () => {
  const a = await createUser();
  const b = await createUser();
  const sneaky = { ...input, userId: b };

  const created = await scopedDb(db, a).runs.create(sneaky);

  expect(created.userId).toBe(a);
});
