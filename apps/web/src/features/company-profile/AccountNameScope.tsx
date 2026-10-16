'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ACCOUNT_NAME_CHANGED_EVENT } from './company-profile.api';

const AccountNameContext = createContext<{ displayName: string | null } | null>(null);

/** A successful save updates mounted readers before the server layout refresh finishes. */
export function AccountNameScope({ userId, displayName, children }: { userId: string; displayName: string | null; children: ReactNode }) {
  const [saved, setSaved] = useState<{ userId: string; displayName: string } | null>(null);
  useEffect(() => {
    const changed = (event: Event) => {
      const name = (event as CustomEvent<{ displayName?: unknown }>).detail?.displayName;
      if (typeof name === 'string') setSaved({ userId, displayName: name });
    };
    window.addEventListener(ACCOUNT_NAME_CHANGED_EVENT, changed);
    return () => window.removeEventListener(ACCOUNT_NAME_CHANGED_EVENT, changed);
  }, [userId]);
  return <AccountNameContext.Provider value={{ displayName: saved?.userId === userId ? saved.displayName : displayName }}>{children}</AccountNameContext.Provider>;
}

export function useAccountDisplayName(fallback: string | null): string | null {
  const current = useContext(AccountNameContext);
  return current ? current.displayName : fallback;
}
