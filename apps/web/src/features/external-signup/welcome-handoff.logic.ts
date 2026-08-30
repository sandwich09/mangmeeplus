import type { SignupClaimResultDto } from '@watchdog-bms/contracts';

/**
 * The claim result only exists in the response that spent the token — there is nothing to re-fetch
 * afterwards. The App Router has no route state, so the success page reads it from session storage
 * and degrades to a nameless welcome if the tab lost it (private mode, refresh in a new tab).
 */
const HANDOFF_KEY = 'watchdog.signupWelcome';

export type WelcomeHandoff = { companyName: string; homePath: string; attachedToExistingUser: boolean };

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
      attachedToExistingUser: parsed.attachedToExistingUser === true,
    };
  } catch {
    return null;
  }
}
