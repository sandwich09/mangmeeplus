import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import type { AppConfigService } from '../common/config/app-config.service';
import { StripeClient } from '../modules/billing/infrastructure/stripe.client';

/**
 * Purchase without setup (pr-c §3.3): copy each existing Stripe Customer email into the new
 * `BillingAccount.recipientEmail` column. Reads Stripe only; writes a row only while its column is
 * still empty, so a capture or recipient change that runs meanwhile wins. Logs counts, never an email.
 *
 * Release step, after `migrate deploy` and before customer acceptance (not a hard gate: empty rows are
 * filled lazily and at the next capture). Run through a DB tunnel; never registered in package.json:
 *   DATABASE_URL=… STRIPE_SECRET_KEY=… STRIPE_ACCOUNT_ID=… BILLING_MODE=test|live \
 *     pnpm --filter @watchdog-bms/api exec tsx src/scripts/backfill-billing-recipients.ts --dry-run [--limit=N]
 * then again without `--dry-run`; BILLING_MODE=live additionally requires `--yes`.
 */
async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('backfill_billing_recipients_database_url_required');
  const dryRun = process.argv.includes('--dry-run'), billingMode = process.env['BILLING_MODE'] ?? 'disabled', livemode = billingMode === 'live';
  if (!['test', 'live'].includes(billingMode)) throw new Error('backfill_billing_recipients_billing_mode_required');
  if (livemode && !dryRun && !process.argv.includes('--yes')) throw new Error('backfill_billing_recipients_live_requires_yes');
  const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : 10_000;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('backfill_billing_recipients_limit_invalid');
  const stripe = new StripeClient({ billingMode, stripeSecretKey: process.env['STRIPE_SECRET_KEY'], stripeAccountId: process.env['STRIPE_ACCOUNT_ID'] } as unknown as AppConfigService,
    globalThis.fetch.bind(globalThis));
  await stripe.assertAccount();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const summary = { scanned: 0, updated: 0, noEmail: 0, bindingMismatch: 0, dryRun };
  try {
    const rows = await prisma.billingAccount.findMany({ where: { stripeAccountId: stripe.accountId, livemode, customerId: { not: null }, recipientEmail: null },
      orderBy: { createdAt: 'asc' }, take: limit, select: { id: true, companyId: true, customerId: true } });
    for (const row of rows) {
      summary.scanned++;
      const customer = await stripe.request('GET', `/customers/${row.customerId}`);
      if (customer.id !== row.customerId || customer.deleted || customer.metadata?.billingAccountId !== row.id) { summary.bindingMismatch++; continue; }
      const email = typeof customer.email === 'string' ? customer.email.trim().toLowerCase() : '';
      if (!email || email.length > 320) { summary.noEmail++; continue; }
      if (dryRun) { summary.updated++; continue; }
      summary.updated += await prisma.$transaction(async tx => {
        const changed = await tx.billingAccount.updateMany({ where: { id: row.id, recipientEmail: null }, data: { recipientEmail: email, recipientSource: 'ACCOUNT_EMAIL' } });
        if (changed.count) await tx.auditLog.create({ data: { companyId: row.companyId, action: 'billing.recipient.backfilled', targetType: 'BillingAccount', targetId: row.id,
          requestId: `backfill-billing-recipients:${row.id}`, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { source: 'ACCOUNT_EMAIL' } } });
        return changed.count;
      });
    }
    console.log(JSON.stringify({ event: 'backfill_billing_recipients_complete', ...summary }));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({
    event: 'backfill_billing_recipients_failed',
    errorCode: error instanceof Error && /^[a-z0-9_.]+$/i.test(error.message) ? error.message : 'backfill_billing_recipients_failed',
  }));
  process.exit(1);
});
