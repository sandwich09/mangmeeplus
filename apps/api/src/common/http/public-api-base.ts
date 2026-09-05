import { ServiceUnavailableException } from '@nestjs/common';
import type { Request } from 'express';

export function publicApiBase(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || req.protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim() || req.get('host') || 'localhost:3001';
  return `${proto}://${host}/v1`;
}

/**
 * Where the WEB app lives, for a frontend link this request will PERSIST — an owner handoff URL,
 * say. There used to be a header-derived version of this; every caller had the same bug, so it is
 * gone. `AppConfigService.webBaseUrl` is not the answer either: it falls back to PUBLIC_BASE_URL,
 * the API's own origin. Pass `config.sesWebBaseUrl`, which is WEB_BASE_URL and nothing else.
 * Unset is a deployment fault, so it refuses rather than guessing — every deployed environment
 * sets it, and `infra/docker/compose.local.yml` defaults it for local runs.
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
