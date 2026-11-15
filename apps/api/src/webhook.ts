// Checks GitHub's X-Hub-Signature-256 header against the exact request body.
export async function verifyWebhookSignature(
  secret: string,
  body: string,
  signatureHeader: string | undefined,
) {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const hex = signatureHeader.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/i.test(hex)) return false;

  const signature = Uint8Array.from(hex.match(/../g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(body));
}
