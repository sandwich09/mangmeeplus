import { lookup } from 'node:dns/promises';
import { request, type RequestOptions } from 'node:https';
import { isIP } from 'node:net';

export class WebhookPolicyError extends Error {}

function normalizedHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

function hostAllowed(hostname: string, allowedHosts: readonly string[]): boolean {
  const host = normalizedHostname(hostname);
  return allowedHosts.some((entry) => {
    const allowed = normalizedHostname(entry.trim());
    if (!allowed) return false;
    return allowed.startsWith('*.')
      ? host.endsWith(allowed.slice(1)) && host !== allowed.slice(2)
      : host === allowed;
  });
}

export function assertWebhookUrlPolicy(rawUrl: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebhookPolicyError('Webhook URL is invalid');
  }
  if (url.protocol !== 'https:') throw new WebhookPolicyError('Webhook URL must use HTTPS');
  if (url.username || url.password) throw new WebhookPolicyError('Webhook URL credentials are not allowed');
  if (url.port && url.port !== '443') throw new WebhookPolicyError('Webhook URL must use port 443');
  if (url.hash) throw new WebhookPolicyError('Webhook URL fragments are not allowed');
  if (!hostAllowed(url.hostname, allowedHosts)) throw new WebhookPolicyError('Webhook hostname is not allowlisted');
  return url;
}

function ipv4Number(address: string): number {
  return address.split('.').reduce((value, octet) => (value * 256) + Number(octet), 0) >>> 0;
}

function inIpv4Cidr(address: number, base: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (address & mask) === (ipv4Number(base) & mask);
}

function publicIpv4(address: string): boolean {
  const value = ipv4Number(address);
  const denied: Array<[string, number]> = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
    ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ];
  return !denied.some(([base, prefix]) => inIpv4Cidr(value, base, prefix));
}

function ipv6Bytes(address: string): number[] {
  const mapped = address.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  const value = mapped
    ? `${mapped[1]}${(ipv4Number(mapped[2]!) >>> 16).toString(16)}:${(ipv4Number(mapped[2]!) & 0xffff).toString(16)}`
    : address;
  const [leftRaw, rightRaw = ''] = value.toLowerCase().split('::');
  const left = leftRaw ? leftRaw.split(':').filter(Boolean) : [];
  const right = rightRaw ? rightRaw.split(':').filter(Boolean) : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return groups.slice(0, 8).flatMap((group) => {
    const word = Number.parseInt(group || '0', 16);
    return [word >>> 8, word & 0xff];
  });
}

function publicIpv6(address: string): boolean {
  const bytes = ipv6Bytes(address);
  if (bytes.length !== 16) return false;
  if (bytes.every((byte) => byte === 0)) return false;
  if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) return false;
  if ((bytes[0]! & 0xfe) === 0xfc) return false; // unique-local
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return false; // link-local
  if (bytes[0] === 0xff) return false; // multicast
  if ((bytes[0]! & 0xe0) !== 0x20) return false; // only global-unicast 2000::/3
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return false; // docs
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return false; // 6to4
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return false; // Teredo
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && (bytes[3]! & 0xf0) === 0x10) return false; // ORCHID
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) return false; // NAT64
  const mapped = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (mapped) return publicIpv4(bytes.slice(12).join('.'));
  return true;
}

export function isPublicWebhookAddress(address: string): boolean {
  const family = isIP(normalizedHostname(address));
  if (family === 4) return publicIpv4(address);
  if (family === 6) return publicIpv6(normalizedHostname(address));
  return false;
}

export async function resolveWebhookDestination(
  rawUrl: string,
  allowedHosts: readonly string[],
): Promise<{ url: URL; address: string; family: 4 | 6 }> {
  const url = assertWebhookUrlPolicy(rawUrl, allowedHosts);
  const host = normalizedHostname(url.hostname);
  const literalFamily = isIP(host);
  const answers = literalFamily
    ? [{ address: host, family: literalFamily }]
    : await lookup(host, { all: true, verbatim: true });
  if (answers.length === 0) throw new Error('Webhook hostname did not resolve');
  if (answers.some((answer) => !isPublicWebhookAddress(answer.address))) {
    throw new WebhookPolicyError('Webhook hostname resolves to a non-public address');
  }
  const selected = answers[0]!;
  return { url, address: selected.address, family: selected.family as 4 | 6 };
}

export async function postJsonWebhook(input: {
  url: string;
  allowedHosts: readonly string[];
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}): Promise<{ status: number }> {
  if (Buffer.byteLength(input.body) > 64 * 1024) throw new WebhookPolicyError('Webhook payload exceeds 64 KiB');
  const destination = await resolveWebhookDestination(input.url, input.allowedHosts);
  return new Promise((resolve, reject) => {
    const options: RequestOptions = {
      method: 'POST',
      headers: input.headers,
      signal: AbortSignal.timeout(input.timeoutMs),
      lookup: ((_hostname: string, _options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void) => {
        callback(null, destination.address, destination.family);
      }) as RequestOptions['lookup'],
    };
    const req = request(destination.url, options, (res) => {
      const status = res.statusCode ?? 0;
      res.destroy();
      resolve({ status });
    });
    req.on('error', reject);
    req.end(input.body);
  });
}
