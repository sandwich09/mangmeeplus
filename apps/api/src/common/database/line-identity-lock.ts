/**
 * The advisory-lock key for ONE LINE identity slot — the unique
 * `(provider, providerChannelId, providerUserId)` triple on `ExternalIdentity`.
 *
 * Two flows re-point that same row from UNLINKED to ACTIVE, in different modules:
 *   - signup provisioning (`create-company-onboarding.use-case.ts`), inside its company transaction
 *   - the link / owner-QR path (`link-line-identity.use-case.ts`)
 *
 * Both read the row and then update it. Row locks alone do not make that safe: the second UPDATE
 * simply waits for the first to commit and then overwrites it, so a link landing beside a fresh
 * provisioning would take the LINE credential off the owner of the shop that was just built — and
 * that credential is their only way in. Serialising both on ONE key is what makes the read the
 * decision. The literal lives here so the two sites cannot drift apart; a divergent key is a lock
 * that locks nothing, and nothing would fail until the day it mattered.
 *
 * Take it inside a transaction, and RE-READ the row afterwards — a value read before the lock may
 * already be stale:
 *
 *   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lineIdentityLockKey(channelId, providerUserId)}, 0))`;
 *
 * Always keyed on the CANONICAL channel, which is the only channel either writer creates rows on.
 */
export function lineIdentityLockKey(providerChannelId: string, providerUserId: string): string {
  return `line-identity:${providerChannelId}:${providerUserId}`;
}
