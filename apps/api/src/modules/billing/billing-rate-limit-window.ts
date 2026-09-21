/**
 * Window, in seconds, for a billing rate-limit bucket whose production window is `productionSeconds`.
 * Deployed environments run APP_ENV=production and always get `productionSeconds`. Only a local smoke
 * harness may cap it with BILLING_RATE_LIMIT_WINDOW_SECONDS (1–59), so it waits out the real limiter in
 * seconds instead of minutes. Read per call: the harness sets the variable after importing modules.
 */
export function billingRateLimitWindowSeconds(productionSeconds: number): number {
  const cap = Number(process.env.BILLING_RATE_LIMIT_WINDOW_SECONDS);
  return process.env.APP_ENV === 'local' && Number.isInteger(cap) && cap >= 1 && cap < 60
    ? Math.min(productionSeconds, cap)
    : productionSeconds;
}
