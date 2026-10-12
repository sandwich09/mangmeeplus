import type { ExpenseVatSourceOverrideInput } from '@watchdog-bms/contracts';

export async function sendAndConfirmExpense<T extends { updatedAt: string }, R>(
  send: () => Promise<T>, confirm: (override?: ExpenseVatSourceOverrideInput) => Promise<R>,
  onSent: (expense: T) => void, override?: ExpenseVatSourceOverrideInput,
): Promise<R> {
  const sent = await send();
  onSent(sent);
  return confirm(override ? { ...override, expectedUpdatedAt: sent.updatedAt } : undefined);
}
