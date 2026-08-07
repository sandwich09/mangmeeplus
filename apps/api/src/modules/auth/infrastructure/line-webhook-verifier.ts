import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies LINE Messaging API webhook signature.
 * @param body - Raw request body as Buffer
 * @param signature - X-Line-Signature header value (base64)
 * @param channelSecret - LINE Messaging API channel secret
 */
export function verifyLineWebhookSignature(
  body: Buffer,
  signature: string,
  channelSecret: string,
): boolean {
  const hmac = createHmac('sha256', channelSecret);
  hmac.update(body);
  const digest = hmac.digest('base64');

  // ponytail: timingSafeEqual prevents timing attacks on HMAC comparison
  const digestBuf = Buffer.from(digest);
  const sigBuf = Buffer.from(signature);
  if (digestBuf.length !== sigBuf.length) return false;
  return timingSafeEqual(digestBuf, sigBuf);
}
