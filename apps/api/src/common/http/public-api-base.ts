import { ServiceUnavailableException } from '@nestjs/common';
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

/**
 * For a frontend link this request will PERSIST — an owner handoff URL, say. `webAppBase` above
 * reads client-suppliable headers and `AppConfigService.webBaseUrl` falls back to PUBLIC_BASE_URL,
 * the API's own origin; either can store a link nobody can follow. Pass `config.sesWebBaseUrl`,
 * which is WEB_BASE_URL and nothing else. Unset is a deployment fault, so it refuses rather than
 * guessing — UAT and production both set it.
 */
export function requiredWebAppBase(configuredWebBaseUrl: string | undefined): string {
  if (!configuredWebBaseUrl) throw new ServiceUnavailableException('web_base_url_not_configured');
  return configuredWebBaseUrl;
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
