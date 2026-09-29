import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

function env(name: string) {
  return process.env[name]?.trim() ?? "";
}

export function isLineWebhookConfigured() {
  return Boolean(env("LINE_CHANNEL_SECRET"));
}

/**
 * Verifies the x-line-signature header LINE sends on every webhook request:
 * base64(HMAC-SHA256(channel secret, raw request body)). Must run against
 * the exact raw bytes of the request body — read it with request.text(),
 * never request.json(), before verifying.
 */
export function verifyLineWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = env("LINE_CHANNEL_SECRET");
  if (!secret || !signatureHeader) return false;

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signatureHeader);
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}
