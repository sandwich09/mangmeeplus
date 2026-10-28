/** Consume a navigation notice once per expense, including React StrictMode effect replays. */
export function consumeStoredNoticeOnce<T>(storage: Pick<Storage, 'getItem' | 'removeItem'>, key: string, expenseId: string, consumed: { current: string | null }): T | null | undefined {
  if (consumed.current === expenseId) return undefined;
  consumed.current = expenseId;
  try {
    const stored = storage.getItem(key);
    storage.removeItem(key);
    return stored ? JSON.parse(stored) as T : null;
  } catch {
    return null;
  }
}
