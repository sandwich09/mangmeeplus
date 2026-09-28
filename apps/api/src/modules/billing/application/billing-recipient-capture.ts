import { isDeepStrictEqual } from 'node:util';
import type { CompanyLegalAddress } from '@watchdog-bms/contracts';
import type { BillingAccount, Prisma } from '../../../generated/prisma/client';
import type { StripeClient, StripeObject } from '../infrastructure/stripe.client';
import type { BillingSnapshot } from './billing.service';

/** What Stripe Checkout collected (spec §18.2 R-A4): the document recipient and the typed billing address. */
export type RecipientCapture = { email: string | null; address: Record<string, string | null> | null };
const ADDRESS_KEYS = ['country', 'line1', 'line2', 'city', 'state', 'postal_code'] as const;
// The column is VARCHAR(320); a longer or malformed value is ignored rather than failing the apply.
const emailOf = (value: unknown) => {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return email.length > 0 && email.length <= 320 && email.includes('@') ? email : null;
};
/** Stripe's own address shape, kept as given (known keys only); null when it carries nothing. */
const addressOf = (value: unknown): Record<string, string | null> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const address = Object.fromEntries(ADDRESS_KEYS.map(key => [key, typeof source[key] === 'string' && source[key] ? (source[key] as string).slice(0, 200) : null]));
  return ADDRESS_KEYS.some(key => address[key]) ? address : null;
};

/**
 * Read before the transaction, under the account lease (no provider call inside a transaction). The
 * completed session carries `customer_details` in both payment and subscription mode; the Customer is
 * read only when the session has nothing and no recipient is stored yet, so a replay adds no call.
 */
export async function readRecipientCapture(stripe: StripeClient, account: BillingAccount, session?: StripeObject | null): Promise<RecipientCapture | null> {
  const details = session?.customer_details;
  const fromSession = { email: emailOf(details?.email), address: addressOf(details?.address) };
  if (fromSession.email || fromSession.address) return fromSession;
  if (account.recipientEmail || !account.customerId) return null;
  const customer = await stripe.request('GET', `/customers/${account.customerId}`);
  if (customer.id !== account.customerId || customer.metadata?.billingAccountId !== account.id) throw new Error('billing.customer_binding');
  return { email: emailOf(customer.email), address: addressOf(customer.address) };
}

/**
 * In the apply transaction, after the invoice upsert. Idempotent: the address is the latest one seen and
 * is never copied into Company (RV02/DQ5); the recipient is set only while empty; one audit row per
 * capture, with no email or address in it.
 */
export async function recordRecipientCapture(tx: Prisma.TransactionClient, account: Pick<BillingAccount, 'id' | 'companyId'>, snapshot: BillingSnapshot,
  capture: RecipientCapture | null, invoiceId: string, actorUserId: string | null) {
  if (!capture) return;
  const current = await tx.billingAccount.findUniqueOrThrow({ where: { id: account.id }, select: { checkoutAddressJson: true } });
  if (capture.address && !isDeepStrictEqual(current.checkoutAddressJson, capture.address))
    await tx.billingAccount.update({ where: { id: account.id }, data: { checkoutAddressJson: capture.address as Prisma.InputJsonValue } });
  if (!capture.email) return;
  // §18.2 R-A4: STRIPE_CHECKOUT only when the quote pinned no email (Checkout asked for it).
  const source = snapshot.quote.billingEmail ? 'ACCOUNT_EMAIL' : 'STRIPE_CHECKOUT';
  const changed = await tx.billingAccount.updateMany({ where: { id: account.id, recipientEmail: null }, data: { recipientEmail: capture.email, recipientSource: source } });
  if (!changed.count) return;
  await tx.auditLog.create({ data: { companyId: account.companyId, actorUserId, action: 'billing.recipient.captured', targetType: 'BillingInvoice',
    targetId: invoiceId, requestId: invoiceId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { source, addressCaptured: !!capture.address } } });
}

/** DQ5: the Checkout address in the shop profile's shape. Stripe has no sub-district, so it stays empty. */
export function checkoutAddressOf(value: unknown): CompanyLegalAddress | null {
  const address = addressOf(value);
  if (!address) return null;
  const text = (key: typeof ADDRESS_KEYS[number]) => address[key]?.trim() ?? '';
  const result: CompanyLegalAddress = { line1: text('line1'), line2: text('line2') || null, subdistrict: '',
    district: text('city'), province: text('state'), postalCode: text('postal_code') };
  return result.line1 || result.district || result.province || result.postalCode ? result : null;
}
