import { createInstallationToken } from "./github-app.ts";

const USER_AGENT = "t1-relay";

function apiHeaders(token: string) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
    "user-agent": USER_AGENT,
  };
}

// Swaps the one-time `code` from the callback for the installing user's token.
// GitHub can answer 200 with an `error` field, so we check for the token itself.
export async function exchangeCodeForUserToken(env: Env, code: string) {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify({
      client_id: env.GITHUB_APP_CLIENT_ID,
      client_secret: env.GITHUB_APP_CLIENT_SECRET,
      code,
    }),
  });
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(
      `GitHub token exchange failed: ${data.error ?? res.status}`,
    );
  }
  return data.access_token;
}

// The GitHub login of the person the user token belongs to.
export async function getUserLogin(userToken: string) {
  const res = await fetch("https://api.github.com/user", {
    headers: apiHeaders(userToken),
  });
  if (!res.ok) {
    throw new Error(`GitHub user request failed: ${res.status}`);
  }
  const data = (await res.json()) as { login: string };
  return data.login;
}

// The installations of our app that this user can access, according to GitHub.
export async function listUserInstallations(userToken: string) {
  const res = await fetch(
    "https://api.github.com/user/installations?per_page=100",
    { headers: apiHeaders(userToken) },
  );
  if (!res.ok) {
    throw new Error(`GitHub installations request failed: ${res.status}`);
  }
  const data = (await res.json()) as {
    installations: {
      id: number;
      account: { login?: string; slug?: string; type?: string };
    }[];
  };
  return data.installations.map((installation) => ({
    id: installation.id,
    accountLogin:
      installation.account.login ?? installation.account.slug ?? "unknown",
    accountType: installation.account.type ?? "unknown",
  }));
}

// Every repository the installation can see, up to 1000 (10 pages of 100).
export async function listInstallationRepositories(
  env: Env,
  installationId: number,
) {
  const { token } = await createInstallationToken(env, installationId, {
    metadata: "read",
  });
  const repositories: {
    id: number;
    fullName: string;
    defaultBranch: string;
    isPrivate: boolean;
  }[] = [];

  for (let page = 1; page <= 10; page++) {
    const res = await fetch(
      `https://api.github.com/installation/repositories?per_page=100&page=${page}`,
      { headers: apiHeaders(token) },
    );
    if (!res.ok) {
      throw new Error(`GitHub repositories request failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      repositories: {
        id: number;
        full_name: string;
        default_branch: string;
        private: boolean;
      }[];
    };
    for (const repo of data.repositories) {
      repositories.push({
        id: repo.id,
        fullName: repo.full_name,
        defaultBranch: repo.default_branch,
        isPrivate: repo.private,
      });
    }
    if (data.repositories.length < 100) break;
  }
  return repositories;
}
