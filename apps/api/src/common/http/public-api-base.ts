import type { Request } from 'express';

export function publicApiBase(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || req.protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim() || req.get('host') || 'localhost:3001';
  return `${proto}://${host}/v1`;
}

/** Where the WEB app lives, for a handoff link the caller will follow themselves: the Origin
 *  header in local dev, the proxy headers in production. Never for a link carrying a credential —
 *  those use `trustedPublicApiBase` below, because these headers are client-suppliable. */
export function webAppBase(req: Request): string {
  const origin = req.headers['origin'] as string | undefined;
  if (origin) return origin;
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() ?? req.protocol ?? 'http';
  const host = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim() ?? req.get('host') ?? 'localhost:3000';
  return `${proto}://${host}`;
}

/** For links that embed bearer credentials (LINE link QR packages): a statically
 *  configured public origin must win over client-suppliable forwarded headers,
 *  otherwise a crafted X-Forwarded-Host yields a QR that carries the real token to
 *  an attacker-controlled host (H-09). Falls back to header derivation when
 *  PUBLIC_BASE_URL is unset (local dev). */
export function trustedPublicApiBase(req: Request): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (configured) return `${configured.replace(/\/+$/, '')}/v1`;
  return publicApiBase(req);
}
