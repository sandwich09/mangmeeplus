/**
 * One resolution for "where does the web app live", and one way to turn an in-app path into a link
 * a user can tap. There used to be three: `AppConfigService.webBaseUrl` (WEB_BASE_URL ?? PUBLIC_BASE_URL),
 * the LINE formatter (extra WATCHDOG_WEB_BASE_URL override, falling back to production
 * `https://mangmeeplus.com`), and the notification rail (falling back to `https://app.watchdog.local`).
 * Both fallbacks pointed at a different environment than the process they ran in — masked today only
 * because every deployed service sets one of the two variables.
 *
 * Callers that already hold `AppConfigService` should pass `config.webBaseUrl`; the env reader exists
 * for pure logic modules that have no injector.
 */

/** Same order as `AppConfigService.webBaseUrl`, so a service and a pure module cannot disagree. */
export function webBaseUrlFromEnv(): string | undefined {
  const value = (process.env['WEB_BASE_URL'] ?? process.env['PUBLIC_BASE_URL'] ?? '').trim();
  return value || undefined;
}

/**
 * Absolute link when a base URL is configured; the bare path otherwise (local dev has no public web
 * origin). Never invents a host: a link to the wrong environment is worse than no link.
 */
export function absoluteWebLink(baseUrl: string | undefined, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = (baseUrl ?? '').replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${suffix}` : suffix;
}

/** `absoluteWebLink` for pure modules: resolves the base from the environment itself. */
export function webLink(path: string): string {
  return absoluteWebLink(webBaseUrlFromEnv(), path);
}
