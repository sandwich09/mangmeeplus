/** One menu's worth of filter values. Lives in memory only — see MenuFilterScope.tsx. */
export type FilterSlot = { menuKey: string | null; values: Map<string, unknown> };

export const emptySlot = (menuKey: string | null): FilterSlot => ({ menuKey, values: new Map() });

/**
 * The retention rule, whole: values survive while the menu does not change, and are dropped
 * the moment it does. A row's detail page resolves to the menu it was opened from, so a
 * list → detail → back trip keeps the filter; any other menu clears it.
 */
export function slotFor(current: FilterSlot, menuKey: string | null): FilterSlot {
  return current.menuKey === menuKey ? current : emptySlot(menuKey);
}

/**
 * `undefined` is the "nothing stored" sentinel, so `??` would be wrong here: '' is a real
 * filter value (the evidence panel's "all months") and has to round-trip.
 */
export function readSlot<T>(slot: FilterSlot, key: string, initial: () => T): T {
  const stored = slot.values.get(key);
  return stored === undefined ? initial() : (stored as T);
}
