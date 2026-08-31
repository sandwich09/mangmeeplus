import { X509Certificate, createPublicKey, createVerify, type KeyObject } from 'node:crypto';

/**
 * Amazon SNS HTTPS-endpoint message verification, hand-built on `node:crypto` (the
 * `line-webhook-verifier` precedent — a webhook signature check is a handful of lines and does not
 * earn a dependency).
 *
 * The signature covers a canonical string built from *named JSON fields*, not the raw body, so this
 * needs the parsed envelope rather than a `rawBody` buffer.
 */

export type SnsEnvelope = Readonly<{
  Type: string;
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  Token?: string;
  SubscribeURL?: string;
}>;

/** Fetches a PEM by URL. Injectable so specs can verify the signature path without network. */
export type CertificateFetcher = (url: string) => Promise<string>;

// AWS signs these fields, in this order (alphabetical), for each message type. `Subject` is the
// only optional member: it is skipped entirely when absent, not signed as an empty string.
const SIGNED_FIELDS: Readonly<Record<string, readonly (keyof SnsEnvelope)[]>> = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
  UnsubscribeConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
};

const REQUIRED_FIELDS: readonly (keyof SnsEnvelope)[] = [
  'Type', 'MessageId', 'TopicArn', 'Message', 'Timestamp', 'SignatureVersion', 'Signature', 'SigningCertURL',
];

// Only SNS's own hosts may be contacted for a certificate or a subscription confirmation. Anything
// else is an SSRF request wearing an AWS envelope.
const SNS_HOSTNAME = /^sns\.[a-z0-9-]+\.amazonaws\.com$/;
const MAX_CERTIFICATE_BYTES = 16_384;
const FETCH_TIMEOUT_MS = 5_000;

/**
 * SNS rotates through a small set of signing certificates, so an unbounded map would be a slow
 * leak fed by attacker-chosen URLs. ponytail: clear wholesale at the cap instead of tracking LRU
 * order — swap for an LRU only if certificate churn ever shows up as fetch latency.
 */
const certificateCache = new Map<string, string>();
const CERTIFICATE_CACHE_MAX = 8;

export function parseSnsEnvelope(body: unknown): SnsEnvelope | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  for (const field of REQUIRED_FIELDS) {
    if (typeof record[field] !== 'string' || !record[field]) return null;
  }
  if (!SIGNED_FIELDS[record.Type as string]) return null;
  return record as unknown as SnsEnvelope;
}

/** An https URL on an SNS host, or null. Used for both SigningCertURL and SubscribeURL. */
export function snsHttpsUrl(value: string, requirePem = false): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (!SNS_HOSTNAME.test(url.hostname)) return null;
  if (requirePem && !url.pathname.endsWith('.pem')) return null;
  return url;
}

export function snsCanonicalString(envelope: SnsEnvelope): string {
  const fields = SIGNED_FIELDS[envelope.Type];
  if (!fields) throw new Error('sns_unsupported_type');
  let canonical = '';
  for (const field of fields) {
    const value = envelope[field];
    if (typeof value !== 'string') continue;
    canonical += `${field}\n${value}\n`;
  }
  return canonical;
}

export async function fetchSnsText(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`sns_fetch_status_${response.status}`);
  const text = await response.text();
  if (text.length > MAX_CERTIFICATE_BYTES) throw new Error('sns_fetch_too_large');
  return text;
}

/**
 * Accepts either the certificate SNS actually serves or a bare public key. The second branch costs
 * one line and lets the signature path be exercised from a locally generated key pair, so the spec
 * proves the real verifier rather than a stub of it.
 */
function publicKeyOf(pem: string): KeyObject {
  return pem.includes('BEGIN CERTIFICATE') ? new X509Certificate(pem).publicKey : createPublicKey(pem);
}

/**
 * Verifies the message signature. SignatureVersion 1 is SHA1withRSA, version 2 SHA256withRSA;
 * anything else is refused rather than guessed.
 *
 * Call this only after the TopicArn is known-good: it is what bounds certificate fetching to
 * messages that at least claim to be from our own topic.
 */
export async function verifySnsSignature(
  envelope: SnsEnvelope,
  fetcher: CertificateFetcher = fetchSnsText,
): Promise<boolean> {
  const algorithm = envelope.SignatureVersion === '1'
    ? 'RSA-SHA1'
    : envelope.SignatureVersion === '2' ? 'RSA-SHA256' : null;
  if (!algorithm) return false;

  const certUrl = snsHttpsUrl(envelope.SigningCertURL, true);
  if (!certUrl) return false;

  try {
    const pem = await loadCertificate(certUrl.toString(), fetcher);
    const verifier = createVerify(algorithm);
    verifier.update(snsCanonicalString(envelope), 'utf8');
    verifier.end();
    return verifier.verify(publicKeyOf(pem), envelope.Signature, 'base64');
  } catch {
    // A malformed certificate, a failed fetch or a malformed base64 signature are all "not verified".
    return false;
  }
}

async function loadCertificate(url: string, fetcher: CertificateFetcher): Promise<string> {
  const cached = certificateCache.get(url);
  if (cached) return cached;
  const pem = await fetcher(url);
  if (certificateCache.size >= CERTIFICATE_CACHE_MAX) certificateCache.clear();
  certificateCache.set(url, pem);
  return pem;
}

/** Test seam: the cache is process-wide, so a spec that swaps fetchers must be able to reset it. */
export function resetSnsCertificateCache(): void {
  certificateCache.clear();
}
