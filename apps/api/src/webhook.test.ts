import { createHmac, randomUUID } from "node:crypto";
import { createDb, schema, scopedDb } from "@relay/db";
import { afterAll, describe, expect, it } from "vitest";
import app from "./index.ts";
import { env } from "./test-helpers.ts";
import { verifyWebhookSignature } from "./webhook.ts";

const db = createDb(env.DATABASE_URL);

afterAll(() => db.$client.end());

// Webhooks delete by installation id across all users, so every test uses ids
// no other test touches.
function randomId() {
  return Math.floor(Math.random() * 1_000_000_000) + 1_000_000;
}

async function createUser() {
  const id = randomUUID();
  await db
    .insert(schema.user)
    .values({ id, name: "Test", email: `${id}@example.com` });
  return id;
}

async function linkInstallation(installationId: number) {
  const userId = await createUser();
  await scopedDb(db, userId).installations.upsert({
    installationId,
    accountLogin: "octocat",
  });
  return userId;
}

async function addProject(
  userId: string,
  installationId: number,
  repoId: number,
) {
  await db.$client`insert into project (user_id, installation_id, github_repo_id, repo_full_name, default_branch) values (${userId}, ${installationId}, ${repoId}, 'acme/repo', 'main')`;
}

async function countProjects(installationId: number) {
  const rows =
    await db.$client`select count(*)::int as n from project where installation_id = ${installationId}`;
  return rows[0]?.n as number;
}

function sign(body: string, secret: string = env.GITHUB_WEBHOOK_SECRET) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function deliverRaw(
  event: string,
  body: string,
  headers: Record<string, string>,
) {
  return app.request(
    "/api/webhooks/github",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": event,
        "x-github-delivery": randomUUID(),
        ...headers,
      },
      body,
    },
    env,
  );
}

function deliver(event: string, payload: unknown) {
  const body = JSON.stringify(payload);
  return deliverRaw(event, body, { "x-hub-signature-256": sign(body) });
}

describe("verifyWebhookSignature", () => {
  const body = '{"action":"deleted"}';

  it("accepts the signature GitHub would send", async () => {
    expect(
      await verifyWebhookSignature("secret", body, sign(body, "secret")),
    ).toBe(true);
  });

  it("rejects a changed body, a wrong secret and a missing header", async () => {
    const good = sign(body, "secret");
    expect(await verifyWebhookSignature("secret", `${body} `, good)).toBe(
      false,
    );
    expect(await verifyWebhookSignature("other", body, good)).toBe(false);
    expect(await verifyWebhookSignature("secret", body, undefined)).toBe(false);
  });

  it("rejects malformed headers without throwing", async () => {
    const hex = sign(body, "secret").slice("sha256=".length);
    expect(await verifyWebhookSignature("secret", body, hex)).toBe(false);
    expect(await verifyWebhookSignature("secret", body, `sha1=${hex}`)).toBe(
      false,
    );
    expect(
      await verifyWebhookSignature("secret", body, `sha256=${hex.slice(2)}`),
    ).toBe(false);
    expect(
      await verifyWebhookSignature("secret", body, `sha256=${"z".repeat(64)}`),
    ).toBe(false);
  });
});

describe("POST /api/webhooks/github", () => {
  it("rejects a bad or missing signature and changes nothing", async () => {
    const installationId = randomId();
    const userId = await linkInstallation(installationId);
    const payload = JSON.stringify({
      action: "deleted",
      installation: { id: installationId },
    });

    const wrong = await deliverRaw("installation", payload, {
      "x-hub-signature-256": sign(payload, "not-the-secret"),
    });
    const missing = await deliverRaw("installation", payload, {});

    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(await scopedDb(db, userId).installations.list()).toHaveLength(1);
  });

  it("removes an uninstalled app for every user who linked it, with their projects", async () => {
    const installationId = randomId();
    const first = await linkInstallation(installationId);
    const second = await linkInstallation(installationId);
    await addProject(first, installationId, 1);
    await addProject(second, installationId, 2);

    const res = await deliver("installation", {
      action: "deleted",
      installation: { id: installationId },
    });

    expect(res.status).toBe(200);
    expect(await scopedDb(db, first).installations.list()).toHaveLength(0);
    expect(await scopedDb(db, second).installations.list()).toHaveLength(0);
    expect(await countProjects(installationId)).toBe(0);
  });

  it("leaves other installations alone", async () => {
    const mine = randomId();
    const userId = await linkInstallation(mine);

    await deliver("installation", {
      action: "deleted",
      installation: { id: randomId() },
    });

    expect(await scopedDb(db, userId).installations.list()).toHaveLength(1);
  });

  it("removes only the projects whose repository lost access", async () => {
    const installationId = randomId();
    const userId = await linkInstallation(installationId);
    await addProject(userId, installationId, 11);
    await addProject(userId, installationId, 22);

    const res = await deliver("installation_repositories", {
      action: "removed",
      installation: { id: installationId },
      repositories_removed: [{ id: 11 }],
    });

    expect(res.status).toBe(200);
    expect(await countProjects(installationId)).toBe(1);
  });

  it("is harmless when the same delivery arrives twice", async () => {
    const installationId = randomId();
    await linkInstallation(installationId);
    const payload = { action: "deleted", installation: { id: installationId } };

    expect((await deliver("installation", payload)).status).toBe(200);
    expect((await deliver("installation", payload)).status).toBe(200);
  });

  it("acknowledges events it does not act on", async () => {
    const installationId = randomId();
    const userId = await linkInstallation(installationId);

    const suspended = await deliver("installation", {
      action: "suspend",
      installation: { id: installationId },
    });
    const other = await deliver("push", { anything: true });

    expect(suspended.status).toBe(200);
    expect(other.status).toBe(200);
    expect(await scopedDb(db, userId).installations.list()).toHaveLength(1);
  });

  it("answers 400 to a signed payload that is malformed", async () => {
    const wrongShape = await deliver("installation", { unexpected: true });
    const notJson = "this is not json";
    const invalid = await deliverRaw("installation", notJson, {
      "x-hub-signature-256": sign(notJson),
    });

    expect(wrongShape.status).toBe(400);
    expect(invalid.status).toBe(400);
  });
});
