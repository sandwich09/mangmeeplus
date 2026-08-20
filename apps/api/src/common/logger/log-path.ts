/**
 * A request path is logged verbatim in three places — the request logger, the exception filter, and
 * the rate-limit security event — and the shared redactor (`SENSITIVE_LOG_KEY_PATTERN`) only ever
 * inspects KEY names, never string values. A secret that lives in the path itself therefore passes
 * straight through to CloudWatch.
 *
 * Spec §12 puts exactly such a secret there: `/document-delivery/{token}` resolves a bearer
 * credential for a document carrying a payee name and an amount, so a plain-text path log hands
 * every log reader the document.
 *
 * Deliberately NOT keyed on the token's shape. A mask that only fires on a well-formed token stops
 * working the day the format changes, and fails open — the one direction a redactor must never
 * fail. Every segment in that position is masked, whatever it looks like.
 */
const DELIVERY_TOKEN_SEGMENT = /(\/document-delivery\/)[^/?#]+/g;

export function maskLoggedPath<T extends string | undefined>(path: T): T {
  return (typeof path === 'string' ? path.replace(DELIVERY_TOKEN_SEGMENT, '$1:token') : path) as T;
}
