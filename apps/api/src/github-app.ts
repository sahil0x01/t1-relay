// Authenticating as the GitHub App itself (not as a user): sign a short JWT
// with the app's private key, then trade it for an installation token.

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// DER lengths: one byte below 128, otherwise 0x80+n followed by n length bytes.
function derLength(length: number) {
  if (length < 128) return Uint8Array.of(length);
  const bytes: number[] = [];
  for (let n = length; n > 0; n = Math.floor(n / 256)) bytes.unshift(n % 256);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function derWrap(tag: number, content: Uint8Array) {
  return concat(Uint8Array.of(tag), derLength(content.length), content);
}

// GitHub hands out PKCS#1 keys ("BEGIN RSA PRIVATE KEY"). Web Crypto only
// imports PKCS#8, which is the same key inside a fixed wrapper:
// SEQUENCE { INTEGER 0, SEQUENCE { rsaEncryption OID, NULL }, OCTET STRING { key } }
function pkcs1ToPkcs8(pkcs1: Uint8Array) {
  const version = Uint8Array.of(0x02, 0x01, 0x00);
  const rsaAlgorithm = Uint8Array.of(
    0x30,
    0x0d,
    0x06,
    0x09,
    0x2a,
    0x86,
    0x48,
    0x86,
    0xf7,
    0x0d,
    0x01,
    0x01,
    0x01,
    0x05,
    0x00,
  );
  return derWrap(0x30, concat(version, rsaAlgorithm, derWrap(0x04, pkcs1)));
}

// The secret holds the .pem file base64-encoded on one line.
function privateKeyBytes(base64Pem: string) {
  const pem = atob(base64Pem);
  const isPkcs1 = pem.includes("BEGIN RSA PRIVATE KEY");
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
  return isPkcs1 ? pkcs1ToPkcs8(der) : der;
}

export async function createAppJwt(env: Env, nowMs = Date.now()) {
  const now = Math.floor(nowMs / 1000);
  const header = base64url(
    encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })),
  );
  // iat is set 60s back for clock drift; GitHub allows exp up to 10 minutes ahead.
  const payload = base64url(
    encoder.encode(
      JSON.stringify({
        iat: now - 60,
        exp: now + 9 * 60,
        iss: env.GITHUB_APP_CLIENT_ID,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes(env.GITHUB_APP_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}

// A one-hour token for one installation. Every caller must say which
// permissions it needs, and may narrow it to specific repositories, so tokens
// are narrow by default.
export async function createInstallationToken(
  env: Env,
  installationId: number,
  permissions: Record<string, "read" | "write">,
  repositoryIds?: number[],
) {
  const jwt = await createAppJwt(env);
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${jwt}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "t1-relay",
      },
      body: JSON.stringify({
        permissions,
        ...(repositoryIds ? { repository_ids: repositoryIds } : {}),
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`GitHub installation token request failed: ${res.status}`);
  }
  const data = (await res.json()) as {
    token: string;
    permissions?: Record<string, string>;
    repositories?: { full_name: string }[];
  };
  return {
    token: data.token,
    permissions: data.permissions ?? {},
    repositoryNames: (data.repositories ?? []).map((repo) => repo.full_name),
  };
}

// The token a sandbox gets to fetch code: one repository, contents read-only.
// (GitHub always adds read access to repository metadata.)
export function createReadOnlyRepoToken(
  env: Env,
  installationId: number,
  githubRepoId: number,
) {
  return createInstallationToken(env, installationId, { contents: "read" }, [
    githubRepoId,
  ]);
}
