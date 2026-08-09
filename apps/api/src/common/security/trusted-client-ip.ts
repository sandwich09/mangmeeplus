import type { Request } from 'express';
import { isIP } from 'node:net';

function normalizedIp(value: string | undefined): string {
  const candidate = (value ?? '').trim().replace(/^\[|\]$/g, '').replace(/^::ffff:/, '');
  return isIP(candidate) ? candidate.toLowerCase() : 'unknown';
}

function isTrustedProxyAddress(value: string): boolean {
  const ip = normalizedIp(value);
  if (ip === '::1' || ip === '127.0.0.1') return true;
  if (ip.includes(':')) return ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb');
  const parts = ip.split('.').map(Number);
  return parts[0] === 10
    || (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

// H-3: prod is browser → Cloudflare Worker → ECS Express gateway → proxy, so the gateway
// appends *Cloudflare's* egress IP and the rightmost XFF hop is never the visitor. Keying
// rate limits on it collapses every Thai visitor behind one colo into a single bucket.
// Published at https://www.cloudflare.com/ips/ — ponytail: inlined because the list has moved
// twice in a decade; re-pull it if a colo ever lands outside (symptom: shared key returns).
const CLOUDFLARE_V4: ReadonlyArray<readonly [string, number]> = [
  ['173.245.48.0', 20], ['103.21.244.0', 22], ['103.22.200.0', 22], ['103.31.4.0', 22],
  ['141.101.64.0', 18], ['108.162.192.0', 18], ['190.93.240.0', 20], ['188.114.96.0', 20],
  ['197.234.240.0', 22], ['198.41.128.0', 17], ['162.158.0.0', 15], ['104.16.0.0', 13],
  ['104.24.0.0', 14], ['172.64.0.0', 13], ['131.0.72.0', 22],
];
// /32 prefixes as [first hextet, second hextet]; 2a06:98c0::/29 is masked separately.
const CLOUDFLARE_V6: ReadonlyArray<readonly [number, number]> = [
  [0x2400, 0xcb00], [0x2606, 0x4700], [0x2803, 0xf800],
  [0x2405, 0xb500], [0x2405, 0x8100], [0x2c0f, 0xf248],
];

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => acc * 256 + Number(octet), 0);
}

function isCloudflareAddress(ip: string): boolean {
  if (ip.includes(':')) {
    const parts = ip.split(':');
    const high = parseInt(parts[0] ?? '', 16);
    const low = parseInt(parts[1] || '0', 16);
    if (high === 0x2a06) return (low & 0xfff8) === 0x98c0;
    return CLOUDFLARE_V6.some(([a, b]) => high === a && low === b);
  }
  const value = ipv4ToInt(ip);
  return CLOUDFLARE_V4.some(([base, bits]) => ((value ^ ipv4ToInt(base)) >>> (32 - bits)) === 0);
}

/** Trust XFF only when the TCP peer is the private ALB/reverse-proxy tier. */
export function trustedClientIp(request: Request): string {
  const peer = normalizedIp(request.socket.remoteAddress);
  if (!isTrustedProxyAddress(peer)) return peer;
  const forwarded = request.headers['x-forwarded-for'];
  const hops = (Array.isArray(forwarded) ? forwarded : [forwarded])
    .flatMap((value) => value?.split(',') ?? [])
    .map((value) => normalizedIp(value))
    .filter((value) => value !== 'unknown');
  // Walk right-to-left past every hop our own tier or Cloudflare appended. The first hop that
  // is neither is the last address a proxy *observed*; everything left of it a client can assert.
  // Direct-to-origin traffic (the ECS endpoint is public) has no Cloudflare hop and stops at the
  // gateway-appended address, so this never hands an attacker a self-chosen key.
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    const hop = hops[index] as string;
    if (!isTrustedProxyAddress(hop) && !isCloudflareAddress(hop)) return hop;
  }
  return peer;
}
