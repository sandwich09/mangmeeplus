import type { SignupClaimResultDto } from '@watchdog-bms/contracts';

/**
 * The claim result only exists in the response that spent the token — there is nothing to re-fetch
 * afterwards. The App Router has no route state, so the success page reads it from session storage
 * and degrades to a nameless welcome if the tab lost it (private mode, refresh in a new tab).
 */
const HANDOFF_KEY = 'watchdog.signupWelcome';

export type WelcomeHandoff = { companyName: string; homePath: string; companyId: string; attachedToExistingUser: boolean };

function safeStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function rememberClaimedCompany(result: SignupClaimResultDto, storage?: Storage): void {
  const store = safeStorage(storage);
  try {
    store?.setItem(
      HANDOFF_KEY,
      JSON.stringify({
        companyName: result.companyName,
        homePath: result.homePath,
        companyId: result.companyId,
        attachedToExistingUser: result.attachedToExistingUser,
      } satisfies WelcomeHandoff),
    );
  } catch {
    // A full or blocked store only costs the welcome page its company name.
  }
}

export function readClaimedCompany(storage?: Storage): WelcomeHandoff | null {
  const store = safeStorage(storage);
  let raw: string | null = null;
  try {
    raw = store?.getItem(HANDOFF_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WelcomeHandoff>;
    if (typeof parsed.companyName !== 'string' || !parsed.companyName) return null;
    // Only same-app absolute paths: the value round-trips through storage a page can also write.
    // A missing or unusable path costs the skip link its destination, not the whole greeting.
    const homePath = typeof parsed.homePath === 'string' && parsed.homePath.startsWith('/') && !parsed.homePath.startsWith('//')
      ? parsed.homePath
      : '/';
    return {
      companyName: parsed.companyName,
      homePath,
      companyId: typeof parsed.companyId === 'string' ? parsed.companyId : '',
      attachedToExistingUser: parsed.attachedToExistingUser === true,
    };
  } catch {
    return null;
  }
}

/**
 * Where a locked shop must go to pick a package (sales/locked-signup spec §19, §12): the one page
 * the lock leaves open besides settings and renew. `companyId` is what the claim result carries;
 * the `homePath` scrape only covers a handoff stored before this field existed.
 */
export function packagePathFor(handoff: Pick<WelcomeHandoff, 'companyId' | 'homePath'>): string {
  const companyId = handoff.companyId || /^\/companies\/([^/]+)/.exec(handoff.homePath)?.[1];
  return companyId ? `/companies/${companyId}/billing` : handoff.homePath;
}

/**
 * Review F6/F14: whether the merge dialog should ASK the server for its offer and plan.
 *
 * The dialog is re-offered on every failed link attempt (spec §4F: the offer repeats, it is not a
 * one-shot), and each open used to cost a preview call the API rate-limits. Once an answer is in
 * hand — including "no live offer" — reopening the same dialog must not ask again: the ticket in
 * the cookie has not changed, so neither has the answer.
 *
 * Extracted from the component so the decision is testable without a DOM; the effect is a one-line
 * caller of this.
 */
export function shouldFetchMergeOffer(open: boolean, offer: unknown | null): boolean {
  return open && offer === null;
}
