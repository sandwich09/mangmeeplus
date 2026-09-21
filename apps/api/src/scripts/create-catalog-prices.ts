/**
 * Idempotent provisioner for the catalog Products and Prices in Stripe
 * (Phase 6, Owner 2026-09-21 — ENTERPRISE opened for purchase now that WHT/50 ทวิ shipped).
 *
 * The platform reads catalog Prices, it never creates them: UAT's were made on 2026-09-16 by a
 * one-off script that was never committed, and live mode has none at all. This is that script,
 * in the repo, extended to the four paid tiers — so the ENTERPRISE objects UAT is missing and the
 * whole catalog live mode is missing are made the same way, with the exact shape
 * `assertStripePrice` demands, and each one is read back through that very validator.
 *
 * It binds nothing. Price ids reach the policy only through the billing configuration page
 * (PUBLISH_POLICY → `parseBillingPolicy` → `validateProvider`); see
 * docs/runbooks/production-stripe-live-enablement.md.
 *
 * Idempotent: every Price is found by its `lookup_key` and every Product by that Price (or by
 * `metadata.plan_tier` / its exact name), so a re-run creates nothing and prints the same ids. A
 * Stripe idempotency key covers a retry inside 24 h on top of that.
 *
 *   pnpm --filter @watchdog-bms/api exec tsx src/scripts/create-catalog-prices.ts \
 *     --environment uat --tax-treatment INCLUSIVE_VAT_7 --dry-run
 *
 * Env: STRIPE_SECRET_KEY (read from the environment, never printed), STRIPE_ACCOUNT_ID.
 * `--environment uat` needs an `sk_test_` key, `--environment production` an `sk_live_` key and
 * `--yes`. No database is read: live mode has no published policy yet, so the tax treatment the
 * Owner is about to publish is named on the command line instead.
 */
import { BILLING_DRAFT_POLICY, BILLING_PAID_TIERS, billingOffer,
  type BillingInterval, type BillingOffer, type BillingPolicy, type BillingTaxTreatment, type PaidTier } from '@watchdog-bms/contracts';
import type { AppConfigService } from '../common/config/app-config.service';
import { assertStripePrice } from '../modules/billing/domain/billing-policy';
import { StripeClient, stripeId, type StripeObject } from '../modules/billing/infrastructure/stripe.client';

/** Stamped into every object this script owns, so the next operator knows what wrote it. */
const MANAGED_BY = 'create-catalog-prices-20260921';
/** The names UAT already uses; live mode drops the suffix. */
const PRODUCT_NAMES: Record<PaidTier, string> = {
  STARTER_249: 'มั่งมี Plus Starter', BASIC_499: 'มั่งมี Plus Basic',
  PRO_999: 'มั่งมี Plus Pro', ENTERPRISE_1999: 'มั่งมี Plus Enterprise',
};
const TAX_TREATMENTS: readonly BillingTaxTreatment[] = ['INCLUSIVE_VAT_7', 'EXCLUSIVE_VAT_7', 'NOT_VAT_REGISTERED'];

type Purpose = 'paid' | 'prepaid';
type Variant = { tier: PaidTier; interval: BillingInterval; purpose: Purpose; offerKey: string; lookupKey: string };

function flag(name: string): string | undefined {
  const prefixed = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (prefixed) return prefixed.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`create_catalog_prices_${name.toLowerCase()}_required`);
  return value;
}

/** `mangmee_<env>_v1_<tier>_<price>_<month|year>_<paid|prepaid>` — the convention UAT already holds. */
function variantsFor(environment: string): Variant[] {
  return BILLING_PAID_TIERS.flatMap((tier) => (['month', 'year'] as const).flatMap((interval) =>
    (['paid', 'prepaid'] as const).map((purpose) => ({ tier, interval, purpose,
      offerKey: `${tier}:${interval}`,
      lookupKey: `mangmee_${environment}_v1_${tier.toLowerCase()}_${interval}_${purpose}` }))));
}

/** What Stripe must hold for this variant: the catalog offer, or the same offer at zero. */
function offerFor(variant: Variant): BillingOffer {
  const offer = billingOffer(variant.tier, variant.interval);
  return variant.purpose === 'prepaid' ? { ...offer, priceSatang: 0 } : offer;
}

async function priceByLookupKey(stripe: StripeClient, lookupKey: string): Promise<StripeObject | undefined> {
  const found = (await stripe.list('/prices', { lookup_keys: [lookupKey], active: true }))
    .filter((price) => price.lookup_key === lookupKey);
  if (found.length > 1) throw new Error(`create_catalog_prices_duplicate_${lookupKey}`);
  return found[0];
}

async function main(): Promise<void> {
  const environment = flag('environment');
  if (environment !== 'uat' && environment !== 'production') throw new Error('create_catalog_prices_environment_required');
  const taxTreatment = flag('tax-treatment') as BillingTaxTreatment | undefined;
  if (!taxTreatment || !TAX_TREATMENTS.includes(taxTreatment)) throw new Error('create_catalog_prices_tax_treatment_required');
  const dryRun = process.argv.includes('--dry-run');
  const livemode = environment === 'production';
  if (livemode && !dryRun && !process.argv.includes('--yes')) throw new Error('create_catalog_prices_live_requires_yes');
  const stripeAccountId = required('STRIPE_ACCOUNT_ID'), stripeSecretKey = required('STRIPE_SECRET_KEY');
  // Fail before any network call rather than letting the client answer `configuration_unavailable`:
  // a live key pointed at the UAT catalog would write real objects under test-mode names.
  if (!stripeSecretKey.startsWith(livemode ? 'sk_live_' : 'sk_test_')) throw new Error('create_catalog_prices_key_environment_mismatch');

  // `assertStripePrice` reads only the tax treatment off the policy; the amounts come from the code
  // catalog, which is what an unpublished (live) or freshly published policy will demand.
  const policy: BillingPolicy = { ...BILLING_DRAFT_POLICY, taxTreatment, taxRateId: null };
  const taxBehavior = taxTreatment === 'EXCLUSIVE_VAT_7' ? 'exclusive' : 'inclusive';
  const productSuffix = environment === 'uat' ? ' (ทดสอบ)' : '';
  const stripe = new StripeClient({ billingMode: livemode ? 'live' : 'test', stripeAccountId, stripeSecretKey } as unknown as AppConfigService, fetch);
  await stripe.assertAccount();
  const products = await stripe.list('/products', { active: true });
  const variants = variantsFor(environment);
  const plan: string[] = [], rows = new Map<string, { paid?: string; prepaid?: string }>();

  for (const tier of BILLING_PAID_TIERS) {
    const name = `${PRODUCT_NAMES[tier]}${productSuffix}`;
    const mine = variants.filter((variant) => variant.tier === tier);
    const found = new Map<string, StripeObject | undefined>();
    for (const variant of mine) found.set(variant.lookupKey, await priceByLookupKey(stripe, variant.lookupKey));
    // A tier's product is whatever its existing Prices already sell; only a tier with no Price at
    // all is looked up by name/metadata, and only then is a new one created.
    const productIds = new Set([...found.values()].flatMap((price) => price ? [stripeId(price.product) ?? ''] : []));
    if (productIds.size > 1) throw new Error(`create_catalog_prices_split_product_${tier.toLowerCase()}`);
    const candidates = products.filter((product) => product.metadata?.plan_tier === tier || product.name === name);
    if (!productIds.size && candidates.length > 1) throw new Error(`create_catalog_prices_duplicate_product_${tier.toLowerCase()}`);
    let productId = [...productIds][0] || stripeId(candidates[0] ?? null) || undefined;
    if (!productId) {
      plan.push(`product ${tier} create "${name}"`);
      if (!dryRun) {
        productId = stripeId(await stripe.request('POST', '/products', { name,
          metadata: { environment, managed_by: MANAGED_BY, plan_tier: tier } }, `mm:catalog:${environment}:${tier}:product`)) ?? undefined;
        if (!productId) throw new Error(`create_catalog_prices_product_unconfirmed_${tier.toLowerCase()}`);
      }
    } else plan.push(`product ${tier} reuse ${productId}`);

    for (const variant of mine) {
      const offer = offerFor(variant);
      const existing = found.get(variant.lookupKey);
      if (existing) plan.push(`${variant.offerKey} ${variant.purpose} reuse ${stripeId(existing)}`);
      else plan.push(`${variant.offerKey} ${variant.purpose} create ${offer.priceSatang} satang (${variant.lookupKey})`);
      if (dryRun) continue;
      const created = existing ?? await stripe.request('POST', '/prices', {
        product: productId, currency: 'thb', unit_amount: offer.priceSatang,
        recurring: { interval: variant.interval, interval_count: 1, usage_type: 'licensed' },
        billing_scheme: 'per_unit', tax_behavior: taxBehavior, lookup_key: variant.lookupKey,
        metadata: { environment, managed_by: MANAGED_BY, offer_key: variant.offerKey, purpose: variant.purpose },
      }, `mm:catalog:${variant.lookupKey}`);
      const priceId = stripeId(created);
      if (!priceId) throw new Error(`create_catalog_prices_unconfirmed_${variant.lookupKey}`);
      // Read it back rather than trusting the write: the configuration page validates exactly this way.
      const price = await stripe.request('GET', `/prices/${priceId}`);
      if (price.lookup_key !== variant.lookupKey || stripeId(price.product) !== productId) {
        throw new Error(`create_catalog_prices_binding_${variant.lookupKey}`);
      }
      assertStripePrice(price, offer, policy, livemode, priceId);
      rows.set(variant.offerKey, { ...rows.get(variant.offerKey), [variant.purpose]: priceId });
    }
  }

  process.stderr.write(`environment=${environment} mode=${livemode ? 'LIVE' : 'TEST'} tax=${taxTreatment}${dryRun ? ' dry-run: nothing written' : ''}\n`);
  for (const line of plan) process.stderr.write(`${line}\n`);
  if (dryRun) return;
  // stdout is only the paste-ready table, in the exact key form the configuration form uses.
  for (const variant of variants) {
    if (variant.purpose !== 'paid') continue;
    const row = rows.get(variant.offerKey)!;
    console.log(`${variant.offerKey} paid=${row.paid} zero=${row.prepaid}`);
  }
  process.stderr.write('\nกรอกรหัสเหล่านี้ในหน้า ระบบ → การชำระเงิน → ตั้งค่า → "ราคาและสิทธิ์ของแพ็กเกจ" แล้วส่งขออนุมัติ\n');
}

void main().catch((error) => {
  // Stripe error bodies never reach a log (stripe.client.ts); only our own short reason does.
  // `assertStripePrice` answers with a Nest exception, so surface its code — it is the whole point
  // of the read-back and an operator cannot act on "Conflict".
  const response = (error as { getResponse?: () => unknown })?.getResponse?.();
  const code = response && typeof response === 'object' ? (response as { code?: string }).code : undefined;
  process.stderr.write(`${JSON.stringify({ event: 'create_catalog_prices_failed',
    reason: code ?? (error instanceof Error ? error.message : 'unknown') })}\n`);
  process.exitCode = 1;
});
