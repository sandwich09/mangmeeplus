'use client';

import { useCallback, useSyncExternalStore } from 'react';

export function useMediaQuery(query: string, serverDefault = false): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const mediaQuery = window.matchMedia(query);
    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }, [query]);
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  const getServerSnapshot = useCallback(() => serverDefault, [serverDefault]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// serverDefault=true: SSR must assume desktop, else the expanded sidebar renders
// collapsed in the initial HTML and animates open after hydration on every load.
// On real mobile the drawer is off-canvas regardless, so the assumption is invisible there.
export const useIsDesktop = () => useMediaQuery('(min-width: 64rem)', true);
