/** Longest chain worth forwarding: prod is browser → Cloudflare → ECS gateway → proxy, so four
 *  hops is already generous. Capping bounds the work an oversized attacker-supplied header can
 *  cause downstream, and keeps the RIGHT side — the hops the infrastructure appended, which is the
 *  end `trustedClientIp` walks from. */
const MAX_FORWARDED_HOPS = 8;

/**
 * The headers a public server component must pass on when it calls the API for a visitor.
 *
 * The API derives the audited client IP with `trustedClientIp`, which trusts `x-forwarded-for` only
 * when the TCP peer is the private proxy tier — which the web container is. Forwarding the chain the
 * infrastructure already built for THIS request gives the API the same chain it would have seen had
 * the browser called it directly. Sending nothing makes every audited open read as the web
 * container's own address, which is what spec §14's "token id + IP" is there to prevent.
 *
 * The chain is forwarded verbatim (not rebuilt): a server component cannot see the socket peer, and
 * `trustedClientIp` already walks past the proxy and Cloudflare hops from the right, so a
 * visitor-prepended hop cannot become the answer.
 */
export function forwardedClientHeaders(incoming: { get(name: string): string | null }): Record<string, string> {
  const chain = (incoming.get('x-forwarded-for') ?? '')
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean)
    .slice(-MAX_FORWARDED_HOPS);
  return chain.length > 0 ? { 'x-forwarded-for': chain.join(', ') } : {};
}
