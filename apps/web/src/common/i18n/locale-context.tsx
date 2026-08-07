'use client';

import { createContext, useContext } from 'react';
import type { SupportedLocale } from './workspace-dictionary';

// Live workspace locale, provided by the app shell so page content re-renders
// immediately when the header language toggle flips th/en (the useLocale hook
// only syncs its own instance, not sibling components).
export const WorkspaceLocaleContext = createContext<SupportedLocale>('th');

export function useWorkspaceLocale(): SupportedLocale {
  return useContext(WorkspaceLocaleContext);
}
