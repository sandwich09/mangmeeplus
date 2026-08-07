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

/** Trust XFF only when the TCP peer is the private ALB/reverse-proxy tier. */
export function trustedClientIp(request: Request): string {
  const peer = normalizedIp(request.socket.remoteAddress);
  if (!isTrustedProxyAddress(peer)) return peer;
  const forwarded = request.headers['x-forwarded-for'];
  const hops = (Array.isArray(forwarded) ? forwarded : [forwarded])
    .flatMap((value) => value?.split(',') ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
  return normalizedIp(hops[hops.length - 1]) !== 'unknown'
    ? normalizedIp(hops[hops.length - 1])
    : peer;
}
