'use client';

import { createContext, useContext } from 'react';

/**
 * "This shop has no usable package", handed down from the shell that already read the plan-term
 * notice (spec §12). Server-rendered pages inside the locked shell — the settings hub — read it
 * through this client island instead of paying for a second notice call of their own.
 *
 * `false` outside the provider: every other workspace page is, by definition, not locked.
 */
const LockedShellContext = createContext(false);

export const LockedShellProvider = LockedShellContext.Provider;

export function useLockedShell(): boolean {
  return useContext(LockedShellContext);
}
