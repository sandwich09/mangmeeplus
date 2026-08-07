'use client';

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { type FilterSlot, emptySlot, readSlot, slotFor } from './menu-filter.logic';

/**
 * Filter state that survives a row → detail → back trip and nothing else.
 *
 * A detail view is its own route, so App Router unmounts the list and plain useState loses the
 * filter. The three storage options that would survive that trip — localStorage, sessionStorage,
 * and the URL — all survive a refresh too, which the owner does not want. What is left is state
 * held above the page, in memory: a refresh destroys the tree, so "reset on refresh" costs no
 * code at all. See docs/specs/list-filter-retention-spec.md §5.
 */

type MenuFilterStore = {
  read: <T>(key: string, initial: () => T) => T;
  write: (key: string, value: unknown) => void;
};

const MenuFilterContext = createContext<MenuFilterStore | null>(null);

export function MenuFilterProvider({ menuKey, children }: { menuKey: string | null; children: React.ReactNode }) {
  const slot = useRef<FilterSlot>(emptySlot(menuKey));

  // Dropped during render, not in an effect: a child's useState initializer reads the store in
  // this same pass, so an effect would land one paint too late and the page would flash the
  // previous menu's filter. Idempotent — a second pass with the same menuKey returns the same
  // slot — so StrictMode's double render is safe, and a torn concurrent render can only clear
  // too eagerly, which yields the default.
  slot.current = slotFor(slot.current, menuKey);

  const store = useMemo<MenuFilterStore>(
    () => ({
      read: (key, initial) => readSlot(slot.current, key, initial),
      write: (key, value) => { slot.current.values.set(key, value); },
    }),
    [],
  );

  return <MenuFilterContext.Provider value={store}>{children}</MenuFilterContext.Provider>;
}

/**
 * Drop-in for useState on a list filter. `initial` is a factory so a default that reads the clock
 * is only evaluated when there is nothing stored.
 *
 * Only ever holds presentation state — never an id, a scope, or anything a result's correctness
 * depends on. A restored value is always one the user could have picked by hand at that moment.
 */
export function useMenuFilterState<T>(key: string, initial: () => T): [T, (value: T) => void] {
  const store = useContext(MenuFilterContext);
  // No `??` on the read: the store already distinguishes "nothing stored" from a stored falsy
  // value, and `??` here would quietly overwrite a stored null. Outside a provider — a page
  // rendered without the workspace layout — the hook is plain useState.
  const [value, setValue] = useState<T>(() => (store ? store.read(key, initial) : initial()));

  const set = useCallback(
    (next: T) => {
      setValue(next);
      store?.write(key, next);
    },
    [key, store],
  );

  return [value, set];
}
