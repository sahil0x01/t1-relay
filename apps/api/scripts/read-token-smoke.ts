// Dev check for Feature 3's "fetched with a read-only token". It uses the real
// GitHub App credentials from .dev.vars: mints a token limited to one
// repository with contents read-only, shows what GitHub says the token can do,
// and fetches the repository with git using it. It prints no secrets.
//
//   pnpm github:smoke
import { spawnSync } from "node:child_process";
import { createDb } from "@relay/db";
import { listInstallationRepositories } from "../src/github.ts";
import { createReadOnlyRepoToken } from "../src/github-app.ts";

const env = process.env as unknown as Env;
const db = createDb(env.DATABASE_URL);

try {
  const rows =
    await db.$client`select installation_id from github_installation order by created_at limit 1`;
  const installationId = Number(rows[0]?.installation_id);
  if (!installationId) {
    throw new Error(
      "No GitHub installation in the database. Connect GitHub on the Repositories page first.",
    );
  }

  const repos = await listInstallationRepositories(env, installationId);
  const repo = repos[0];
  if (!repo) {
    throw new Error("The installation shares no repositories.");
  }
  console.log(
    `Installation ${installationId} shares ${repos.length} repositories. Using ${repo.fullName}.`,
  );

  const { token, permissions, repositoryNames } = await createReadOnlyRepoToken(
    env,
    installationId,
    repo.id,
  );
  console.log("Token permissions:", JSON.stringify(permissions));
  console.log("Token is limited to:", repositoryNames.join(", "));

  if (
    permissions.contents !== "read" ||
    Object.values(permissions).includes("write")
  ) {
    throw new Error("The token is not read-only.");
  }
  if (repositoryNames.length !== 1 || repositoryNames[0] !== repo.fullName) {
    throw new Error("The token is not limited to exactly one repository.");
  }

  // The token reaches git through a config header in the environment, so it
  // never appears in a command line.
  const header = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  const git = spawnSync(
    "git",
    ["ls-remote", `https://github.com/${repo.fullName}.git`, "HEAD"],
    {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.extraHeader",
        GIT_CONFIG_VALUE_0: header,
      },
    },
  );
  if (git.status !== 0) {
    throw new Error(`git ls-remote failed: ${git.stderr.trim()}`);
  }
  console.log("git ls-remote HEAD:", git.stdout.trim());
  console.log(
    "OK: the repository can be fetched with a read-only, single-repository token.",
  );
} finally {
  await db.$client.end();
}
