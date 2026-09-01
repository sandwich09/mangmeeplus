/**
 * LINE's in-app browser completes a LINE Login round trip in the EXTERNAL browser (Safari/Chrome),
 * while our /api/auth/line-login/start transaction cookie was set in the in-app one — the callback
 * then finds no transaction and every mobile login "fails" (UAT 2026-09-01 08:32: the failing
 * attempt never reached the API; the Safari retry at 08:36 succeeded).
 *
 * LINE's documented fix: a link opened inside the LINE in-app browser with
 * `openExternalBrowser=1` is opened in the system browser instead, so the whole flow — cookie,
 * authorize, callback — lives in one browser. A no-op everywhere else.
 */
export function isLineInAppBrowser(userAgent: string): boolean {
  return / Line\//i.test(userAgent);
}

export function withLineExternalBrowser(url: string, userAgent: string): string {
  if (!isLineInAppBrowser(userAgent)) return url;
  return url + (url.includes('?') ? '&' : '?') + 'openExternalBrowser=1';
}
