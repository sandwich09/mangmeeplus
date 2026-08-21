/**
 * Privacy-safe AgentCore session-affinity token (latency/autonomy Phase 6, plan §6).
 *
 * A/B session affinity would let repeated turns from one chat reuse a warm AgentCore session
 * (prompt-cache, connection) instead of a cold one. The routing key MUST NOT be the raw company/chat/
 * user id — a session header is observable, so leaking identifiers there is a tenant-privacy failure.
 * This derives an OPAQUE, stable token by HMAC over the (company, chat) cluster: the same chat always
 * maps to the same token (affinity), and distinct clusters get distinct HMAC pre-images so their tokens
 * differ with overwhelming probability (SHA-256 collision resistance — not a mathematical guarantee).
 * Neither the raw ids nor the HMAC bytes are exposed beyond the bounded hex the caller may put on the wire.
 *
 * This is derivation only. It is NOT wired into the live invoke: whether session affinity actually cuts
 * latency/cost, and by how much, needs provider/environment measurement (prompt-cache tokens, throttle
 * and retry delay). Until that proof exists the Phase-6 flag stays default OFF and nothing consumes it.
 */
import { createHmac } from 'node:crypto';

/** 128 bits of the digest as hex — bounded, collision-safe for a session key, and opaque. */
const SESSION_TOKEN_HEX_CHARS = 32;

/**
 * Derive a stable, privacy-safe session-affinity token for the (companyId, chatId) cluster, or
 * `undefined` when affinity is off, unconfigured, or the cluster is unknown — in which case the caller
 * uses no affinity and the default cold-session path is unchanged. `companyId`/`chatId` are the same
 * authoritative cluster the debounce cohort uses; the user id is deliberately excluded so every user in
 * one chat shares one warm session while remaining isolated from every other chat.
 */
export function deriveSessionAffinityToken(input: {
  enabled: boolean;
  secret: string | undefined;
  companyId: string | undefined;
  chatId: string | undefined;
}): string | undefined {
  if (!input.enabled || !input.secret || !input.companyId || !input.chatId) return undefined;
  // Length-prefix the two fields so distinct (company, chat) values never share an HMAC PRE-IMAGE
  // (e.g. "ab" + "c" vs "a" + "bc" are different inputs); token equality then reduces to SHA-256
  // collision resistance. Only the opaque hex prefix ever leaves this function.
  const preimage = `${input.companyId.length}:${input.companyId}:${input.chatId}`;
  return createHmac('sha256', input.secret).update(preimage).digest('hex').slice(0, SESSION_TOKEN_HEX_CHARS);
}
