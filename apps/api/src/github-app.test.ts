import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listInstallationRepositories } from "./github.ts";
import {
  createAppJwt,
  createInstallationToken,
  createReadOnlyRepoToken,
} from "./github-app.ts";
import { env } from "./test-helpers.ts";

function makeKey(type: "pkcs1" | "pkcs8") {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type, format: "pem" },
  });
  return {
    publicKey,
    appEnv: {
      ...env,
      GITHUB_APP_CLIENT_ID: "Iv-test-client",
      GITHUB_APP_PRIVATE_KEY: Buffer.from(privateKey).toString("base64"),
    },
  };
}

function decode(part: string) {
  return JSON.parse(Buffer.from(part, "base64url").toString());
}

function signatureIsValid(jwt: string, publicKey: string) {
  const [header, payload, signature] = jwt.split(".");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${header}.${payload}`);
  return verifier.verify(publicKey, signature as string, "base64url");
}

describe("createAppJwt", () => {
  // GitHub sends PKCS#1 keys. A 2048-bit key is over 1000 bytes, which also
  // exercises DER's multi-byte length form.
  it("signs with a PKCS#1 key so GitHub's public key verifies it", async () => {
    const { publicKey, appEnv } = makeKey("pkcs1");

    const jwt = await createAppJwt(appEnv);

    expect(signatureIsValid(jwt, publicKey)).toBe(true);
  });

  it("also accepts a key that is already PKCS#8", async () => {
    const { publicKey, appEnv } = makeKey("pkcs8");

    const jwt = await createAppJwt(appEnv);

    expect(signatureIsValid(jwt, publicKey)).toBe(true);
  });

  it("uses RS256, the client id, a back-dated iat and an exp under 10 minutes", async () => {
    const { appEnv } = makeKey("pkcs1");
    const nowMs = 1_800_000_000_000;

    const jwt = await createAppJwt(appEnv, nowMs);

    const [header, payload] = jwt.split(".");
    const now = nowMs / 1000;
    expect(decode(header as string)).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = decode(payload as string);
    expect(claims.iss).toBe("Iv-test-client");
    expect(claims.iat).toBeLessThan(now);
    expect(claims.exp - now).toBeLessThanOrEqual(600);
    expect(claims.exp).toBeGreaterThan(now);
  });
});

describe("GitHub calls made as the app", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks for an installation token with only the permissions given", async () => {
    const { appEnv } = makeKey("pkcs1");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ token: "ghs_test" }), { status: 201 }),
      );

    const { token } = await createInstallationToken(appEnv, 4242, {
      metadata: "read",
    });

    expect(token).toBe("ghs_test");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://api.github.com/app/installations/4242/access_tokens",
    );
    const request = init as RequestInit;
    expect(request.method).toBe("POST");
    expect((request.headers as Record<string, string>).authorization).toMatch(
      /^Bearer ey/,
    );
    expect(JSON.parse(request.body as string)).toEqual({
      permissions: { metadata: "read" },
    });
  });

  it("makes the sandbox token read-only and limited to one repository", async () => {
    const { appEnv } = makeKey("pkcs1");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          token: "ghs_readonly",
          permissions: { contents: "read", metadata: "read" },
          repositories: [{ full_name: "octocat/hello" }],
        }),
        { status: 201 },
      ),
    );

    const result = await createReadOnlyRepoToken(appEnv, 4242, 99);

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(request.body as string)).toEqual({
      permissions: { contents: "read" },
      repository_ids: [99],
    });
    expect(result).toEqual({
      token: "ghs_readonly",
      permissions: { contents: "read", metadata: "read" },
      repositoryNames: ["octocat/hello"],
    });
  });

  it("throws, without leaking anything secret, when GitHub refuses", async () => {
    const { appEnv } = makeKey("pkcs1");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 404 }),
    );

    await expect(createInstallationToken(appEnv, 4242, {})).rejects.toThrow(
      "GitHub installation token request failed: 404",
    );
  });

  it("lists repositories using that token and reads every page", async () => {
    const { appEnv } = makeKey("pkcs1");
    const page = (from: number, count: number) =>
      new Response(
        JSON.stringify({
          repositories: Array.from({ length: count }, (_, i) => ({
            id: from + i,
            full_name: `octocat/repo-${from + i}`,
            default_branch: "main",
            private: true,
          })),
        }),
      );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "ghs_test" }), { status: 201 }),
      )
      .mockResolvedValueOnce(page(1, 100))
      .mockResolvedValueOnce(page(101, 5));

    const repos = await listInstallationRepositories(appEnv, 4242);

    expect(repos).toHaveLength(105);
    expect(repos[0]).toEqual({
      id: 1,
      fullName: "octocat/repo-1",
      defaultBranch: "main",
      isPrivate: true,
    });
    const secondCall = fetchMock.mock.calls[1];
    expect(secondCall?.[0]).toBe(
      "https://api.github.com/installation/repositories?per_page=100&page=1",
    );
    expect(
      ((secondCall?.[1] as RequestInit).headers as Record<string, string>)
        .authorization,
    ).toBe("Bearer ghs_test");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
