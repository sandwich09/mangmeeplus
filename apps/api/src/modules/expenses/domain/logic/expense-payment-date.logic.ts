/** Existing interactive writers showed an editable date. Only this seed writer copied the
 * document date; mirror this classification in the one-off historical migration. */
export function historicalExpensePaymentDateConfirmed(idempotencyKey: string | null): boolean {
  return !idempotencyKey?.startsWith('client:seed-payment-');
}
