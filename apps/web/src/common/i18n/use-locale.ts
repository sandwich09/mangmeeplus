'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SupportedLocale } from './workspace-dictionary';
import { getDefaultLocale } from './workspace-i18n.logic';

const STORAGE_KEY = 'watchdog.workspace.locale';

function readStoredLocale(): SupportedLocale {
  if (typeof window === 'undefined') return getDefaultLocale();
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'en' || stored === 'th' ? stored : getDefaultLocale();
}

// Shared th/en locale state persisted to the same key the workspace shell uses,
// so the language chosen on the login page carries into the app and back.
export function useLocale(): [SupportedLocale, (next: SupportedLocale) => void] {
  const [locale, setLocaleState] = useState<SupportedLocale>(getDefaultLocale());

  useEffect(() => {
    setLocaleState(readStoredLocale());
  }, []);

  const setLocale = useCallback((next: SupportedLocale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // private mode — keep in-memory locale only
    }
  }, []);

  return [locale, setLocale];
}
